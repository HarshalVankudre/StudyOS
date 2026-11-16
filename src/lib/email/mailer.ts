/**
 * Sending one email over SMTP (nodemailer), with an outcome instead of an
 * exception: `sendMail` never throws.
 *
 *   sent       the server accepted the message for delivery;
 *   rejected   the server refused the RECIPIENT for good: a 5xx answer to
 *              RCPT TO that says the mailbox or its domain does not exist
 *              (see classifySmtpError). The caller stops emailing that
 *              address;
 *   temporary  anything else: a 4xx, a network or TLS failure, a timeout,
 *              and every 5xx that is not plainly about the recipient (our
 *              credentials, our sender address, a message too large, a
 *              sandbox or relay restriction of the provider, a spam or
 *              policy block, anything after DATA). Tried again with the next
 *              message. `reason` tells our own configuration problems
 *              ("config") and blocks ("refused") apart, so they get reported.
 *
 * Why the care with 5xx: a wrong SMTP password (535), a sender the provider
 * has not verified (550 at MAIL FROM or RCPT TO), a provider in test mode
 * ("you can only send testing emails to your own address") or "relay access
 * denied" would otherwise mark every student's address as dead on the first
 * run. Only a refusal that names the mailbox counts; the email channel adds a
 * circuit breaker on top (too many in one run: stop believing them).
 *
 * Note that most providers accept a message at SMTP time and bounce it later
 * (an email back, or a webhook): those bounces are not seen here; the
 * provider's own suppression list keeps them from being retried for real.
 *
 * Timeouts. A send gets TIMEOUT_MS from the moment it is handed to a
 * connection, not from when it was queued: the mailer lets at most
 * MAX_IN_FLIGHT sends run at once (the pool's connection count), so a send
 * that starts is never waiting behind another inside the pool, and one that
 * waits for its turn longer than QUEUE_TIMEOUT_MS gives up without ever
 * being handed over. A send that runs out of time is cancelled through
 * nodemailer's per-message AbortSignal (a queued message is dropped, a
 * connection in the middle of one is closed, so nothing goes out late after
 * the caller has recorded the reminder as failed), and the pool is closed and
 * rebuilt for the next send: a server that stalls one connection usually
 * stalls the others too.
 *
 * The transport is created on first use, pooled (a few long-lived
 * connections), and rebuilt if the configuration changes. Tests inject a
 * transport (nodemailer's jsonTransport, or a stub).
 */
import "server-only";

import nodemailer from "nodemailer";
import { emailConfig, type EmailConfig, type Mailbox } from "./config";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

export type TemporaryReason = "not_configured" | "network" | "timeout" | "deferred" | "config" | "refused" | "error";

export type MailOutcome =
  | { kind: "sent"; messageId: string | null }
  | { kind: "rejected"; code: number | null }
  | { kind: "temporary"; code: number | null; reason: TemporaryReason };

/** What the mailer needs from a nodemailer transporter. */
export interface MailTransport {
  sendMail(message: Record<string, unknown>): Promise<unknown>;
  close?(): void;
}

export interface Mailer {
  send(mail: OutgoingMail): Promise<MailOutcome>;
  /** Close the transport (idle connections at once, busy ones after their message). */
  close(): void;
}

export interface MailerOptions {
  /**
   * The transport, or a factory for it. With a factory, a send that runs out
   * of time closes the transport and the next send builds a fresh one.
   */
  transport: MailTransport | (() => MailTransport);
  from: Mailbox;
  replyTo?: string | null;
  /** Give up on a send this long after it was handed to a connection. */
  timeoutMs?: number;
  /** Sends running at once at most (the pool's connections); the rest wait their turn. */
  maxInFlight?: number;
  /** Give up, without sending, after waiting this long for a turn. */
  queueTimeoutMs?: number;
}

export const TIMEOUT_MS = 15_000;
export const QUEUE_TIMEOUT_MS = 15_000;
export const MAX_IN_FLIGHT = 5;

type SmtpErrorLike = {
  code?: unknown;
  responseCode?: unknown;
  command?: unknown;
  response?: unknown;
};

/**
 * Enhanced status codes (RFC 3463) that say the recipient's mailbox or its
 * domain is gone: bad mailbox (5.1.1), bad domain (5.1.2), bad address
 * syntax (5.1.3), mailbox moved (5.1.6), no such recipient (5.1.10, Exchange),
 * mailbox disabled (5.2.1). Not 5.2.2 (mailbox full: usually cleared by its
 * owner), nor 5.1.8 (OUR sender), 5.2.3 (our message too large), 5.7.x
 * (policy) or anything else.
 */
