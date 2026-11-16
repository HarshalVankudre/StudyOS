import { describe, expect, it } from "vitest";
import { emailConfig, emailConfigured, parseMailbox, parseSmtpUrl, smtpUrlProblem } from "./config";

describe("SMTP_URL", () => {
  it("reads smtps (TLS from the start) and smtp (STARTTLS required off localhost), with default ports", () => {
    expect(parseSmtpUrl("smtps://user%40example.com:p%3Ass%2Fw@smtp.example.com:465")).toEqual({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: "user@example.com", pass: "p:ss/w" },
    });
    expect(parseSmtpUrl("smtp://apikey:secret@smtp.example.com")).toMatchObject({ port: 587, secure: false, requireTLS: true });
    expect(parseSmtpUrl("smtps://smtp.example.com")).toMatchObject({ port: 465, auth: null });
    // A local test server (Mailpit, a fake in tests) needs no TLS.
    expect(parseSmtpUrl("smtp://localhost:1025")).toMatchObject({ host: "localhost", requireTLS: false });
    expect(parseSmtpUrl("smtp://127.0.0.1:2525")).toMatchObject({ requireTLS: false });
  });

  it("refuses anything that is not an smtp(s) URL with a host, and says why", () => {
    for (const bad of [undefined, "", "   ", "smtp.example.com:587", "https://smtp.example.com", "smtp://", "smtps://:465", "smtp://host:99999", "smtp://u:p@"]) {
      expect(parseSmtpUrl(bad), String(bad)).toBeNull();
      expect(smtpUrlProblem(bad), String(bad)).toEqual(expect.any(String));
    }
    expect(smtpUrlProblem("https://smtp.example.com")).toMatch(/smtp:\/\/ or smtps:\/\//);
    expect(smtpUrlProblem("smtp://host:99999")).toMatch(/host or port/);
    expect(smtpUrlProblem("smtps://u:p@smtp.example.com:465")).toBeNull();
  });

  it("reads a password with an unencoded /, +, %, : or @ as written, never throwing", () => {
    expect(parseSmtpUrl("smtps://apikey:ab/cd+ef%gh@smtp.example.com:465")).toMatchObject({
      host: "smtp.example.com",
      port: 465,
      auth: { user: "apikey", pass: "ab/cd+ef%gh" },
    });
    expect(parseSmtpUrl("smtp://user@example.com:p@ss:w?rd#1@smtp.example.com:2525")).toMatchObject({
      host: "smtp.example.com",
      port: 2525,
      auth: { user: "user@example.com", pass: "p@ss:w?rd#1" },
    });
    // Valid escapes are decoded; a broken one is kept as written.
    expect(parseSmtpUrl("smtp://u:%E0%A4%A@host")).toMatchObject({ host: "host", auth: { user: "u", pass: "%E0%A4%A" } });
    expect(parseSmtpUrl("smtp://u:100%25%2Bsure@host")).toMatchObject({ auth: { pass: "100%+sure" } });
    expect(parseSmtpUrl("smtp://u:caf%C3%A9@host")).toMatchObject({ auth: { pass: "café" } });
  });
});

describe("MAIL_FROM", () => {
  it("takes a bare address or a display name with an address", () => {
    expect(parseMailbox("hello@example.com")).toEqual({ name: null, address: "hello@example.com" });
    expect(parseMailbox("StudyOS <hello@example.com>")).toEqual({ name: "StudyOS", address: "hello@example.com" });
    expect(parseMailbox('"StudyOS Team" <hello@example.com>')).toEqual({ name: "StudyOS Team", address: "hello@example.com" });
  });

  it("refuses a missing address and anything that could inject a header", () => {
    for (const bad of [undefined, "", "StudyOS", "StudyOS <not-an-address>", "Study\nBcc: x@y.z <a@b.co>", "a <b> <c@d.ef>"]) {
      expect(parseMailbox(bad), String(bad)).toBeNull();
    }
  });
});

describe("email configuration", () => {
  const env = { SMTP_URL: "smtps://u:p@smtp.example.com:465", MAIL_FROM: "StudyOS <hello@example.com>" };

  it("is on only when both are set and readable", () => {
    expect(emailConfigured(env)).toBe(true);
    expect(emailConfigured({ ...env, SMTP_URL: "" })).toBe(false);
    expect(emailConfigured({ ...env, MAIL_FROM: undefined })).toBe(false);
    expect(emailConfigured({ ...env, SMTP_URL: "nonsense" })).toBe(false);
    expect(emailConfigured({ ...env, MAIL_FROM: "nobody" })).toBe(false);
    expect(emailConfigured({})).toBe(false);
  });

  it("keeps a valid Reply-To and drops an invalid one", () => {
    expect(emailConfig({ ...env, MAIL_REPLY_TO: "help@example.com" })?.replyTo).toBe("help@example.com");
    expect(emailConfig({ ...env, MAIL_REPLY_TO: "help" })?.replyTo).toBeNull();
    expect(emailConfig(env)?.replyTo).toBeNull();
  });
});
