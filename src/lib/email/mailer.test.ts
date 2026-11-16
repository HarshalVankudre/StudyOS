// @vitest-environment node
import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import nodemailer from "nodemailer";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSmtpUrl } from "./config";
import { classifySmtpError, createMailer, smtpTransport, type MailTransport } from "./mailer";

const FROM = { name: "StudyOS", address: "hello@studyos.test" };
const mail = (to = "student@example.com") => ({
  to,
  subject: "Today’s plan · about 45 min",
  text: "Start here.",
  html: "<p>Start here.</p>",
  headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
});

// ---- A tiny SMTP server: answers per stage, as a real one would ------------

/** The reply per stage; null = never answer (a stalling server). */
const replies: { mail: string; rcpt: string | null; auth: string; data: string } = {
  mail: "250 2.1.0 Ok",
  rcpt: "250 2.1.5 Ok",
  auth: "235 2.7.0 Authenticated",
  data: "250 2.0.0 Ok: queued as ABC123",
};
const received: string[] = [];
let closedSockets = 0;
let server: Server;
let port = 0;

function speak(socket: Socket) {
  let buffer = "";
  let inData = false;
  socket.write("220 fake.smtp ESMTP\r\n");
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      if (inData) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end < 0) return;
        received.push(buffer.slice(0, end));
        buffer = buffer.slice(end + 5);
        inData = false;
        socket.write(`${replies.data}\r\n`);
        continue;
      }
      const eol = buffer.indexOf("\r\n");
      if (eol < 0) return;
      const line = buffer.slice(0, eol);
      buffer = buffer.slice(eol + 2);
      const verb = line.slice(0, 4).toUpperCase();
      if (verb === "EHLO") socket.write("250-fake.smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
      else if (verb === "HELO") socket.write("250 fake.smtp\r\n");
      else if (verb === "AUTH") socket.write(`${replies.auth}\r\n`);
      else if (verb === "MAIL") socket.write(`${replies.mail}\r\n`);
      else if (verb === "RCPT") {
        if (replies.rcpt !== null) socket.write(`${replies.rcpt}\r\n`);
      } else if (verb === "DATA") {
        inData = true;
        socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
      } else if (verb === "RSET" || verb === "NOOP") socket.write("250 2.0.0 Ok\r\n");
      else if (verb === "QUIT") {
        socket.end("221 2.0.0 Bye\r\n");
        return;
      } else socket.write("502 5.5.2 Error: command not recognized\r\n");
    }
  });
  socket.on("close", () => {
    closedSockets += 1;
  });
  socket.on("error", () => {});
}

