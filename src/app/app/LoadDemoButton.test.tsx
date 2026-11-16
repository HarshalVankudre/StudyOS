import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoadDemoButton } from "./LoadDemoButton";

describe("LoadDemoButton", () => {
  it("runs the action once: the button is disabled while the demo is being made", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const action = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(
      <form action={action}>
        <LoadDemoButton label="Load a demo" />
      </form>,
    );
    const button = screen.getByRole("button", { name: "Load a demo" });
    await user.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    await user.click(button);
    expect(action).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(button).toBeEnabled());
  });
});
