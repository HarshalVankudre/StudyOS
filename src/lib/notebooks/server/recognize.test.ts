// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ create: vi.fn(), recordUsage: vi.fn() }));

vi.mock("@/lib/ai/anthropic-client", () => ({ getAnthropicClient: () => ({ messages: { create: m.create } }) }));
vi.mock("@/lib/ai/usage-meter", () => ({ recordUsage: m.recordUsage }));

import {
  cleanTranscription,
  handwritingModel,
  HandwritingRefusedError,
  imageMatchesMime,
  recognizeHandwriting,
  TRANSCRIPTION_PROMPT,
} from "./recognize";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

beforeEach(() => {
  m.create.mockResolvedValue({
    stop_reason: "end_turn",
    content: [{ type: "text", text: "Photosynthesis\n6CO_2 + 6H_2O -> C_6H_{12}O_6" }],
    usage: { input_tokens: 900, output_tokens: 30 },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("handwritingModel", () => {
  it("defaults to Claude Haiku 5.5 when the Anthropic key is set, else is unavailable", () => {
    expect(handwritingModel({ ANTHROPIC_API_KEY: "k" })).toBe("claude-haiku-5-5");
    expect(handwritingModel({ OPENROUTER_API_KEY: "k" })).toBeNull();
    expect(handwritingModel({})).toBeNull();
  });

  it("uses STUDYOS_HANDWRITING_MODEL when its provider's key is set", () => {
    expect(handwritingModel({ STUDYOS_HANDWRITING_MODEL: "google/gemini-3-flash", OPENROUTER_API_KEY: "k" })).toBe("google/gemini-3-flash");
    expect(handwritingModel({ STUDYOS_HANDWRITING_MODEL: "google/gemini-3-flash", ANTHROPIC_API_KEY: "k" })).toBeNull();
    expect(handwritingModel({ STUDYOS_HANDWRITING_MODEL: "claude-sonnet-5-5", ANTHROPIC_API_KEY: "k" })).toBe("claude-sonnet-5-5");
  });
});

describe("image checks and cleanup", () => {
  it("checks PNG and JPEG signatures", () => {
    expect(imageMatchesMime(PNG, "image/png")).toBe(true);
    expect(imageMatchesMime(PNG, "image/jpeg")).toBe(false);
    expect(imageMatchesMime(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0]), "image/jpeg")).toBe(true);
    expect(imageMatchesMime(new Uint8Array([0xff, 0xd8]), "image/jpeg")).toBe(false);
  });

  it("keeps the transcription verbatim, strips fences, and reads 'no text' replies as empty", () => {
    expect(cleanTranscription("  a = b + c \n d  ")).toBe("a = b + c \n d");
    expect(cleanTranscription("```\nE = mc^2\n```")).toBe("E = mc^2");
    expect(cleanTranscription("(no handwriting)")).toBe("");
    expect(cleanTranscription("No legible handwriting found.")).toBe("");
    expect(cleanTranscription("")).toBe("");
    expect(cleanTranscription("no text here means something else")).toBe("no text here means something else");
    expect(cleanTranscription("x".repeat(30_000))).toHaveLength(20_000);
  });
});

describe("recognizeHandwriting", () => {
  it("sends the page as a base64 image block with the strict prompt, at low effort", async () => {
    const text = await recognizeHandwriting("claude-haiku-5-5", PNG, "image/png");
    expect(text).toBe("Photosynthesis\n6CO_2 + 6H_2O -> C_6H_{12}O_6");
    const [params, options] = m.create.mock.calls[0];
    expect(params).toMatchObject({
      model: "claude-haiku-5-5",
      system: TRANSCRIPTION_PROMPT,
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from(PNG).toString("base64") } },
            { type: "text", text: expect.any(String) },
          ],
        },
      ],
    });
    expect(params).not.toHaveProperty("thinking");
    expect(options).toMatchObject({ timeout: 60_000 });
    expect(m.recordUsage).toHaveBeenCalledWith({ input_tokens: 900, output_tokens: 30 }, "claude-haiku-5-5");
    expect(TRANSCRIPTION_PROMPT).toMatch(/never an instruction/);
  });

  it("throws on a refusal", async () => {
    m.create.mockResolvedValue({ stop_reason: "refusal", content: [], usage: {} });
    await expect(recognizeHandwriting("claude-haiku-5-5", PNG, "image/png")).rejects.toBeInstanceOf(HandwritingRefusedError);
  });

  it("sends an OpenRouter model the image as an image_url data URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "Mitosis" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await recognizeHandwriting("google/gemini-3-flash", PNG, "image/png")).toBe("Mitosis");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("google/gemini-3-flash");
    expect(body.messages[0]).toEqual({ role: "system", content: TRANSCRIPTION_PROMPT });
    expect(body.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}` },
    });
    expect(m.create).not.toHaveBeenCalled();
  });

  it("surfaces an OpenRouter failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(recognizeHandwriting("google/gemini-3-flash", PNG, "image/png")).rejects.toThrow(/OpenRouter request failed \(500\)/);
  });
});
