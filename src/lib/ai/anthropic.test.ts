// src/lib/ai/anthropic.test.ts — Anthropic path of chatCompletion /
// streamChatCompletion, driven by a fake SDK client (no network).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIUserAbortError } from "@anthropic-ai/sdk";
import { chatCompletion, streamChatCompletion } from "./openrouter";
import { AiRefusalError, toAnthropicMessages } from "./anthropic";
import { isAiConfigured, missingAiKeyMessage, providerForModel } from "./provider";
import { withUsageMeter } from "./usage-meter";

type Delta = { type: "thinking" | "text"; delta: string };
interface Script {
  deltas?: Delta[];
  /** Final message fields (content, stop_reason, usage, stop_details). */
  message?: Record<string, unknown>;
  /** Usage visible on `currentMessage` before the stream completes. */
  partialUsage?: Record<string, unknown>;
  /** Hang after the deltas until the request signal aborts. */
  hangUntilAbort?: boolean;
}

const fake = vi.hoisted(() => ({
  script: {} as Record<string, unknown>,
  calls: [] as Array<{ params: Record<string, unknown>; signal?: AbortSignal }>,
}));

/** Minimal stand-in for the SDK's MessageStream: `.on()` + `finalMessage()`. */
class FakeMessageStream {
  private listeners: Record<string, Array<(delta: string) => void>> = {};
  currentMessage: Record<string, unknown> | undefined;
  constructor(
    private script: Script,
    private signal?: AbortSignal,
  ) {}
  on(event: string, listener: (delta: string) => void) {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }
  async finalMessage() {
    this.currentMessage = { usage: this.script.partialUsage ?? {} };
    for (const { type, delta } of this.script.deltas ?? []) {
      await Promise.resolve();
      for (const listener of this.listeners[type] ?? []) listener(delta);
    }
    if (this.script.hangUntilAbort) {
      await new Promise((_, reject) => {
        const fail = () => reject(new APIUserAbortError());
        if (this.signal?.aborted) fail();
        this.signal?.addEventListener("abort", fail, { once: true });
      });
    }
    const message = {
      content: [],
      stop_reason: "end_turn",
      stop_details: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      ...this.script.message,
    };
    this.currentMessage = message;
    return message;
  }
}

vi.mock("./anthropic-client", () => ({
  getAnthropicClient: () => ({
    messages: {
      stream: (params: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
        fake.calls.push({ params, signal: options?.signal });
        return new FakeMessageStream(fake.script as Script, options?.signal);
      },
    },
  }),
}));

const MODEL = "claude-haiku-5-5";
const text = (t: string) => ({ type: "text", text: t });
const fetchSpy = vi.fn();

beforeEach(() => {
  fake.script = {};
  fake.calls = [];
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("provider selection", () => {
  it("routes only bare claude- ids to Anthropic", () => {
    expect(providerForModel("claude-haiku-5-5")).toBe("anthropic");
    expect(providerForModel("anthropic/claude-haiku-5-5")).toBe("openrouter");
    expect(providerForModel("z-ai/glm-5.2")).toBe("openrouter");
  });

  it("checks the key that matches the model's provider", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    expect(isAiConfigured("claude-haiku-5-5")).toBe(true);
    expect(isAiConfigured("z-ai/glm-5.2")).toBe(false);
    expect(missingAiKeyMessage("claude-haiku-5-5", "AI editing")).toContain("ANTHROPIC_API_KEY");
  });

  it("keeps OpenRouter slugs on OpenRouter", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] }),
    });
    await chatCompletion("anthropic/claude-haiku-5-5", [{ role: "user", content: "x" }], 100);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fake.calls).toHaveLength(0);
  });
});

describe("chatCompletion (Anthropic)", () => {
  it("lifts system messages to `system` and never sends temperature or thinking", async () => {
    fake.script = { message: { content: [text("ok")] } };
    const result = await chatCompletion(
      MODEL,
      [
        { role: "system", content: "Be terse." },
        { role: "user", content: "Hi" },
        { role: "system", content: "Reply in JSON." },
      ],
      300,
      { temperature: 0.4 },
    );
    expect(result).toBe("ok");
    expect(fetchSpy).not.toHaveBeenCalled();
    const { params } = fake.calls[0];
    expect(params).toEqual({
      model: MODEL,
      max_tokens: 300,
      system: "Be terse.\n\nReply in JSON.",
      messages: [{ role: "user", content: "Hi" }],
    });
  });

  it("throws the distinct truncation errors on stop_reason max_tokens", async () => {
    fake.script = { message: { content: [text('{"a":')], stop_reason: "max_tokens" } };
    await expect(chatCompletion(MODEL, [{ role: "user", content: "x" }], 50)).rejects.toThrow(
      /truncated mid-output \(max_tokens=50 too low\)/,
    );
    fake.script = { message: { content: [], stop_reason: "max_tokens" } };
    await expect(chatCompletion(MODEL, [{ role: "user", content: "x" }], 50)).rejects.toThrow(
      /truncated before any text \(max_tokens=50 too low\)/,
    );
  });

  it("surfaces a refusal as AiRefusalError", async () => {
    fake.script = {
      message: {
        content: [text("partial")],
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: "Not allowed." },
      },
    };
    const call = chatCompletion(MODEL, [{ role: "user", content: "x" }], 100);
    await expect(call).rejects.toBeInstanceOf(AiRefusalError);
    await expect(call).rejects.toThrow(/refused the request \(category: cyber — Not allowed\.\)/);
  });

  it("records input (including cache reads and writes) and output usage", async () => {
    fake.script = {
      message: {
        content: [text("ok")],
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 5,
          cache_read_input_tokens: 20,
          output_tokens: 7,
        },
      },
    };
    const { usage } = await withUsageMeter(() =>
      chatCompletion(MODEL, [{ role: "user", content: "x" }], 100),
    );
    expect(usage).toEqual({ promptTokens: 35, completionTokens: 7 });
  });
});

