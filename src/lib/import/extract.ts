/**
 * Server-side text extraction for uploads (syllabus import, course
 * material): PDF, Word (.docx) and plain text / Markdown.
 *
 * The upload is untrusted, so the parsing never runs in the server process.
 * Each extraction runs in a child Node process (extract-child.mjs running
 * extract-core.mjs) that:
 * - has a hard memory cap: the V8 heap is capped (--max-old-space-size) and a
 *   watchdog thread kills the process when its resident memory passes
 *   `rssLimitMb` (PDF.js decodes into ArrayBuffers the heap cap does not see);
 * - has a kill timer for every format, not just PDFs: past its deadline (plus
 *   a short grace for the child to report its own timeout) it is SIGKILLed;
 * - gets the bytes over IPC and an environment without secrets, and never a
 *   path or URL. PDF.js gets no font/CMap/wasm locations, so it never touches
 *   the disk or network, and eval is off.
 * A per-instance pool caps how many children run at once (and how many
 * requests may wait for one), so a burst of uploads cannot exhaust the
 * instance either. A hostile file costs one capped, killable process; the
 * event loop serving everyone else never runs a parser.
 *
 * Inside the child the work is bounded again, so a well-formed but huge
 * document gets a friendly error instead of a kill: size is capped before
 * parsing, the one .docx entry is inflated in chunks and abandoned past
 * MAX_DOCX_XML_BYTES, every PDF stream is measured through its filter chain
 * before PDF.js runs, every text scan is linear, at most maxPdfPages pages and
 * maxChars of text are read, and PDF reading checks the deadline per page.
 *
 * The extracted text is still untrusted: callers pass it through
 * `normalizeSourceText` and `sourceTextBlock` (./syllabus), which fence it as
 * data in every prompt.
 *
 * Deployment: the child files are plain .mjs loaded from <cwd>/src/lib/import
 * at run time. next.config.ts lists them in outputFileTracingIncludes so they
 * ship in .next/standalone (the standalone server's cwd), and lists fflate and
 * unpdf in serverExternalPackages so their files are traced into its
 * node_modules.
 */
import "server-only";
import { fork } from "node:child_process";
import path from "node:path";
import {
  ExtractError,
  assertPdfStreamsBounded as assertPdfStreamsBoundedCore,
  detectSourceKind,
  docxXmlToText as docxXmlToTextCore,
  readZipEntry,
  type ExtractedPages,
  type ExtractedSource,
  type ExtractionOutcome,
  type ExtractionRequest,
  type ResolvedLimits,
} from "./extract-core.mjs";
import { MAX_SOURCE_TEXT, MAX_UPLOAD_BYTES } from "./syllabus";

export { ExtractError, detectSourceKind, readZipEntry };
export type {
  ExtractErrorCode,
  ExtractedPages,
  ExtractedSource,
  SourceKind,
} from "./extract-core.mjs";

export { MAX_UPLOAD_BYTES };
/** Pages read from a PDF; a syllabus is rarely longer. */
export const MAX_PDF_PAGES = 60;
/**
 * Text kept from a file. More than the prompt will use (MAX_SOURCE_TEXT), so
 * the client can honestly tell the student how much material there was.
 */
export const MAX_EXTRACTED_CHARS = MAX_SOURCE_TEXT * 3;
export const EXTRACTION_TIMEOUT_MS = 15_000;
/** Cap on the inflated word/document.xml of a .docx. */
const MAX_DOCX_XML_BYTES = 30 * 1024 * 1024;
/** Cap on the decoded size of all streams in a PDF. */
const MAX_PDF_INFLATED_BYTES = 80 * 1024 * 1024;

/**
 * Limits for one extraction. The defaults are the syllabus import's; longer
 * course material (src/lib/materials) passes its own.
 */
export interface ExtractLimits {
  timeoutMs?: number;
  /** Largest file accepted, in bytes. */
  maxBytes?: number;
  /** Pages read from a PDF. */
  maxPdfPages?: number;
  /** Stop reading once this much text has been collected. */
  maxChars?: number;
  /** Cap on the decoded size of all streams in a PDF. */
  maxPdfInflatedBytes?: number;
}

/** Extract plain text from an uploaded file, or throw an ExtractError. */
export async function extractSourceText(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  options: { timeoutMs?: number } = {},
): Promise<ExtractedSource> {
  return (await runIsolated("text", bytes, fileName, mimeType, {
    timeoutMs: options.timeoutMs,
  })) as ExtractedSource;
}

/**
 * Extract text page by page, so generated study material can cite a page.
 * Same isolation as extractSourceText, with caller-chosen limits. Text past
 * `maxChars` is dropped (and `truncated` set), never silently kept.
 */
