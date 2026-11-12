import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactArtifact } from "./ReactArtifact";

/**
 * The parent side of the frame handshake. jsdom never runs the frame, so the
 * frame's window is a stand-in whose postMessage is recorded, and messages
 * "from" it are dispatched on the parent window with that source.
 */
let frameWindow: { postMessage: ReturnType<typeof vi.fn> };
let getter: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  frameWindow = { postMessage: vi.fn() };
  getter = vi
    .spyOn(HTMLIFrameElement.prototype, "contentWindow", "get")
    .mockReturnValue(frameWindow as unknown as Window);
});
afterEach(() => getter.mockRestore());

function fromFrame(data: unknown, source: unknown = frameWindow) {
  const ev = new MessageEvent("message", { data });
  Object.defineProperty(ev, "source", { value: source });
  act(() => {
    window.dispatchEvent(ev);
  });
}

const sent = () => frameWindow.postMessage.mock.calls.map(([m]) => m as { type: string; source?: string });

describe("ReactArtifact handshake", () => {
  it("says hello when it starts listening, so a ready sent earlier is not lost", () => {
    render(<ReactArtifact source="function App(){return 1}" />);
    // The frame may have loaded (and said ready) before this listener existed.
    expect(sent()).toEqual([{ type: "hello" }]);
    fromFrame({ type: "ready" });
    expect(sent().at(-1)).toEqual({ type: "render", source: "function App(){return 1}" });
  });

  it("says hello again when the frame loads, and answers every ready", () => {
    const { container } = render(<ReactArtifact source="A" />);
    const iframe = container.querySelector("iframe")!;
    act(() => {
      iframe.dispatchEvent(new Event("load"));
    });
    expect(sent().filter((m) => m.type === "hello")).toHaveLength(2);
    fromFrame({ type: "ready" });
    fromFrame({ type: "ready" }); // the frame re-announced before our render reached it
    expect(sent().filter((m) => m.type === "render")).toHaveLength(2);
  });

  it("sends a new source to a frame that is already up", () => {
    const { rerender } = render(<ReactArtifact source="A" />);
    rerender(<ReactArtifact source="B" />);
    // Not ready yet: nothing to send to.
    expect(sent().some((m) => m.type === "render")).toBe(false);
    fromFrame({ type: "ready" });
    expect(sent().at(-1)).toEqual({ type: "render", source: "B" });
    rerender(<ReactArtifact source="C" />);
    expect(sent().at(-1)).toEqual({ type: "render", source: "C" });
  });

  it("ignores messages from any other window", () => {
    const { container } = render(<ReactArtifact source="A" />);
    fromFrame({ type: "ready" }, window);
    fromFrame({ type: "ready" }, { postMessage: vi.fn() });
    fromFrame({ type: "height", px: 900 }, window);
    expect(sent().some((m) => m.type === "render")).toBe(false);
    expect(container.querySelector("iframe")!.style.height).toBe("120px");
    fromFrame({ type: "height", px: 900 });
    expect(container.querySelector("iframe")!.style.height).toBe("900px");
  });

  it("keeps the frame sandboxed without same-origin access", () => {
    const { container } = render(<ReactArtifact source="A" />);
    expect(container.querySelector("iframe")!.getAttribute("sandbox")).toBe("allow-scripts");
  });
});
