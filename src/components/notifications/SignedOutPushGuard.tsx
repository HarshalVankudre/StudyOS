"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { dropPushWhenSignedOut } from "./push-client";

/**
 * Renders nothing. When this browser is signed out, it drops any StudyOS push
 * subscription left behind, so a student's reminders never reach the next
 * person on a shared device. Our own sign-out buttons clean up before signing
 * out (see clearPushBeforeSignOut); this covers every other way a session
 * ends: Clerk's own user menu, another tab, an expired or revoked session.
 */
export function SignedOutPushGuard() {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (isLoaded && !isSignedIn) void dropPushWhenSignedOut();
  }, [isLoaded, isSignedIn]);
  return null;
}
