import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

function Simple({ label = "Open" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>{label}</button>
      <button>Elsewhere</button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent showCloseButton={false}>
            <DialogTitle>Sheet</DialogTitle>
            <DialogDescription>Body</DialogDescription>
            <button>First</button>
            <button onClick={() => setOpen(false)}>Done</button>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** A hub dialog whose button swaps it for a second dialog, like the study hub starting a session. */
function HubThenSession({ withFallback = false }: { withFallback?: boolean }) {
  const [hub, setHub] = useState(false);
  const [session, setSession] = useState(false);
  const [showDue, setShowDue] = useState(true);
  const hubButton = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={hubButton} onClick={() => setHub(true)}>
        Hub
      </button>
      {showDue && <button onClick={() => setSession(true)}>Study due</button>}
      {hub && (
        <Dialog open onOpenChange={(o) => !o && setHub(false)}>
          <DialogContent>
            <DialogTitle>Hub</DialogTitle>
            <DialogDescription>Hub body</DialogDescription>
            <button
              onClick={() => {
                setHub(false);
                setSession(true);
              }}
            >
              Start
            </button>
          </DialogContent>
        </Dialog>
      )}
      {session && (
        <Dialog open onOpenChange={(o) => !o && setSession(false)}>
          <DialogContent returnFocus={withFallback ? () => hubButton.current : undefined}>
            <DialogTitle>Session</DialogTitle>
            <DialogDescription>Cards</DialogDescription>
            <button onClick={() => setShowDue(false)}>Finish last card</button>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

describe("DialogContent focus", () => {
  it("returns focus to the button that opened it when closed with Escape", async () => {
    const user = userEvent.setup();
    render(<Simple />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Open" })).toHaveFocus());
  });

  it("returns focus after closing from a button inside", async () => {
    const user = userEvent.setup();
    render(<Simple />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Open" })).toHaveFocus());
  });

  it("keeps Tab inside the open dialog", async () => {
    const user = userEvent.setup();
    render(<Simple />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    for (let i = 0; i < 4; i++) {
      await user.tab();
      expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("returns to what opened the first dialog when one dialog replaces another", async () => {
    const user = userEvent.setup();
    render(<HubThenSession />);
    await user.click(screen.getByRole("button", { name: "Hub" }));
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByRole("dialog", { name: "Session" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Hub" })).toHaveFocus());
  });

  it("uses returnFocus when the opener is gone", async () => {
    const user = userEvent.setup();
    render(<HubThenSession withFallback />);
    await user.click(screen.getByRole("button", { name: "Study due" }));
    await user.click(screen.getByRole("button", { name: "Finish last card" }));
    expect(screen.queryByRole("button", { name: "Study due" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Hub" })).toHaveFocus());
  });

  it("does not take focus back from a dialog that opened as this one closed", async () => {
    const user = userEvent.setup();
    render(<HubThenSession />);
    await user.click(screen.getByRole("button", { name: "Hub" }));
    await user.click(screen.getByRole("button", { name: "Start" }));
    // The hub's own close ran after the session opened: focus stays inside the session.
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.getByRole("dialog", { name: "Session" })).toContainElement(document.activeElement as HTMLElement);
  });
});

describe("Dialog close button", () => {
  it("names the close button in the student's language", async () => {
    const { I18nProvider } = await import("@/lib/i18n/client");
    const { de } = await import("@/lib/i18n/dictionaries/de");
    render(
      <I18nProvider locale="de" dictionary={de}>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Titel</DialogTitle>
            <DialogDescription>Text</DialogDescription>
          </DialogContent>
        </Dialog>
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Schließen" })).toBeInTheDocument();
  });

  it("falls back to English outside the app's language provider", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Text</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
