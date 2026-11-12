// @vitest-environment node
import { createECDH } from "node:crypto";
import { describe, expect, it } from "vitest";
import { vapidConfig, validSubject } from "./config";
import { checkSubscription, deviceLabel, endpointHash, isAllowedPushEndpoint } from "./endpoint";
import { b64url, generateVapidKeys } from "./webpush";

const browserKey = () => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return b64url(ecdh.getPublicKey());
};

describe("push endpoint allowlist", () => {
  it("accepts the push services browsers use", () => {
    for (const url of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
      "https://web.push.apple.com/QGx",
      "https://wns2-par02p.notify.windows.com/w/?token=x",
    ]) {
      expect(isAllowedPushEndpoint(url), url).toBe(true);
    }
  });

  it("rejects anything else (no requests into other networks)", () => {
    for (const url of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilfcm.googleapis.com.example/x",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/push",
      "https://user:pass@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "not a url",
    ]) {
      expect(isAllowedPushEndpoint(url), url).toBe(false);
    }
  });

  it("validates a browser subscription", () => {
    const ok = checkSubscription({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: browserKey(), auth: b64url(Buffer.alloc(16, 1)) },
    });
    expect(ok.ok).toBe(true);
    expect(checkSubscription({ endpoint: "https://example.com/x", keys: { p256dh: browserKey(), auth: b64url(Buffer.alloc(16)) } })).toEqual({
      ok: false,
      reason: "endpoint_not_allowed",
    });
    expect(
      checkSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: b64url(Buffer.alloc(65, 4)), auth: b64url(Buffer.alloc(16)) } }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(checkSubscription({ endpoint: "https://fcm.googleapis.com/x" })).toEqual({ ok: false, reason: "invalid" });
  });

  it("hashes endpoints and labels devices without detail", () => {
    expect(endpointHash("https://fcm.googleapis.com/a")).toMatch(/^[0-9a-f]{64}$/);
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iPhone");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0")).toBe("Edge · Windows");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36")).toBe("Chrome · Android");
    expect(deviceLabel(null)).toBe("");
  });
});

describe("VAPID configuration", () => {
  const keys = generateVapidKeys();

  it("is on only with a matching key pair and a valid subject", () => {
    expect(vapidConfig({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:ops@studyos.app" })).toEqual({
      ...keys,
      subject: "mailto:ops@studyos.app",
    });
    expect(vapidConfig({})).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey })).toBeNull();
    expect(
      vapidConfig({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: generateVapidKeys().privateKey, VAPID_SUBJECT: "mailto:a@b.c" }),
    ).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: "garbage", VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:a@b.c" })).toBeNull();
  });

  it("requires a mailto: or public https: subject", () => {
    expect(validSubject("mailto:ops@studyos.app")).toBe(true);
    expect(validSubject("https://studyos.app")).toBe(true);
    expect(validSubject("https://localhost")).toBe(false);
    expect(validSubject("ops@studyos.app")).toBe(false);
  });
});