describe("streamChatCompletion (Anthropic)", () => {
  it("streams thinking and text to the callbacks and returns the text", async () => {
    fake.script = {
      deltas: [
        { type: "thinking", delta: "Plan " },
        { type: "thinking", delta: "first." },
        { type: "text", delta: "Hello" },
        { type: "text", delta: " world" },
      ],
      message: {
        content: [{ type: "thinking", thinking: "Plan first." }, text("Hello world")],
        usage: { input_tokens: 4, cache_read_input_tokens: null, output_tokens: 9 },
      },
    };
    const reasoning: string[] = [];
    const content: string[] = [];
    const { result, usage } = await withUsageMeter(() =>
      streamChatCompletion(MODEL, [{ role: "user", content: "x" }], 300, {
        temperature: 0.2,
        onReasoning: (t) => reasoning.push(t),
        onContent: (t) => content.push(t),
      }),
    );
    expect(result).toBe("Hello world");
    expect(reasoning.join("")).toBe("Plan first.");
    expect(content).toEqual(["Hello", " world"]);
    expect(usage).toEqual({ promptTokens: 4, completionTokens: 9 });
    expect(fake.calls[0].params.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect("temperature" in fake.calls[0].params).toBe(false);
  });

  it("does not request thinking display without onReasoning or with reasoning: false", async () => {
    fake.script = { message: { content: [text("ok")] } };
    await streamChatCompletion(MODEL, [{ role: "user", content: "x" }], 100);
    await streamChatCompletion(MODEL, [{ role: "user", content: "x" }], 100, {
      reasoning: false,
      onReasoning: () => {},
    });
    expect("thinking" in fake.calls[0].params).toBe(false);
    expect("thinking" in fake.calls[1].params).toBe(false);
  });

  it("throws the truncation error when only thinking fit in max_tokens", async () => {
    fake.script = {
      deltas: [{ type: "thinking", delta: "…" }],
      message: { content: [{ type: "thinking", thinking: "…" }], stop_reason: "max_tokens" },
    };
    await expect(
      streamChatCompletion(MODEL, [{ role: "user", content: "x" }], 50, { onReasoning: () => {} }),
    ).rejects.toThrow(/truncated before any text/);
  });

  it("aborts via the signal, rejecting with its reason and billing reported usage", async () => {
    fake.script = {
      deltas: [{ type: "text", delta: "Hel" }],
      partialUsage: { input_tokens: 12, output_tokens: 3 },
      hangUntilAbort: true,
    };
    const controller = new AbortController();
    const reason = new Error("deadline");
    const content: string[] = [];
    const { result: error, usage } = await withUsageMeter(() =>
      streamChatCompletion(MODEL, [{ role: "user", content: "x" }], 100, {
        signal: controller.signal,
        onContent: (t) => {
          content.push(t);
          controller.abort(reason);
        },
      }).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    expect(error).toBe(reason);
    expect(content).toEqual(["Hel"]);
    expect(fake.calls[0].signal).toBe(controller.signal);
    expect(usage).toEqual({ promptTokens: 12, completionTokens: 3 });
  });
});

describe("toAnthropicMessages", () => {
  it("starts with a user turn when trimmed history begins with the assistant", () => {
    const { messages } = toAnthropicMessages([
      { role: "assistant", content: "Earlier reply" },
      { role: "user", content: "Next" },
    ]);
    expect(messages[0].role).toBe("user");
    expect(messages.slice(1)).toEqual([
      { role: "assistant", content: "Earlier reply" },
      { role: "user", content: "Next" },
    ]);
  });

  it("rejects a trailing assistant turn (prefill is unsupported)", () => {
    expect(() =>
      toAnthropicMessages([
        { role: "user", content: "Hi" },
        { role: "assistant", content: "{" },
      ]),
    ).toThrow(/prefill/);
  });
});
