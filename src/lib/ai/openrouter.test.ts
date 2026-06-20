// src/lib/ai/openrouter.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatCompletion } from "./openrouter";

function mockOk(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("chatCompletion", () => {
  it("includes temperature in the body when provided", async () => {
    const fetchMock = mockOk("hi");
    vi.stubGlobal("fetch", fetchMock);
    await chatCompletion("m", [{ role: "user", content: "x" }], 100, { temperature: 0.4 });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.temperature).toBe(0.4);
  });

  it("omits temperature when not provided", async () => {
    const fetchMock = mockOk("hi");
    vi.stubGlobal("fetch", fetchMock);
    await chatCompletion("m", [{ role: "user", content: "x" }], 100);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect("temperature" in body).toBe(false);
  });
});
