import { beforeEach, describe, expect, it, vi } from "vitest";

const stream = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/openrouter", () => ({ streamChatCompletion: stream }));

import { modelComplete } from "./model";

describe("study-kit model call", () => {
  beforeEach(() => stream.mockReset().mockResolvedValue("{}"));

  it("asks for low effort in the form both providers read", async () => {
    await modelComplete("claude-haiku-5-5")("system", "user", { signal: new AbortController().signal, timeoutMs: 1000 });
    const options = stream.mock.calls[0][3];
    // Claude models read `effort`; OpenRouter models read `reasoning`.
    expect(options).toMatchObject({ effort: "low", reasoning: { effort: "low" } });
    // Thinking counts against max_tokens on Claude: the budget stays generous.
    expect(stream.mock.calls[0][2]).toBeGreaterThanOrEqual(10_000);
  });
});
