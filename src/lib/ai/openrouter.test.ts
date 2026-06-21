// src/lib/ai/openrouter.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatCompletion, streamChatCompletion } from "./openrouter";
import { withUsageMeter } from "./usage-meter";

function mockOk(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }),
  });
}

/** A Response-like object whose body streams the given SSE frames as chunks. */
function mockStream(lines: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return vi.fn().mockResolvedValue({ ok: true, body });
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

describe("streamChatCompletion", () => {
  it("accumulates content, surfaces reasoning, records usage, and stops at [DONE]", async () => {
    const fetchMock = mockStream([
      ": OPENROUTER PROCESSING\n", // keepalive comment — ignored
      'data: {"choices":[{"delta":{"reasoning":"Think "}}]}\n',
      'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"more."}]}}]}\n',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n',
      'data: {"usage":{"prompt_tokens":5,"completion_tokens":7},"choices":[]}\n',
      "data: [DONE]\n",
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const reasoning: string[] = [];
    const { result, usage } = await withUsageMeter(() =>
      streamChatCompletion("m", [{ role: "user", content: "x" }], 100, {
        onReasoning: (text) => reasoning.push(text),
      }),
    );

    expect(result).toBe("Hello world");
    expect(reasoning.join("")).toBe("Think more.");
    expect(usage).toEqual({ promptTokens: 5, completionTokens: 7 });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
    expect(body.reasoning).toEqual({ enabled: true }); // surfaced by default
  });

  it("throws when truncated before producing any text", async () => {
    vi.stubGlobal(
      "fetch",
      mockStream([
        'data: {"choices":[{"delta":{"reasoning":"…"},"finish_reason":"length"}]}\n',
        "data: [DONE]\n",
      ]),
    );
    await expect(
      streamChatCompletion("m", [{ role: "user", content: "x" }], 50),
    ).rejects.toThrow(/truncated before any text/);
  });
});
