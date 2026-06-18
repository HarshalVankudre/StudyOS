"use client";

import { useClerk } from "@clerk/nextjs";

/** Opens Clerk's account manager (name, email, password, security, sessions). */
export function ManageAccountButton({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { openUserProfile } = useClerk();
  return (
    <button type="button" onClick={() => openUserProfile()} className={className}>
      {children}
    </button>
  );
}
