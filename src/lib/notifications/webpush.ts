/**
 * The Web Push protocol, implemented on Node's own crypto (no dependency):
 *
 *  - RFC 8291 message encryption with the RFC 8188 `aes128gcm` content coding
 *    (ECDH P-256 + HKDF-SHA-256 + AES-128-GCM, one record);
 *  - RFC 8292 VAPID: an ES256-signed JWT plus the application server's public
 *    key in the `Authorization: vapid t=…, k=…` header;
 *  - RFC 8030 delivery: one POST to the subscription's endpoint with `TTL`,
 *    `Urgency` and an optional `Topic` (a newer message with the same topic
 *    replaces an undelivered older one).
 *
 * Why not the `web-push` npm package: the protocol is small and fully
 * specified, Node has every primitive built in, and the encryption is checked
 * byte for byte against the RFC 8291 Appendix A test vector (webpush.test.ts),
 * so a dependency (with its own transitive tree) buys nothing here.
 *
 * The endpoint is a capability URL. Nothing in this file logs it, and errors
 * thrown from here never include it.
 */
import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";

export interface PushSubscriptionKeys {
  endpoint: string;
  /** The browser's P-256 public key, base64url (65 bytes, uncompressed). */
  p256dh: string;
  /** The browser's 16-byte auth secret, base64url. */
  auth: string;
}

export interface VapidKeys {
  /** base64url, 65-byte uncompressed P-256 point. */
  publicKey: string;
  /** base64url, 32-byte private scalar. */
  privateKey: string;
  /** "mailto:…" or an https URL: who the push service can contact. */
  subject: string;
}

/** Record size written in the header. One record holds the whole message. */
const RECORD_SIZE = 4096;
/** Header: salt(16) + rs(4) + idlen(1) + keyid(65). */
const HEADER_BYTES = 86;
/** AES-GCM tag + the final-record delimiter byte. */
const RECORD_OVERHEAD = 17;
/** Largest plaintext that fits one record. */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - RECORD_OVERHEAD;

export function b64url(buf: Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

export function fromB64url(value: string): Buffer {
  return Buffer.from(value.replace(/=+$/, ""), "base64url");
}

function hmac(key: Uint8Array, data: Uint8Array): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** HKDF-Expand for a single block (every output here is <= 32 bytes). */
function hkdfExpand1(prk: Uint8Array, info: Uint8Array, length: number): Buffer {
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

/** Is this a usable uncompressed P-256 public key? */
export function isP256PublicKey(bytes: Uint8Array): boolean {
  if (bytes.length !== 65 || bytes[0] !== 0x04) return false;
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(randomBytes(32));
    ecdh.computeSecret(bytes);
    return true;
  } catch {
    return false;
  }
}

export interface EncryptOptions {
  /** Fixed salt (tests only; production uses 16 random bytes). */
  salt?: Uint8Array;
  /** Fixed application-server ephemeral private key (tests only). */
  ephemeralPrivateKey?: Uint8Array;
}

/**
 * Encrypt `payload` for one subscription (RFC 8291, aes128gcm). Returns the
 * complete request body: header (salt, record size, sender key) + ciphertext.
 */
export function encryptPayload(
  payload: Uint8Array,
  keys: Pick<PushSubscriptionKeys, "p256dh" | "auth">,
  options: EncryptOptions = {},
): Buffer {
  if (payload.length > MAX_PAYLOAD_BYTES) throw new Error("push payload too large");
  const uaPublic = fromB64url(keys.p256dh);
  const authSecret = fromB64url(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error("invalid p256dh key");
  if (authSecret.length < 16) throw new Error("invalid auth secret");

  const ecdh = createECDH("prime256v1");
  if (options.ephemeralPrivateKey) ecdh.setPrivateKey(Buffer.from(options.ephemeralPrivateKey));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  const salt = options.salt ? Buffer.from(options.salt) : randomBytes(16);

  // RFC 8291 section 3.4: combine the ECDH secret with the auth secret.
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "latin1"), uaPublic, asPublic]);
  const ikm = hkdfExpand1(prkKey, keyInfo, 32);
  // RFC 8188 section 2.2: content-encryption key and nonce.
  const prk = hmac(salt, ikm);
  const cek = hkdfExpand1(prk, Buffer.from("Content-Encoding: aes128gcm\0", "latin1"), 16);
  const nonce = hkdfExpand1(prk, Buffer.from("Content-Encoding: nonce\0", "latin1"), 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // A single (last) record: payload, then the 0x02 delimiter, no padding.
  const sealed = Buffer.concat([cipher.update(payload), cipher.update(Buffer.from([2])), cipher.final()]);
  const ciphertext = Buffer.concat([sealed, cipher.getAuthTag()]);

  const header = Buffer.alloc(HEADER_BYTES);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  asPublic.copy(header, 21);
  return Buffer.concat([header, ciphertext]);
}