const RECIPIENT_CODES = new Set(["5.1.1", "5.1.2", "5.1.3", "5.1.6", "5.1.10", "5.2.1"]);
/** Generic codes that say nothing by themselves: the wording decides. */
const GENERIC_CODES = new Set(["5.0.0", "5.1.0"]);
/** A refusal that plainly names the mailbox, for replies without a telling code. */
const RECIPIENT_WORDS =
  /user unknown|unknown user|no such user|no such mailbox|no such recipient|does not exist|doesn't exist|mailbox unavailable|mailbox not found|unknown recipient|recipient unknown|invalid recipient|recipient not found|(?:does not|doesn't) have an? [\w.-]+ account/i;
/**
 * Wording of a refusal that is about US, never the recipient: our sender or
 * login, the provider's sandbox or test mode, relaying, quotas, spam and
 * policy blocks. Wins over any recipient wording in the same reply.
 */
const NOT_RECIPIENT_WORDS =
  /sender|from address|relay|rcpthosts|not (?:permitted|allowed|authori[sz]ed)|authenticat|verif|testing|test mode|sandbox|your own|own email|policy|spam|block|blacklist|denylist|reputation|rate limit|quota|too many|send ?as/i;
/** Wording of a block (as opposed to our own setup). */
const BLOCK_WORDS = /policy|spam|block|blacklist|denylist|reputation|rate limit|too many/i;
const CONFIG_CODES = new Set(["EAUTH", "ENOAUTH", "EOAUTH2", "ECONFIG", "ETLS", "EREQUIRETLS"]);
const NETWORK_CODES = new Set(["ECONNECTION", "ESOCKET", "EDNS", "EPROTOCOL", "EPROXY", "ECONNREFUSED", "ECONNRESET"]);

/** The enhanced status code right after the reply code ("550 5.1.1 ..." or "550-5.1.1 ..."), if any. */
function enhancedCode(response: string): string | null {
  const match = /^\s*\d{3}[ -]?([245]\.\d{1,3}\.\d{1,3})\b/.exec(response);
  return match ? match[1] : null;
}

/** What an SMTP failure means for the recipient (see the module comment). */
export function classifySmtpError(error: unknown): MailOutcome {
  const e = (error && typeof error === "object" ? error : {}) as SmtpErrorLike;
  const status = typeof e.responseCode === "number" ? e.responseCode : null;
  const code = typeof e.code === "string" ? e.code : "";
  const command = typeof e.command === "string" ? e.command.toUpperCase() : "";
  const response = typeof e.response === "string" ? e.response : "";

  if (status === null) {
    if (CONFIG_CODES.has(code)) return { kind: "temporary", code: null, reason: "config" };
    if (code === "ETIMEDOUT") return { kind: "temporary", code: null, reason: "timeout" };
    if (NETWORK_CODES.has(code)) return { kind: "temporary", code: null, reason: "network" };
    return { kind: "temporary", code: null, reason: "error" };
  }
  // 4xx, and 503 (bad sequence: a protocol hiccup), are worth another try.
  if (status < 500 || status === 503 || status >= 600) return { kind: "temporary", code: status, reason: "deferred" };

  // Our login, our sender, the connection: our own setup, whatever the words.
  if (code === "EAUTH" || command.startsWith("AUTH") || command.startsWith("MAIL") || command === "CONN") {
    return { kind: "temporary", code: status, reason: "config" };
  }
  const enhanced = enhancedCode(response);
  const blocked = Boolean(enhanced?.startsWith("5.7.")) || BLOCK_WORDS.test(response);
  // Only an answer to RCPT TO can be about the recipient; anything after DATA
  // (the message refused as a whole: too large, "send as" denied, content)
  // never is.
  if (!command.startsWith("RCPT")) {
    return { kind: "temporary", code: status, reason: blocked ? "refused" : "config" };
  }
  if (NOT_RECIPIENT_WORDS.test(response)) {
    return { kind: "temporary", code: status, reason: blocked ? "refused" : "config" };
  }
  if (enhanced === "5.2.2") return { kind: "temporary", code: status, reason: "deferred" };
  if (enhanced && RECIPIENT_CODES.has(enhanced)) return { kind: "rejected", code: status };
  if ((!enhanced || GENERIC_CODES.has(enhanced)) && RECIPIENT_WORDS.test(response)) {
    return { kind: "rejected", code: status };
  }
  return { kind: "temporary", code: status, reason: blocked ? "refused" : "config" };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** One recipient refused in a reply that did not fail the whole message. */
function rejectedIn(info: unknown, to: string): MailOutcome | null {
  const i = (info && typeof info === "object" ? info : {}) as {
    rejected?: unknown[];
    rejectedErrors?: unknown[];
  };
  const rejected = Array.isArray(i.rejected) ? i.rejected.map((r) => String(r).toLowerCase()) : [];
  if (!rejected.includes(to.toLowerCase())) return null;
  const first = Array.isArray(i.rejectedErrors) ? i.rejectedErrors[0] : undefined;
  // Without the server's words there is nothing to go on: not the recipient's fault.
  const outcome = classifySmtpError(first ?? { responseCode: 550, command: "RCPT TO" });
  return outcome.kind === "sent" ? null : outcome;
}

/** Turns for at most `size` sends at once, first come first served. */
function createTurns(size: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };
  return {
    /** A release function once it is this send's turn, or null after `timeoutMs` (never handed over). */
    async take(timeoutMs: number): Promise<(() => void) | null> {
      if (running < size) {
        running += 1;
        return release;
      }
      return new Promise((resolve) => {
        const go = () => {
          clearTimeout(timer);
          resolve(release);
        };
        const timer = setTimeout(() => {
          const index = waiting.indexOf(go);
          if (index >= 0) waiting.splice(index, 1);
          resolve(null);
        }, timeoutMs);
        waiting.push(go);
      });
    },
  };
}