beforeAll(async () => {
  server = createServer(speak);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  Object.assign(replies, {
    mail: "250 2.1.0 Ok",
    rcpt: "250 2.1.5 Ok",
    auth: "235 2.7.0 Authenticated",
    data: "250 2.0.0 Ok: queued as ABC123",
  });
  received.length = 0;
  closedSockets = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

/** The real pooled transport the app builds, pointed at the fake server. */
async function sendThroughSmtp(url: string, to?: string, options: { timeoutMs?: number } = {}) {
  const smtp = parseSmtpUrl(url)!;
  const transport = smtpTransport({ smtp, from: FROM, replyTo: null });
  try {
    return await createMailer({ transport, from: FROM, ...options }).send(mail(to));
  } finally {
    transport.close?.();
  }
}

describe("sending over SMTP", () => {
  it("reports a message the server accepted as sent, with the message and its headers", async () => {
    const outcome = await sendThroughSmtp(`smtp://127.0.0.1:${port}`);
    expect(outcome).toMatchObject({ kind: "sent" });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatch(/^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
    expect(received[0]).toMatch(/^From: StudyOS <hello@studyos\.test>$/m);
    expect(received[0]).toMatch(/^To: student@example\.com$/m);
  });

  it("reports a recipient the server refused for good as rejected (stop emailing it)", async () => {
    replies.rcpt = "550 5.1.1 <student@example.com>: Recipient address rejected: User unknown";
    expect(await sendThroughSmtp(`smtp://127.0.0.1:${port}`)).toEqual({ kind: "rejected", code: 550 });
    expect(received).toHaveLength(0);
  });

  it("reports a deferral (4xx) as temporary", async () => {
    replies.rcpt = "451 4.3.0 Try again later";
    expect(await sendThroughSmtp(`smtp://127.0.0.1:${port}`)).toEqual({ kind: "temporary", code: 451, reason: "deferred" });
  });

  it("never blames the student for our own setup: bad login, refused sender, relay denied, test mode, DATA refusals", async () => {
    replies.auth = "535 5.7.8 Authentication credentials invalid";
    expect(await sendThroughSmtp(`smtp://user:wrong@127.0.0.1:${port}`)).toMatchObject({ kind: "temporary", reason: "config" });

    replies.auth = "235 2.7.0 Authenticated";
    replies.mail = "550 5.7.1 Sender address not verified";
    expect(await sendThroughSmtp(`smtp://127.0.0.1:${port}`)).toMatchObject({ kind: "temporary", reason: "config" });

    replies.mail = "250 2.1.0 Ok";
    replies.rcpt = "554 5.7.1 <student@example.com>: Relay access denied";
    expect(await sendThroughSmtp(`smtp://127.0.0.1:${port}`)).toMatchObject({ kind: "temporary", code: 554, reason: "refused" });

    replies.rcpt = "550 You can only send testing emails to your own email address";
    expect(await sendThroughSmtp(`smtp://127.0.0.1:${port}`)).toMatchObject({ kind: "temporary", code: 550, reason: "config" });

    replies.rcpt = "250 2.1.5 Ok";
    replies.data = "554 5.2.0 STOREDRV.Submission.Exception:SendAsDeniedException";
    expect(await sendThroughSmtp(`smtp://127.0.0.1:${port}`)).toMatchObject({ kind: "temporary", code: 554, reason: "config" });
  });

  it("reports a server that cannot be reached as temporary, without throwing", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expect(await sendThroughSmtp(`smtp://127.0.0.1:${deadPort}`)).toMatchObject({ kind: "temporary", reason: "network" });
  });

  it("gives up on a stalling server, closes the connection, and the message never goes out late", async () => {
    replies.rcpt = null;
    expect(await sendThroughSmtp(`smtp://127.0.0.1:${port}`, undefined, { timeoutMs: 300 })).toEqual({
      kind: "temporary",
      code: null,
      reason: "timeout",
    });
    // The connection is closed by the cancelled send (not left to finish later).
    await vi.waitFor(() => expect(closedSockets).toBeGreaterThan(0));
    replies.rcpt = "250 2.1.5 Ok";
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toHaveLength(0);
  });
});

describe("the mailer never throws", () => {
  it("turns a transport that throws, rejects or hangs into a temporary failure", async () => {
    const throwing: MailTransport = {
      sendMail: () => {
        throw new Error("boom");
      },
    };
    expect(await createMailer({ transport: throwing, from: FROM }).send(mail())).toMatchObject({ kind: "temporary" });

    const rejecting: MailTransport = { sendMail: async () => Promise.reject("not even an Error") };
    expect(await createMailer({ transport: rejecting, from: FROM }).send(mail())).toMatchObject({ kind: "temporary", reason: "error" });

    const hanging: MailTransport = { sendMail: () => new Promise(() => {}) };
    expect(await createMailer({ transport: hanging, from: FROM, timeoutMs: 20 }).send(mail())).toEqual({
      kind: "temporary",
      code: null,
      reason: "timeout",
    });
  });

  it("builds the message nodemailer sends: sender, reply-to, one-line subject, both parts, custom headers", async () => {
    const json = nodemailer.createTransport({ jsonTransport: true });
    let info: { message: string } | null = null;
    const transport: MailTransport = {
      sendMail: async (message) => (info = (await json.sendMail(message)) as { message: string }),
    };
    const outcome = await createMailer({ transport, from: FROM, replyTo: "help@studyos.test" }).send({
      ...mail(),
      subject: "Line one\nBcc: someone@else.test",
    });
    expect(outcome.kind).toBe("sent");
    const sent = JSON.parse(info!.message);
    expect(sent.from).toEqual({ address: "hello@studyos.test", name: "StudyOS" });
    expect(sent.replyTo).toEqual([{ address: "help@studyos.test", name: "" }]);
    expect(sent.to).toEqual([{ address: "student@example.com", name: "" }]);
    // A line break can never start a new header.
    expect(sent.subject).toBe("Line one Bcc: someone@else.test");
    expect(sent.text).toBe("Start here.");
    expect(sent.html).toBe("<p>Start here.</p>");
    expect(sent.headers).toMatchObject({ "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  });

  it("does not report a partially refused recipient list as sent", async () => {
    const partial: MailTransport = {
      sendMail: async () => ({
        messageId: "<m@x>",
        accepted: [],
        rejected: ["student@example.com"],
        rejectedErrors: [{ responseCode: 550, command: "RCPT TO", response: "550 5.1.1 User unknown" }],
      }),
    };
    expect(await createMailer({ transport: partial, from: FROM }).send(mail())).toEqual({ kind: "rejected", code: 550 });
    // Without the server's words, it is not taken as the recipient's fault.
    const silent: MailTransport = { sendMail: async () => ({ accepted: [], rejected: ["student@example.com"] }) };
    expect(await createMailer({ transport: silent, from: FROM }).send(mail())).toMatchObject({ kind: "temporary" });
  });
});

describe("time limits", () => {
  /** A transport whose sends each take `ms` (fake timers), recording what it was given. */
  function slowTransport(ms: number) {
    const calls: { signal: AbortSignal }[] = [];
    const transport: MailTransport & { closed: number } = {
      closed: 0,
      sendMail: (message) => {
        calls.push({ signal: message.signal as AbortSignal });
        return new Promise((resolve) => setTimeout(() => resolve({ messageId: `<${calls.length}@x>` }), ms));
      },
      close() {
        transport.closed += 1;
      },
    };
    return { transport, calls };
  }

  it("count from the moment a send is handed to a connection, not from when it was queued", async () => {
    vi.useFakeTimers();
    const { transport } = slowTransport(40);
    const mailer = createMailer({ transport, from: FROM, timeoutMs: 50, maxInFlight: 1, queueTimeoutMs: 1_000 });
    const first = mailer.send(mail("a@example.com"));
    const second = mailer.send(mail("b@example.com"));
    // 80 ms in all, but each send took 40 ms once it was its turn.
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toMatchObject({ kind: "sent" });
    expect(await second).toMatchObject({ kind: "sent" });
  });

  it("let at most maxInFlight sends run at once, and give up without sending after waiting too long for a turn", async () => {
    vi.useFakeTimers();
    const { transport, calls } = slowTransport(10_000);
    const mailer = createMailer({ transport, from: FROM, timeoutMs: 60_000, maxInFlight: 2, queueTimeoutMs: 100 });
    const sends = [mailer.send(mail("a@example.com")), mailer.send(mail("b@example.com")), mailer.send(mail("c@example.com"))];
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    // Never handed over, so never sent.
    expect(await sends[2]).toEqual({ kind: "temporary", code: null, reason: "timeout" });
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await sends[0]).toMatchObject({ kind: "sent" });
    expect(await sends[1]).toMatchObject({ kind: "sent" });
  });

  it("cancel a send that runs out of time, close the stalled pool and build a fresh one for the next send", async () => {
    vi.useFakeTimers();
    const built: (MailTransport & { closed: number })[] = [];
    const calls: { signal: AbortSignal }[] = [];
    const factory = () => {
      const t: MailTransport & { closed: number } = {
        closed: 0,
        sendMail: (message) => {
          calls.push({ signal: message.signal as AbortSignal });
          // The first transport stalls; the fresh one answers.
          return built.length === 1 ? new Promise(() => {}) : Promise.resolve({ messageId: "<ok@x>" });
        },
        close() {
          t.closed += 1;
        },
      };
      built.push(t);
      return t;
    };
    const mailer = createMailer({ transport: factory, from: FROM, timeoutMs: 15_000 });
    const stalled = mailer.send(mail());
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await stalled).toEqual({ kind: "temporary", code: null, reason: "timeout" });
    expect(calls[0].signal.aborted).toBe(true);
    expect(built[0].closed).toBe(1);
    expect(await mailer.send(mail())).toMatchObject({ kind: "sent" });
    expect(built).toHaveLength(2);
    expect(calls[1].signal.aborted).toBe(false);
  });
});

describe("what an SMTP failure means", () => {
  const at = (command: string, response: string, code = command.startsWith("RCPT") ? "EENVELOPE" : "EMESSAGE") => ({
    code,
    responseCode: Number(response.slice(0, 3)),
    command,
    response,
  });

  it("is a permanent rejection only for an answer to RCPT TO that names the mailbox", () => {
    expect(classifySmtpError(at("RCPT TO", "550 5.1.1 user unknown"))).toEqual({ kind: "rejected", code: 550 });
    expect(classifySmtpError(at("RCPT TO", "550 5.1.1 <a@b.c>: Recipient address rejected: User unknown in virtual mailbox table"))).toEqual({ kind: "rejected", code: 550 });
    expect(classifySmtpError(at("RCPT TO", "550 No such user here"))).toEqual({ kind: "rejected", code: 550 });
    expect(classifySmtpError(at("RCPT TO", "550-5.1.1 The email account that you tried to reach does not exist."))).toEqual({ kind: "rejected", code: 550 });
    expect(classifySmtpError(at("RCPT TO", "550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup"))).toEqual({ kind: "rejected", code: 550 });
    expect(classifySmtpError(at("RCPT TO", "550 5.2.1 Mailbox disabled"))).toEqual({ kind: "rejected", code: 550 });
    expect(classifySmtpError(at("RCPT TO", "550 Requested action not taken: mailbox unavailable"))).toEqual({ kind: "rejected", code: 550 });
  });

  it("is our setup (temporary, reported) for everything else that is not plainly the recipient's", () => {
    const reason = (e: object) => {
      const outcome = classifySmtpError(e);
      return outcome.kind === "temporary" ? outcome.reason : outcome.kind;
    };
    // The message refused as a whole, after DATA: never the recipient.
    expect(reason(at("DATA", "554 5.2.0 STOREDRV.Submission.Exception:SendAsDeniedException"))).toBe("config");
    expect(reason(at("DATA", "550 5.2.1 Mailbox disabled"))).toBe("config");
    // Our message too large.
    expect(reason(at("DATA", "552 5.2.3 Message size exceeds fixed maximum message size"))).toBe("config");
    expect(reason(at("RCPT TO", "552 5.2.3 Message size exceeds fixed maximum message size"))).toBe("config");
    // Our sender, refused at RCPT.
    expect(reason(at("RCPT TO", "550 5.1.8 Sender address rejected: Domain not found"))).toBe("config");
    // The provider's test mode.
    expect(reason(at("RCPT TO", "550 You can only send testing emails to your own email address"))).toBe("config");
    // Relaying not allowed for us (qmail's wording, no enhanced code).
    expect(reason(at("RCPT TO", "553 sorry, that domain isn't in my list of allowed rcpthosts (#5.7.1)"))).toBe("config");
    // Policy (5.7.x) and spam blocks.
    expect(reason(at("RCPT TO", "550 5.7.1 Service unavailable; client host blocked"))).toBe("refused");
    expect(reason(at("RCPT TO", "550 Message rejected as spam"))).toBe("refused");
    expect(reason(at("DATA", "554 5.7.1 Blocked by policy"))).toBe("refused");
    // A 5xx at RCPT that says nothing about the mailbox.
    expect(reason(at("RCPT TO", "554 Transaction failed"))).toBe("config");
    expect(reason(at("RCPT TO", "550 5.4.1 Recipient address rejected: Access denied"))).toBe("config");
    // Recipient words never win over words about us.
    expect(reason(at("RCPT TO", "550 5.1.1 Sender verify failed: user unknown"))).toBe("config");
  });

  it("is temporary for 4xx, 503, a full mailbox, a timeout, and our own login", () => {
    const temporary = (e: object) => classifySmtpError(e).kind;
    expect(temporary({ responseCode: 421, command: "CONN", response: "421 Service not available" })).toBe("temporary");
    expect(temporary({ responseCode: 503, command: "RCPT TO", response: "503 5.5.1 Bad sequence" })).toBe("temporary");
    expect(classifySmtpError(at("RCPT TO", "552 5.2.2 Mailbox full"))).toEqual({ kind: "temporary", code: 552, reason: "deferred" });
    expect(temporary({ code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" })).toBe("temporary");
    expect(temporary({ responseCode: 550, command: "MAIL FROM", response: "550 Sender rejected" })).toBe("temporary");
    expect(classifySmtpError({ code: "ETIMEDOUT" })).toMatchObject({ reason: "timeout" });
    expect(classifySmtpError({ code: "EAUTH" })).toMatchObject({ reason: "config" });
    expect(classifySmtpError(null)).toMatchObject({ kind: "temporary", reason: "error" });
  });
});
