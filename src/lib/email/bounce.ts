/**
 * Which address a recorded refusal was about, without storing the address:
 * `emailBouncedHash` is HMAC-SHA256 of the normalized address (trimmed, lower
 * case) under a key derived from CLERK_SECRET_KEY for this purpose only
 * (lib/ops/secret.ts derivedServerKey). The same address always gives the
 * same hash, so a refusal stops email to THAT address only: once the
 * student's primary address is another one, the refusal no longer applies.
 *
 * Rotating CLERK_SECRET_KEY changes every hash, so recorded refusals stop
 * matching and those addresses get one more email each (refused again, and
 * recorded again under the new key). A refusal recorded without a hash (from
 * before the column existed, or with no server secret) applies to any address.
 */
import "server-only";

import { createHmac } from "node:crypto";
import { derivedServerKey } from "@/lib/ops/secret";

const PURPOSE = "email-bounce:v1";

/** The hash stored with a refusal of `address`, or null when there is no server secret. */
export function bounceHash(address: string, env: Record<string, string | undefined> = process.env): string | null {
  const key = derivedServerKey(PURPOSE, env);
  if (!key) return null;
  return createHmac("sha256", key).update(address.trim().toLowerCase()).digest("base64url");
}

/** Does a refusal recorded with `storedHash` stop email to `address`? */
export function refusalApplies(
  storedHash: string | null,
  address: string,
  hash: (address: string) => string | null = bounceHash,
): boolean {
  if (!storedHash) return true;
  const current = hash(address);
  return current === null || current === storedHash;
}
