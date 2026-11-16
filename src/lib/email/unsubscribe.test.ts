// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  signUnsubscribeToken,
  unsubscribeKey,
  unsubscribeKeys,
  unsubscribeOrigin,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from "./unsubscribe";

const key = unsubscribeKey({ CLERK_SECRET_KEY: "sk_test_unsubscribe" })!;
const otherKey = unsubscribeKey({ CLERK_SECRET_KEY: "sk_test_another" })!;

describe("unsubscribe tokens", () => {
  it("name the student they were made for, and verify with the same key", () => {
    const token = signUnsubscribeToken("user_2abcDEF", key);
    expect(verifyUnsubscribeToken(token, key)).toBe("user_2abcDEF");
    // Stable: the link in an old email keeps working.
    expect(signUnsubscribeToken("user_2abcDEF", key)).toBe(token);
    // URL-safe as it is.
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  });

  it("never carry an address", () => {
    expect(Buffer.from(signUnsubscribeToken("user_1", key).split(".")[0], "base64url").toString()).toBe("user_1");
  });

  it("refuse a tampered, swapped, truncated or foreign token", () => {
    const token = signUnsubscribeToken("user_1", key);
    const [id, sig] = token.split(".");
    const other = signUnsubscribeToken("user_2", key);
    // Another student's id with this signature.
    expect(verifyUnsubscribeToken(`${other.split(".")[0]}.${sig}`, key)).toBeNull();
    // One character of the signature changed.
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    expect(verifyUnsubscribeToken(`${id}.${flipped}`, key)).toBeNull();
    expect(verifyUnsubscribeToken(token.slice(0, -1), key)).toBeNull();
    expect(verifyUnsubscribeToken(`${id}.`, key)).toBeNull();
    expect(verifyUnsubscribeToken(`${token}.x`, key)).toBeNull();
    // Signed under another server secret.
    expect(verifyUnsubscribeToken(token, otherKey)).toBeNull();
    for (const bad of [null, undefined, "", "user_1", "a.b", "%%%.%%%"]) expect(verifyUnsubscribeToken(bad, key)).toBeNull();
  });

  it("are useless without the server secret", () => {
    expect(unsubscribeKey({})).toBeNull();
    expect(verifyUnsubscribeToken(signUnsubscribeToken("user_1", key), null)).toBeNull();
  });

  it("are keyed for this purpose only, not with the Clerk secret itself", () => {
    expect(key.equals(Buffer.from("sk_test_unsubscribe"))).toBe(false);
    expect(key).toHaveLength(32);
  });

  it("make an absolute link on the app's origin", () => {
    expect(unsubscribeUrl("https://app.studyos.test", "user_1", key)).toBe(
      `https://app.studyos.test/api/notifications/unsubscribe?t=${signUnsubscribeToken("user_1", key)}`,
    );
  });
});

describe("unsubscribe keys and rotation", () => {
  const CLERK = { CLERK_SECRET_KEY: "sk_test_clerk_one" };
  const OWN = "an-own-unsubscribe-secret-of-32-chars-or-more";
  const NEXT = "the-next-unsubscribe-secret-after-a-rotation!!";

  it("sign with UNSUBSCRIBE_SECRET when it is set, else with the Clerk-derived key", () => {
    expect(unsubscribeKey(CLERK)!.equals(unsubscribeKey({ CLERK_SECRET_KEY: "sk_test_clerk_one" })!)).toBe(true);
    const own = unsubscribeKey({ ...CLERK, UNSUBSCRIBE_SECRET: OWN })!;
    expect(own.equals(unsubscribeKey(CLERK)!)).toBe(false);
    // Its own derivation: never the raw secret.
    expect(own.equals(Buffer.from(OWN))).toBe(false);
    expect(own).toHaveLength(32);
  });

  it("keep links already sent working when UNSUBSCRIBE_SECRET is introduced", () => {
    const old = signUnsubscribeToken("user_1", unsubscribeKey(CLERK)!);
    const env = { ...CLERK, UNSUBSCRIBE_SECRET: OWN };
    expect(verifyUnsubscribeToken(old, unsubscribeKeys(env))).toBe("user_1");
    expect(verifyUnsubscribeToken(signUnsubscribeToken("user_1", unsubscribeKey(env)!), unsubscribeKeys(env))).toBe("user_1");
  });

  it("keep links working across a rotation of UNSUBSCRIBE_SECRET (old value in _PREVIOUS)", () => {
    const before = { ...CLERK, UNSUBSCRIBE_SECRET: OWN };
    const sent = signUnsubscribeToken("user_1", unsubscribeKey(before)!);
    const after = { ...CLERK, UNSUBSCRIBE_SECRET: NEXT, UNSUBSCRIBE_SECRET_PREVIOUS: OWN };
    expect(verifyUnsubscribeToken(sent, unsubscribeKeys(after))).toBe("user_1");
    // Dropped from _PREVIOUS: those links stop working.
    expect(verifyUnsubscribeToken(sent, unsubscribeKeys({ ...CLERK, UNSUBSCRIBE_SECRET: NEXT }))).toBeNull();
  });

  it("keep links working across a rotation of the Clerk key once UNSUBSCRIBE_SECRET is set", () => {
    const sent = signUnsubscribeToken("user_1", unsubscribeKey({ ...CLERK, UNSUBSCRIBE_SECRET: OWN })!);
    expect(verifyUnsubscribeToken(sent, unsubscribeKeys({ CLERK_SECRET_KEY: "sk_test_clerk_two", UNSUBSCRIBE_SECRET: OWN }))).toBe("user_1");
  });

  it("still refuse a link signed with none of the keys", () => {
    const foreign = signUnsubscribeToken("user_1", unsubscribeKey({ UNSUBSCRIBE_SECRET: "someone-else-entirely-0123456789" })!);
    expect(verifyUnsubscribeToken(foreign, unsubscribeKeys({ ...CLERK, UNSUBSCRIBE_SECRET: OWN }))).toBeNull();
    expect(verifyUnsubscribeToken(foreign, [])).toBeNull();
    expect(unsubscribeKeys({})).toEqual([]);
  });
});

describe("the origin of the link", () => {
  it("is the app's own origin: APP_URL, or the app origin where the website split names one", () => {
    expect(unsubscribeOrigin({ APP_URL: "https://app.studyos.test/" })).toBe("https://app.studyos.test");
    expect(unsubscribeOrigin({ NEXT_PUBLIC_APP_URL: "https://app.studyos.test" })).toBe("https://app.studyos.test");
    // APP_URL is the website here, whose /api/* only redirects: mail apps would not follow.
    expect(unsubscribeOrigin({ APP_URL: "https://studyos.test", STUDYOS_APP_ORIGIN: "https://app.studyos.test" })).toBe(
      "https://app.studyos.test",
    );
    // A malformed app origin is ignored here (the startup check reports it).
    expect(unsubscribeOrigin({ APP_URL: "https://app.studyos.test", STUDYOS_APP_ORIGIN: "not a url" })).toBe("https://app.studyos.test");
  });
});