export async function extractSourcePages(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  limits: ExtractLimits = {},
): Promise<ExtractedPages> {
  return (await runIsolated("pages", bytes, fileName, mimeType, limits)) as ExtractedPages;
}

/**
 * Text of a WordprocessingML body (see extract-core.mjs). Exported for tests;
 * production code only runs it inside the extraction child.
 */
export function docxXmlToText(xml: string, maxChars = MAX_EXTRACTED_CHARS): string {
  return docxXmlToTextCore(xml, maxChars);
}

/** Refuse PDFs whose streams would decode past the cap (see extract-core.mjs). */
export function assertPdfStreamsBounded(
  bytes: Uint8Array,
  maxBytes = MAX_PDF_INFLATED_BYTES,
): void {
  assertPdfStreamsBoundedCore(bytes, maxBytes);
}

// ---------------------------------------------------------------------------
// Isolation: the child process and the per-instance pool
// ---------------------------------------------------------------------------

/** Settings of the extraction pool. Tests lower them; production uses the defaults. */
export interface ExtractionIsolation {
  /** Children running at once on this instance. */
  maxConcurrent: number;
  /** Requests that may wait for a free child; more are refused as "busy". */
  maxQueued: number;
  /** Longest wait for a free child before "busy". */
  maxWaitMs: number;
  /** Resident memory of the child process at which it is killed. */
  rssLimitMb: number;
  /** V8 heap cap of the child. */
  heapLimitMb: number;
  /** Longest deadline any extraction gets, whatever the caller asks for. */
  maxTimeoutMs: number;
  /** Time past the deadline the child gets to report its own timeout before the kill. */
  killGraceMs: number;
  /** Tests only: skip the PDF stream pre-check so PDF.js itself meets the memory cap. */
  skipPdfPrecheck: boolean;
}

/**
 * Two children of at most 1 GiB each leave most of an 8 GiB instance to the
 * server. A real 300-page lecture PDF stays far below the cap (text
 * extraction never decodes images); only a decompression bomb gets near it.
 * The wait is short enough that wait + the 15 s syllabus deadline fits the
 * upload route's 30 s maxDuration.
 */
export const DEFAULT_EXTRACTION_ISOLATION: Readonly<ExtractionIsolation> = {
  maxConcurrent: 2,
  maxQueued: 8,
  maxWaitMs: 10_000,
  rssLimitMb: 1024,
  heapLimitMb: 768,
  maxTimeoutMs: 60_000,
  killGraceMs: 1_500,
  skipPdfPrecheck: false,
};

interface PoolState {
  config: ExtractionIsolation;
  active: number;
  waiting: Array<() => void>;
}

// On globalThis so every route bundle (and dev hot reloads) share one pool.
const POOL_KEY = Symbol.for("studyos.extractionPool");
function pool(): PoolState {
  const holder = globalThis as unknown as Record<symbol, PoolState | undefined>;
  holder[POOL_KEY] ??= { config: { ...DEFAULT_EXTRACTION_ISOLATION }, active: 0, waiting: [] };
  return holder[POOL_KEY]!;
}

/** Change pool settings (tests); returns the previous settings. */
export function configureExtractionIsolation(
  changes: Partial<ExtractionIsolation>,
): ExtractionIsolation {
  const state = pool();
  const previous = { ...state.config };
  state.config = { ...state.config, ...changes };
  return previous;
}

/** Children running and requests waiting on this instance (tests, diagnostics). */
export function extractionLoad(): { active: number; waiting: number } {
  const state = pool();
  return { active: state.active, waiting: state.waiting.length };
}

/** Take a slot or wait for one (bounded); throws ExtractError("busy"). */
async function acquireSlot(): Promise<() => void> {
  const state = pool();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    state.active -= 1;
    state.waiting.shift()?.();
  };
  if (state.active < state.config.maxConcurrent) {
    state.active += 1;
    return release;
  }
  if (state.waiting.length >= state.config.maxQueued) {
    throw new ExtractError("busy", "extraction queue full");
  }
  await new Promise<void>((resolve, reject) => {
    const wake = () => {
      clearTimeout(timer);
      state.active += 1;
      resolve();
    };
    const timer = setTimeout(() => {
      const at = state.waiting.indexOf(wake);
      if (at !== -1) state.waiting.splice(at, 1);
      reject(new ExtractError("busy", "no extraction slot in time"));
    }, state.config.maxWaitMs);
    state.waiting.push(wake);
  });
  return release;
}

