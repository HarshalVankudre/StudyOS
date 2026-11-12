import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";

const mocks = vi.hoisted(() => ({
  planQuestionsAction: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("./actions", () => ({ planQuestionsAction: mocks.planQuestionsAction }));
vi.mock("@/components/AiActivity", () => ({ AiActivity: () => null }));
vi.mock("@/components/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/components/GenerationActivity", () => ({
  GenerationActivity: ({ onCancel }: { onCancel: () => void }) => (
    <button onClick={onCancel}>Cancel generation</button>
  ),
}));

import { GeneratorClient } from "./GeneratorClient";

const QUESTIONS = [
  { id: "q", question: "Level?", type: "single", options: [{ id: "a", label: "Undergrad" }, { id: "b", label: "Grad" }] },
];

function renderClient(props: { outOfCredits?: boolean } = {}) {
  return render(
    <I18nProvider locale="en" dictionary={en}>
      <GeneratorClient initialPrompt="CS student taking Data Structures" {...props} />
    </I18nProvider>,
  );
}

function ndjson(events: unknown[]): Response {
  return new Response(events.map((event) => JSON.stringify(event)).join("\n") + "\n", {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mocks.planQuestionsAction.mockResolvedValue({ ok: true, questions: QUESTIONS });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function goToQuestions() {
  const user = userEvent.setup();
  renderClient();
  await user.click(screen.getByRole("button", { name: /continue/i }));
  await screen.findByRole("button", { name: /build my workspace/i });
  return user;
}

describe("GeneratorClient", () => {
  it("shows the out-of-credits path before the student invests any effort", () => {
    renderClient({ outOfCredits: true });
    expect(screen.getByText(en.generate.outOfCredits.title)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.generate.outOfCredits.buy })).toHaveAttribute(
      "href",
      "/app/credits",
    );
    expect(screen.getByRole("link", { name: en.generate.outOfCredits.plans })).toHaveAttribute(
      "href",
      "/pricing",
    );
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("switches to the out-of-credits path if the questions step reports it", async () => {
    mocks.planQuestionsAction.mockResolvedValue({ ok: false, code: "out_of_credits", message: "x" });
    const user = userEvent.setup();
    renderClient();
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText(en.generate.outOfCredits.title)).toBeInTheDocument();
  });

  it("a failed generation shows an honest error with a retry button", async () => {
    const user = await goToQuestions();
    fetchMock.mockResolvedValueOnce(
      ndjson([{ type: "error", code: "generation_failed", message: en.ai.generate.failedNoCharge }]),
    );
    await user.click(screen.getByRole("button", { name: /build my workspace/i }));
    expect(await screen.findByText(en.ai.generate.failedNoCharge)).toBeInTheDocument();
    expect(screen.getByText(en.generate.failed.title)).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(ndjson([{ type: "complete", workspaceId: "ws-1" }]));
    await user.click(screen.getByRole("button", { name: en.generate.failed.retry }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/app/ws-1"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.answers).toEqual([]);
    expect(typeof body.generationId).toBe("string");
  });

  /** A /api/generate response whose stream the test feeds by hand. */
  function openStream() {
    let push!: (event: unknown) => void;
    let close!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        push = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        close = () => controller.close();
      },
    });
    return { response: new Response(body, { status: 200 }), push: (e: unknown) => push(e), close: () => close() };
  }

  it("cancel tells the server to stop, then says what the stop cost", async () => {
    const user = await goToQuestions();
    const stream = openStream();
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/generate") return Promise.resolve(stream.response);
      // The server stopped the run: its stream then reports the charge.
      setTimeout(() => {
        stream.push({ type: "cancelled", credits: 6 });
        stream.close();
      }, 0);
      return Promise.resolve(Response.json({ cancelled: true }));
    });
    await user.click(screen.getByRole("button", { name: /build my workspace/i }));
    await user.click(await screen.findByRole("button", { name: "Cancel generation" }));

    const generationId = JSON.parse(fetchMock.mock.calls[0][1].body).generationId;
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/generate/cancel",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ generationId }) }),
    );
    expect(await screen.findByText(en.generate.cancelled.title)).toBeInTheDocument();
    expect(screen.getByText(en.generate.cancelled.charged.replace("{credits}", "6"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.generate.cancelled.history })).toHaveAttribute("href", "/app/credits");
    // A stop is not a failure.
    expect(screen.queryByText(en.generate.failed.title)).not.toBeInTheDocument();
  });

  it("a stop before any AI work says nothing was charged", async () => {
    const user = await goToQuestions();
    const stream = openStream();
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/generate") return Promise.resolve(stream.response);
      setTimeout(() => {
        stream.push({ type: "cancelled", credits: 0 });
        stream.close();
      }, 0);
      return Promise.resolve(Response.json({ cancelled: true }));
    });
    await user.click(screen.getByRole("button", { name: /build my workspace/i }));
    await user.click(await screen.findByRole("button", { name: "Cancel generation" }));
    expect(await screen.findByText(en.generate.cancelled.free)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: en.generate.cancelled.history })).not.toBeInTheDocument();
  });

  it("when the server cannot be told, cancel disconnects and is honest about a possible charge", async () => {
    const user = await goToQuestions();
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (url === "/api/generate") {
        signal = init.signal ?? undefined;
        return new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      return Promise.resolve(Response.json({ cancelled: false }));
    });
    await user.click(screen.getByRole("button", { name: /build my workspace/i }));
    await user.click(await screen.findByRole("button", { name: "Cancel generation" }));
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(await screen.findByText(en.generate.cancelled.unknown)).toBeInTheDocument();
  });
});

describe("syllabus upload", () => {
  async function openImport() {
    const user = userEvent.setup();
    const view = renderClient();
    await user.click(screen.getByRole("button", { name: new RegExp(en.generate.syllabus.toggle) }));
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    return { user, input };
  }

  it("accepts PDF and Word files", async () => {
    const { input } = await openImport();
    expect(input.accept).toContain(".pdf");
    expect(input.accept).toContain(".docx");
  });

  it("explains a scanned PDF", async () => {
    const { user, input } = await openImport();
    fetchMock.mockResolvedValueOnce(Response.json({ code: "no_text", kind: "pdf" }, { status: 422 }));
    await user.upload(input, new File(["%PDF-1.4"], "scan.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(en.generate.syllabus.errors.scanned)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/import/syllabus", expect.objectContaining({ method: "POST" }));
  });

  it("rejects an oversized file without uploading it", async () => {
    const { user, input } = await openImport();
    const big = new File(["x"], "huge.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    await user.upload(input, big);
    expect(await screen.findByText(en.generate.syllabus.errors.tooLarge)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is honest when the material is longer than what will be used", async () => {
    const { user, input } = await openImport();
    fetchMock.mockResolvedValueOnce(
      Response.json({ text: "Week 1 reading. ".repeat(3000), kind: "docx", totalChars: 48000 }),
    );
    await user.upload(input, new File(["PK"], "syllabus.docx"));
    expect(await screen.findByText(/StudyOS will use the first 40,000/)).toBeInTheDocument();
  });
});
