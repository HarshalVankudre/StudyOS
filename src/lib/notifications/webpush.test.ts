// @vitest-environment node
import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MAX_PAYLOAD_BYTES,
  b64url,
  classifyStatus,
  encryptPayload,
  fromB64url,
  generateVapidKeys,
  sendWebPush,
  vapidAuthorization,
  vapidKeysMatch,
} from "./webpush";

// RFC 8291, Appendix A.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  header:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
};

/** The browser side, written independently of the sender: RFC 8291 decryption. */
function decrypt(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  expect(rs).toBe(4096);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const secret = ecdh.computeSecret(asPublic);
  const h = (k: Buffer, d: Buffer) => createHmac("sha256", k).update(d).digest();
  const prkKey = h(auth, secret);
  const ikm = h(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
  const prk = h(salt, ikm);
  const cek = h(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = h(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  expect(plain[plain.length - 1]).toBe(2); // last-record delimiter
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

function newBrowser() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = Buffer.from("0123456789abcdef");
  return {
    privateKey: ecdh.getPrivateKey(),
    publicKey: ecdh.getPublicKey(),
    auth,
    keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) },
  };
}

describe("RFC 8291 encryption", () => {
  it("matches the Appendix A test vector byte for byte", () => {
    const body = encryptPayload(
      Buffer.from(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { salt: fromB64url(RFC.salt), ephemeralPrivateKey: fromB64url(RFC.asPrivate) },
    );
    const expected = Buffer.concat([fromB64url(RFC.header), fromB64url(RFC.ciphertext)]);
    expect(b64url(body)).toBe(b64url(expected));
  });

  it("round-trips through an independent decryption with random keys", () => {
    const browser = newBrowser();
    const message = JSON.stringify({ title: "Ünïcödé ✓ 期末考试", body: "x".repeat(500) });
    const body = encryptPayload(Buffer.from(message), browser.keys);
    expect(decrypt(body, browser.privateKey, browser.publicKey, browser.auth)).toBe(message);
  });

  it("refuses payloads that do not fit one record and bad keys", () => {
    const browser = newBrowser();
    expect(() => encryptPayload(Buffer.alloc(MAX_PAYLOAD_BYTES + 1), browser.keys)).toThrow(/too large/);
    expect(() => encryptPayload(Buffer.from("x"), { p256dh: b64url(Buffer.alloc(65)), auth: browser.keys.auth })).toThrow();
  });
});

describe("VAPID", () => {
  it("generates matching keys and detects a mismatch", () => {
    const a = generateVapidKeys();
    const b = generateVapidKeys();
    expect(fromB64url(a.publicKey)).toHaveLength(65);
    expect(fromB64url(a.privateKey)).toHaveLength(32);
    expect(vapidKeysMatch(a.publicKey, a.privateKey)).toBe(true);
    expect(vapidKeysMatch(a.publicKey, b.privateKey)).toBe(false);
    expect(vapidKeysMatch(a.publicKey, "not-a-key")).toBe(false);
  });

  it("signs an ES256 JWT for the endpoint's origin that verifies with the public key", () => {
    const keys = { ...generateVapidKeys(), subject: "mailto:ops@example.com" };
    const now = new Date("2026-11-12T10:00:00Z");
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, now);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, h, c, s, k] = match!;
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(fromB64url(h).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(fromB64url(c).toString());
    expect(claims).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
      sub: "mailto:ops@example.com",
    });
    expect(verifyJwt(`${h}.${c}`, s, keys.publicKey)).toBe(true);
  });
});

function verifyJwt(unsigned: string, signature: string, publicKey: string): boolean {
  const pub = fromB64url(publicKey);
  const key = createPublicKey({
    key: { kty: "EC", crv: "P-256", x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) },
    format: "jwk",
  });
  return verify("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }, fromB64url(signature));
}

describe("sendWebPush against a local fake push service", () => {
  let server: Server;
  let base = "";
  const received: { url: string; headers: IncomingMessage["headers"]; body: Buffer }[] = [];
  let nextStatus = 201;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received.push({ url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) });
        res.statusCode = nextStatus;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("delivers an encrypted, VAPID-signed message the browser can read", async () => {
    const browser = newBrowser();
    const vapid = { ...generateVapidKeys(), subject: "mailto:ops@example.com" };
    nextStatus = 201;
    const outcome = await sendWebPush(
      { endpoint: `${base}/push/device-1`, ...browser.keys },
      JSON.stringify({ title: "Hello" }),
      vapid,
      { ttlSeconds: 3600, urgency: "normal", topic: "daily" },
    );
    expect(outcome).toEqual({ kind: "sent", status: 201 });
    const req = received.at(-1)!;
    expect(req.url).toBe("/push/device-1");
    expect(req.headers["content-encoding"]).toBe("aes128gcm");
    expect(req.headers.ttl).toBe("3600");
    expect(req.headers.urgency).toBe("normal");
    expect(req.headers.topic).toBe("daily");
    const auth = /^vapid t=([^.]+\.[^.]+)\.([^,]+), k=(.+)$/.exec(String(req.headers.authorization))!;
    expect(verifyJwt(auth[1], auth[2], vapid.publicKey)).toBe(true);
    expect(JSON.parse(fromB64url(auth[1].split(".")[1]).toString()).aud).toBe(base);
    expect(decrypt(req.body, browser.privateKey, browser.publicKey, browser.auth)).toBe('{"title":"Hello"}');
  });

  it("reports a gone subscription, a rejection and a retryable failure", async () => {
    const browser = newBrowser();
    const vapid = { ...generateVapidKeys(), subject: "mailto:ops@example.com" };
    const send = () =>
      sendWebPush({ endpoint: `${base}/push/x`, ...browser.keys }, "{}", vapid, { ttlSeconds: 60 });
    nextStatus = 410;
    expect(await send()).toEqual({ kind: "gone", status: 410 });
    nextStatus = 404;
    expect(await send()).toEqual({ kind: "gone", status: 404 });
    nextStatus = 403;
    expect(await send()).toEqual({ kind: "rejected", status: 403 });
    nextStatus = 503;
    expect(await send()).toEqual({ kind: "retry", status: 503 });
  });

  it("treats a network failure as retryable without throwing or echoing the endpoint", async () => {
    const browser = newBrowser();
    const vapid = { ...generateVapidKeys(), subject: "mailto:ops@example.com" };
    const outcome = await sendWebPush(
      { endpoint: "http://127.0.0.1:1/secret-capability", ...browser.keys },
      "{}",
      vapid,
      { ttlSeconds: 60, timeoutMs: 2000 },
    );
    expect(outcome).toEqual({ kind: "retry", status: null });
    expect(JSON.stringify(outcome)).not.toContain("secret-capability");
  });

  it("refuses an oversized message as too_large, not as a rejection of the device", async () => {
    const browser = newBrowser();
    const vapid = { ...generateVapidKeys(), subject: "mailto:ops@example.com" };
    const outcome = await sendWebPush(
      { endpoint: "http://127.0.0.1:1/x", ...browser.keys },
      "x".repeat(MAX_PAYLOAD_BYTES + 1),
      vapid,
      { ttlSeconds: 60, timeoutMs: 2000 },
    );
    expect(outcome).toEqual({ kind: "too_large", status: null });
  });

  it("classifies statuses", () => {
    expect(classifyStatus(202).kind).toBe("sent");
    // 413: the message was too big, which says nothing about the device.
    expect(classifyStatus(413).kind).toBe("too_large");
    expect(classifyStatus(400).kind).toBe("rejected");
    expect(classifyStatus(429).kind).toBe("retry");
  });
});