const CHILD_ENTRY = ["src", "lib", "import", "extract-child.mjs"];
/** Must match MEMORY_LIMIT_MARKER in extract-child.mjs. */
const MEMORY_LIMIT_MARKER = "STUDYOS_EXTRACT_MEMORY_LIMIT";
const HEAP_EXHAUSTED = /heap out of memory|Reached heap limit|allocation failed/i;
const MAX_STDERR_KEPT = 8 * 1024;

/** The child sees no secrets: only what Node itself needs to start. */
function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  if (process.platform === "win32") {
    for (const name of ["SystemRoot", "SYSTEMROOT", "windir", "TEMP", "TMP"]) {
      if (process.env[name]) env[name] = process.env[name];
    }
  }
  return env;
}

async function runIsolated(
  mode: ExtractionRequest["mode"],
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  limits: ExtractLimits,
): Promise<ExtractedSource | ExtractedPages> {
  // Cheap refusals before taking a slot or starting a process.
  if (bytes.byteLength === 0) throw new ExtractError("no_text", "empty file");
  if (bytes.byteLength > (limits.maxBytes ?? MAX_UPLOAD_BYTES)) throw new ExtractError("too_large");
  // Names and MIME types only break ties; keep what crosses to the child short.
  const name = String(fileName).slice(-200);
  const mime = String(mimeType).slice(0, 200);
  if (!detectSourceKind(bytes, name, mime)) throw new ExtractError("unsupported");

  const release = await acquireSlot();
  try {
    const { config } = pool();
    const timeoutMs = Math.min(
      config.maxTimeoutMs,
      Math.max(0, limits.timeoutMs ?? EXTRACTION_TIMEOUT_MS),
    );
    const resolved: ResolvedLimits = {
      deadline: Date.now() + timeoutMs,
      maxBytes: limits.maxBytes ?? MAX_UPLOAD_BYTES,
      maxPdfPages: limits.maxPdfPages ?? MAX_PDF_PAGES,
      maxChars: limits.maxChars ?? MAX_EXTRACTED_CHARS,
      maxPdfInflatedBytes: limits.maxPdfInflatedBytes ?? MAX_PDF_INFLATED_BYTES,
      maxDocxXmlBytes: MAX_DOCX_XML_BYTES,
      ...(config.skipPdfPrecheck ? { skipPdfPrecheck: true } : {}),
    };
    const outcome = await runChild(
      { mode, bytes, fileName: name, mimeType: mime, limits: resolved },
      timeoutMs + config.killGraceMs,
      config,
    );
    if (outcome.ok) return outcome.value;
    if (outcome.code === "internal") {
      throw new Error(`document extraction failed: ${outcome.detail}`);
    }
    const detail = outcome.detail.startsWith(`${outcome.code}: `)
      ? outcome.detail.slice(outcome.code.length + 2)
      : undefined;
    throw new ExtractError(outcome.code, detail, outcome.kind);
  } finally {
    release();
  }
}

/**
 * Start the child, hand it the request, and settle once it has exited, so a
 * pool slot is only freed when the process and its memory are gone.
 */
function runChild(
  request: ExtractionRequest,
  killAfterMs: number,
  config: ExtractionIsolation,
): Promise<ExtractionOutcome> {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(process.cwd(), ...CHILD_ENTRY), [], {
      execArgv: [
        `--max-old-space-size=${config.heapLimitMb}`,
        "--disallow-code-generation-from-strings",
      ],
      env: childEnvironment(),
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      serialization: "advanced",
    });

    let outcome: ExtractionOutcome | null = null;
    let timedOut = false;
    let failure: Error | null = null;
    let settled = false;
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_STDERR_KEPT);
    });

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (outcome) return resolve(outcome);
      if (timedOut) return reject(new ExtractError("timeout"));
      if (stderr.includes(MEMORY_LIMIT_MARKER) || HEAP_EXHAUSTED.test(stderr)) {
        return reject(new ExtractError("too_large", "extraction memory limit"));
      }
      reject(
        failure ??
          new Error(
            `document extraction process ended without an answer (code ${code}, signal ${signal})`,
          ),
      );
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, killAfterMs);

    child.on("message", (message) => {
      outcome = message as ExtractionOutcome;
      // The child exits on its own once its answer is flushed; make sure.
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    });
    child.on("error", (error) => {
      failure = error;
      // A failed spawn never emits "exit"; every other error is followed by it.
      if (child.pid === undefined) finish(null, null);
    });
    child.on("exit", finish);

    child.send({ request, rssLimitBytes: config.rssLimitMb * 1024 * 1024 }, (error) => {
      if (error && !failure) failure = error;
    });
  });
}
