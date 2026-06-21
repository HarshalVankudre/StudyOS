import { describe, expect, it } from "vitest";
import { clampArtifactHeight, isFromIframe } from "./ReactArtifact";

describe("ReactArtifact helpers", () => {
  it("clamps height to a sane range", () => {
    expect(clampArtifactHeight(10)).toBe(60);
    expect(clampArtifactHeight(99999)).toBe(2000);
    expect(clampArtifactHeight(300)).toBe(300);
  });

  it("only accepts messages from our iframe's window", () => {
    const win = {} as Window;
    const iframe = { contentWindow: win } as HTMLIFrameElement;
    expect(isFromIframe({ source: win } as MessageEvent, iframe)).toBe(true);
    expect(isFromIframe({ source: {} as Window } as MessageEvent, iframe)).toBe(false);
    expect(isFromIframe({ source: win } as MessageEvent, null)).toBe(false);
  });
});
