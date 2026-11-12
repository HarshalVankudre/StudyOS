/**
 * Entry point of the document-extraction child process (started by
 * src/lib/import/extract.ts, one process per upload).
 *
 * Receives one ExtractionRequest over IPC, answers with one
 * ExtractionOutcome and exits. The parent caps the V8 heap
 * (--max-old-space-size) and kills this process at its deadline; the
 * watchdog below caps the whole process's resident memory, which the heap
 * flag does not cover (PDF.js decodes into ArrayBuffers outside the heap).
 * The watchdog is a thread of its own, so it keeps measuring while the main
 * thread is stuck inside a long synchronous decode. It is armed before any
 * untrusted byte is parsed: it measures once as soon as it runs, reports
 * back, and only then does the extraction start. So no parse ever runs
 * unwatched, and a process already past its cap never parses at all.
 *
 * Plain JavaScript run by Node directly (no bundler, no TypeScript).
 */
import { Worker } from "node:worker_threads";
import { runExtraction } from "./extract-core.mjs";

/** Written to stderr just before the watchdog kills the process. */
export const MEMORY_LIMIT_MARKER = "STUDYOS_EXTRACT_MEMORY_LIMIT";

const WATCHDOG_SOURCE = `
const { workerData, parentPort } = require("node:worker_threads");
const { writeSync } = require("node:fs");
function check() {
  if (process.memoryUsage.rss() > workerData.rssLimitBytes) {
    try { writeSync(2, "\\n${MEMORY_LIMIT_MARKER}\\n"); } catch {}
    process.kill(process.pid, "SIGKILL");
  }
}
check();
setInterval(check, workerData.intervalMs);
parentPort.postMessage("armed");
`;

/**
 * Start the watchdog; resolves once it has taken its first measurement.
 * Rejects if it cannot start, so the extraction never runs unwatched.
 */
function startWatchdog(rssLimitBytes) {
  return new Promise((resolve, reject) => {
    const watchdog = new Worker(WATCHDOG_SOURCE, {
      eval: true,
      workerData: { rssLimitBytes, intervalMs: 10 },
      resourceLimits: { maxOldGenerationSizeMb: 8, maxYoungGenerationSizeMb: 2 },
      stdout: true,
      stderr: true,
    });
    watchdog.unref();
    watchdog.once("message", () => resolve());
    watchdog.once("error", reject);
    watchdog.once("exit", () => reject(new Error("memory watchdog exited")));
  });
}

process.once("message", async (message) => {
  if (message.rssLimitBytes > 0) {
    try {
      await startWatchdog(message.rssLimitBytes);
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : typeof error;
      const outcome = { ok: false, code: "internal", detail: `memory watchdog: ${detail}` };
      process.send(outcome, () => process.exit(1));
      return;
    }
  }
  const outcome = await runExtraction(message.request);
  process.send(outcome, (error) => process.exit(error ? 1 : 0));
});

// The server went away (or closed the channel): nothing left to answer.
process.once("disconnect", () => process.exit(0));
