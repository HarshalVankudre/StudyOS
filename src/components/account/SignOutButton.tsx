"use client";

import { useClerk } from "@clerk/nextjs";
import { useState } from "react";
import { clearPushBeforeSignOut } from "@/components/notifications/push-client";

/**
 * Sign out, after turning this device's notifications off (browser and
 * server), so the next person on a shared device does not get this
 * student's reminders. The cleanup is bounded: signing out always happens.
 */
export function useSignOutWithCleanup(redirectUrl = "/") {
  const { signOut } = useClerk();
  const [pending, setPending] = useState(false);
  const run = async () => {
    if (pending) return;
    setPending(true);
    // Never let the cleanup stand in the way of signing out.
    await clearPushBeforeSignOut().catch(() => undefined);
    await signOut({ redirectUrl });
  };
  return { signOut: run, pending };
}

export function SignOutButton({ label, className }: { label: string; className?: string }) {
  const { signOut, pending } = useSignOutWithCleanup("/");
  return (
    <button type="button" onClick={() => void signOut()} disabled={pending} aria-busy={pending} className={className}>
      {label}
    </button>
  );
}
