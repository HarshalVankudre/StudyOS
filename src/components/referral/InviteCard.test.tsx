import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InviteCard, type InviteCardProps } from "./InviteCard";

const props = (note: string | null = null): InviteCardProps => ({
  link: "https://app.example.com/r/K7MPQ2XR",
  messages: {
    howItWorks: "You both get 100 credits when your friend builds their first workspace.",
    linkLabel: "Your invite link",
    copy: "Copy link",
    copied: "Copied",
    share: "Share",
    shareText: "Join me",
    joined: "Friends joined",
    rewarded: "Rewarded",
    earned: "Credits earned",
    note,
  },
  stats: { joined: "3", rewarded: "2", earned: "200" },
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "share");
});

describe("InviteCard", () => {
  it("shows the link, how it works and what invites earned", () => {
    render(<InviteCard {...props()} />);
    expect(screen.getByLabelText("Your invite link")).toHaveValue("https://app.example.com/r/K7MPQ2XR");
    // The link reads left to right in RTL languages too.
    expect(screen.getByLabelText("Your invite link")).toHaveAttribute("dir", "ltr");
    expect(screen.getByText(/You both get 100 credits/)).toBeInTheDocument();
    expect(screen.getByText("Friends joined").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Rewarded").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Credits earned").nextSibling).toHaveTextContent("200");
    expect(screen.queryByTestId("invite-cap-note")).toBeNull();
  });

  it("copies the link", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<InviteCard {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith("https://app.example.com/r/K7MPQ2XR");
  });

  it("offers the share sheet only where the device has one", async () => {
    render(<InviteCard {...props()} />);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const { unmount } = render(<InviteCard {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({ title: "StudyOS", text: "Join me", url: "https://app.example.com/r/K7MPQ2XR" }),
    );
    unmount();
  });

  it("says when the cap is reached", () => {
    render(<InviteCard {...props("You’ve reached the invite limit.")} />);
    expect(screen.getByTestId("invite-cap-note")).toHaveTextContent("You’ve reached the invite limit.");
  });

  it("while invites are paused, says so and offers no link, but still shows what invites earned", () => {
    render(<InviteCard {...props("Invites are paused for now.")} paused />);
    expect(screen.getByTestId("invite-paused")).toHaveTextContent("Invites are paused for now.");
    expect(screen.queryByLabelText("Your invite link")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.queryByText(/You both get 100 credits/)).toBeNull();
    expect(screen.getByText("Credits earned").nextSibling).toHaveTextContent("200");
  });
});