// ---- VAPID ------------------------------------------------------------------

const keyCache = new Map<string, KeyObject>();

function vapidPrivateKey(keys: VapidKeys): KeyObject {
  const cacheKey = `${keys.publicKey}.${keys.privateKey}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;
  const pub = fromB64url(keys.publicKey);
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: b64url(padTo32(fromB64url(keys.privateKey))),
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
  keyCache.clear();
  keyCache.set(cacheKey, key);
  return key;
}

function padTo32(bytes: Buffer): Buffer {
  if (bytes.length >= 32) return bytes;
  return Buffer.concat([Buffer.alloc(32 - bytes.length), bytes]);
}

/** Does the private key belong to the public key? */
export function vapidKeysMatch(publicKey: string, privateKey: string): boolean {
  try {
    const priv = fromB64url(privateKey);
    if (priv.length < 31 || priv.length > 32) return false;
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(padTo32(priv));
    return ecdh.getPublicKey().equals(fromB64url(publicKey));
  } catch {
    return false;
  }
}

/** A fresh VAPID key pair (what the owner puts in configuration). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(padTo32(ecdh.getPrivateKey())) };
}

/** The `Authorization` header value for a request to `endpoint`. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now = new Date()): string {
  const audience = new URL(endpoint).origin;
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        // At most 24 hours ahead (RFC 8292); 12 is the common choice.
        exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
        sub: keys.subject,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: vapidPrivateKey(keys),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${unsigned}.${b64url(signature)}, k=${keys.publicKey}`;
}

// ---- Delivery ---------------------------------------------------------------

export type PushOutcome =
  /** Accepted by the push service (201/202). */
  | { kind: "sent"; status: number }
  /** The subscription no longer exists (404/410): delete it. */
  | { kind: "gone"; status: number }
  /** Rejected for this subscription (other 4xx, e.g. VAPID key mismatch). */
  | { kind: "rejected"; status: number }
  /** Push service trouble or network failure: worth trying another time. */
  | { kind: "retry"; status: number | null }
  /**
   * The message itself is too big (refused before sending, or 413 from the
   * push service). Says nothing about the subscription: never count it
   * against the device.
   */
  | { kind: "too_large"; status: number | null };

export interface SendOptions {
  /** Seconds the push service may hold the message for an offline device. */
  ttlSeconds: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  /** Replaces an undelivered message with the same topic (<= 32 base64url chars). */
  topic?: string;
  /** Abort the request after this many milliseconds (default 10 s). */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: Date;
  encrypt?: EncryptOptions;
}

/** Send one encrypted message. Never throws; never reveals the endpoint. */
export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  payload: string,
  vapid: VapidKeys,
  options: SendOptions,
): Promise<PushOutcome> {
  // Checked before the keys: an oversized message is the message's fault,
  // not the subscription's (see content.ts pushPayload, which never builds one).
  if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) return { kind: "too_large", status: null };
  let body: Buffer;
  let authorization: string;
  try {
    body = encryptPayload(Buffer.from(payload, "utf8"), subscription, options.encrypt);
    authorization = vapidAuthorization(subscription.endpoint, vapid, options.now);
  } catch {
    // Unusable keys stored for this subscription: it can never be delivered.
    return { kind: "rejected", status: 0 };
  }
  const headers: Record<string, string> = {
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(Math.max(0, Math.round(options.ttlSeconds))),
    Urgency: options.urgency ?? "normal",
    Authorization: authorization,
  };
  if (options.topic && /^[A-Za-z0-9_-]{1,32}$/.test(options.topic)) headers.Topic = options.topic;

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const res = await fetchImpl(subscription.endpoint, {
      method: "POST",
      headers,
      body: new Uint8Array(body),
      signal: controller.signal,
      redirect: "error",
    });
    // Drain the (small) body so the connection can be reused.
    await res.arrayBuffer().catch(() => undefined);
    return classifyStatus(res.status);
  } catch {
    return { kind: "retry", status: null };
  } finally {
    clearTimeout(timer);
  }
}

export function classifyStatus(status: number): PushOutcome {
  if (status >= 200 && status < 300) return { kind: "sent", status };
  if (status === 404 || status === 410) return { kind: "gone", status };
  if (status === 413) return { kind: "too_large", status };
  if (status === 429 || status >= 500) return { kind: "retry", status };
  return { kind: "rejected", status };
}
