// Signing out or deleting the account first turns this device's notifications
// off, so the next person on a shared device does not see the student's
// assignment and exam titles (security review 2, item 13).
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  order: [] as string[],
  signOut: vi.fn(),
  clear: vi.fn(),
  drop: vi.fn(),
  del: vi.fn(),
  auth: { isLoaded: true, isSignedIn: false },
}));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { fullName: "Sam", firstName: "Sam", primaryEmailAddress: { emailAddress: "s@uni.edu" } } }),
  useClerk: () => ({ openUserProfile: vi.fn(), signOut: m.signOut }),
  useAuth: () => m.auth,
}));
vi.mock("@/components/notifications/push-client", () => ({
  clearPushBeforeSignOut: m.clear,
  dropPushWhenSignedOut: m.drop,
}));
vi.mock("@/app/app/account-actions", () => ({
  getAccountSummaryAction: async () => ({ pro: false, credits: 3 }),
  deleteAccountAction: m.del,
}));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return {
    useI18n: () => ({
      dict: en,
      t: (s: string) => s,
      plural: (forms: { other: string }) => forms.other,
      locale: "en",
      dir: "ltr",
    }),
  };
});

import { en } from "@/lib/i18n/dictionaries/en";
import { SignedOutPushGuard } from "@/components/notifications/SignedOutPushGuard";
import { AccountMenu } from "./AccountMenu";
import { DeleteAccountButton } from "./DeleteAccountButton";
import { SignOutButton } from "./SignOutButton";

beforeEach(() => {
  m.order.length = 0;
  m.signOut.mockReset().mockImplementation(async () => void m.order.push("signOut"));
  m.clear.mockReset().mockImplementation(async () => void m.order.push("clearPush"));
  m.drop.mockReset().mockResolvedValue(false);
  m.del.mockReset().mockImplementation(async () => void m.order.push("delete"));
  m.auth = { isLoaded: true, isSignedIn: false };
});

describe("sign-out clears this device's notifications first", () => {
  it("the settings page button", async () => {
    render(<SignOutButton label="Sign out" />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(m.signOut).toHaveBeenCalledWith({ redirectUrl: "/" }));
    expect(m.order).toEqual(["clearPush", "signOut"]);
  });

  it("the account menu", async () => {
    render(<AccountMenu variant="sidebar" />);
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    await userEvent.click(screen.getByRole("menuitem", { name: new RegExp(en.account.signOut) }));
    await waitFor(() => expect(m.signOut).toHaveBeenCalled());
    expect(m.order).toEqual(["clearPush", "signOut"]);
  });

  it("still signs out when the cleanup fails", async () => {
    m.clear.mockRejectedValueOnce(new Error("boom"));
    render(<SignOutButton label="Sign out" />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(m.signOut).toHaveBeenCalled());
  });

  it("account deletion clears push before deleting", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeleteAccountButton />);
    await userEvent.click(screen.getByRole("button", { name: en.settings.deleteAccountButton }));
    await waitFor(() => expect(m.del).toHaveBeenCalled());
    expect(m.order).toEqual(["clearPush", "delete"]);
  });

  it("a signed-out browser drops a leftover subscription; a signed-in one keeps it", () => {
    const { rerender } = render(<SignedOutPushGuard />);
    expect(m.drop).toHaveBeenCalledTimes(1);
    m.auth = { isLoaded: true, isSignedIn: true };
    m.drop.mockClear();
    rerender(<SignedOutPushGuard />);
    expect(m.drop).not.toHaveBeenCalled();
    m.auth = { isLoaded: false, isSignedIn: false };
    rerender(<SignedOutPushGuard />);
    expect(m.drop).not.toHaveBeenCalled();
  });
});
