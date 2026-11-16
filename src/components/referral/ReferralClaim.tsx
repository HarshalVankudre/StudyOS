"use client";

import { useEffect, useRef } from "react";
import { claimReferralAction } from "@/app/app/referral-actions";

/**
 * Rendered by the /app layout only while the invite cookie is present:
 * records the invite once (claimReferralAction), which also clears the
 * cookie. Shows nothing; a failure (offline, a deploy in between) is retried
 * on the next visit.
 */
export function ReferralClaim() {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    claimReferralAction().catch(() => {});
  }, []);
  return null;
}