export function createMailer(options: MailerOptions): Mailer {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const queueTimeoutMs = options.queueTimeoutMs ?? QUEUE_TIMEOUT_MS;
  const factory = typeof options.transport === "function" ? options.transport : null;
  let transport: MailTransport | null = factory ? null : (options.transport as MailTransport);
  const turns = createTurns(Math.max(1, options.maxInFlight ?? MAX_IN_FLIGHT));

  const current = (): MailTransport => (transport ??= factory!());
  /** A send stalled on this transport: close it, and build a fresh one for the next send. */
  const stalled = (used: MailTransport) => {
    if (!factory || transport !== used) return;
    transport = null;
    try {
      used.close?.();
    } catch {
      // closing is best effort
    }
  };

  return {
    async send(mail) {
      const done = await turns.take(queueTimeoutMs);
      // Never handed over, so never sent.
      if (!done) return { kind: "temporary", code: null, reason: "timeout" };
      const controller = new AbortController();
      let used: MailTransport | null = null;
      try {
        used = current();
        const sending = used.sendMail({
          from: options.from.name ? { name: options.from.name, address: options.from.address } : options.from.address,
          ...(options.replyTo ? { replyTo: options.replyTo } : {}),
          to: mail.to,
          subject: mail.subject.replace(/\s+/g, " ").trim(),
          text: mail.text,
          html: mail.html,
          headers: mail.headers ?? {},
          // Never attach a file or fetch a URL named in the message.
          disableFileAccess: true,
          disableUrlAccess: true,
          // Cancels the message when it runs out of time (see the module comment).
          signal: controller.signal,
        });
        const info = await withTimeout(sending, timeoutMs);
        if (info === "timeout") {
          // Swallow the late result or error of the abandoned send, and stop it.
          sending.catch(() => {});
          controller.abort();
          stalled(used);
          return { kind: "temporary", code: null, reason: "timeout" };
        }
        const refused = rejectedIn(info, mail.to);
        if (refused) return refused;
        const messageId = (info as { messageId?: unknown } | null)?.messageId;
        return { kind: "sent", messageId: typeof messageId === "string" ? messageId : null };
      } catch (error) {
        return classifySmtpError(error);
      } finally {
        done();
      }
    },
    close() {
      const open = transport;
      if (factory) transport = null;
      open?.close?.();
    },
  };
}

/** A pooled SMTP transport for these settings. */
export function smtpTransport(config: EmailConfig): MailTransport {
  const { smtp } = config;
  return nodemailer.createTransport({
    pool: true,
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: smtp.requireTLS,
    ...(smtp.auth ? { auth: smtp.auth } : {}),
    maxConnections: MAX_IN_FLIGHT,
    maxMessages: 100,
    // Within the mailer's own TIMEOUT_MS per send (which also covers a server
    // that trickles its replies, which no socket timeout notices).
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    dnsTimeout: 10_000,
    // Never log: the SMTP session would carry addresses and credentials.
    logger: false,
    debug: false,
  });
}

let shared: { signature: string; mailer: Mailer } | null = null;

/** The mailer for the configured SMTP server (built on first use), or null. */
export function defaultMailer(): Mailer | null {
  const config = emailConfig();
  if (!config) return null;
  const signature = JSON.stringify(config);
  if (shared?.signature !== signature) {
    shared?.mailer.close();
    shared = {
      signature,
      mailer: createMailer({ transport: () => smtpTransport(config), from: config.from, replyTo: config.replyTo }),
    };
  }
  return shared.mailer;
}

/** Send through the configured server. Never throws. */
export async function sendMail(mail: OutgoingMail): Promise<MailOutcome> {
  let mailer: Mailer | null;
  try {
    mailer = defaultMailer();
  } catch {
    return { kind: "temporary", code: null, reason: "config" };
  }
  if (!mailer) return { kind: "temporary", code: null, reason: "not_configured" };
  return mailer.send(mail);
}
