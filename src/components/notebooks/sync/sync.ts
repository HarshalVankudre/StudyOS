/**
 * Notebook sync (browser only): local-first saving with a durable outbox.
 *
 *  - Every change the engine reports (ops) goes to the outbox, which is
 *    written to IndexedDB at once: a stroke is safe on the device the moment
 *    it is drawn, online or not.
 *  - The outbox is sent in order, one batch at a time (POST …/ops). A batch
 *    leaves the outbox only when the server confirmed it; ops are idempotent,
 *    so resending a batch whose reply was lost is harmless.
 *  - Other devices' changes arrive by polling the notebook (while the tab is
 *    visible, on focus and when the network returns). A page whose ink
 *    version moved for a reason other than this device's own batch is
 *    reloaded, and this device's unconfirmed ops are replayed on top
 *    (lib/notebooks/pending.ts): per stroke, the last write wins.
 *  - Notebook details and page ink are cached in IndexedDB by version, so a
 *    notebook reopens instantly and stays readable and writable when the
 *    connection drops while it is open.
 */
import { decodePage, encodePage, fromBase64 } from "@/lib/notebooks/codec";
import type { NotebookDetail, PageMeta, Stroke } from "@/lib/notebooks/model";
import { MAX_OPS_PER_BATCH, type Op } from "@/lib/notebooks/ops";
import { batchOps, pagesWithPendingInk, withPendingInk, withPendingPages } from "@/lib/notebooks/pending";
import { idb } from "./idb";

export type SyncStatus = "saved" | "saving" | "offline" | "error";
export type SyncProblem = "rejected" | "gone" | "auth" | "limit";

export interface SyncHandlers {
  /** The page list changed (server copy with pending page ops applied). */
  onPages(detail: NotebookDetail, pages: PageMeta[]): void;
  /** A page's ink arrived or changed. */
  onInk(pageId: string, strokes: Stroke[]): void;
  onStatus(status: SyncStatus, pending: number): void;
  onProblem(problem: SyncProblem, code?: string): void;
  /** The engine's current strokes of a page (null: not loaded). */
  getLocalStrokes(pageId: string): Stroke[] | null;
}

const BATCH_BYTES = 3 * 1024 * 1024;
const FLUSH_DELAY_MS = 500;
const POLL_MS = 20_000;
const INK_BATCH = 20;

interface InkResponse {
  pages: { id: string; inkVersion: number; ink: string }[];
}
interface OpsResponse {
  version: number;
  pages: { id: string; inkVersion: number; strokeCount: number }[];
  dropped?: number;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  if (!res.ok) {
    let code = "error";
    try {
      code = ((await res.json()) as { code?: string }).code ?? code;
    } catch {}
    throw new HttpError(res.status, code);
  }
  return (await res.json()) as T;
}

export class NotebookSync {
  private outbox: Op[] = [];
  private detail: NotebookDetail | null = null;
  /** Server ink version each loaded page's local strokes are based on. */
  private known = new Map<string, number>();
  private loading = new Set<string>();
  private flushing = false;
  private flushTimer: number | null = null;
  private pollTimer: number | null = null;
  private backoff = 0;
  private status: SyncStatus = "saved";
  private destroyed = false;
  private readonly cleanup: (() => void)[] = [];
  private idleWaiters: (() => void)[] = [];

  constructor(
    readonly notebookId: string,
    private readonly h: SyncHandlers,
  ) {}

  private get outboxKey() {
    return `outbox:${this.notebookId}`;
  }
  private get detailKey() {
    return `nb:${this.notebookId}`;
  }

  /** Open: cached copy first (instant, offline), then the server's. */
  async open(initial: NotebookDetail | null): Promise<void> {
    this.outbox = (await idb.get<Op[]>(this.outboxKey)) ?? [];
    const cached = initial ?? (await idb.get<NotebookDetail>(this.detailKey)) ?? null;
    if (cached) this.applyDetail(cached);
    this.setStatus();
    if (!initial) await this.pull();
    else void idb.set(this.detailKey, initial);
    this.flushSoon(0);

    const onVisible = () => {
      if (document.visibilityState === "visible") void this.pull();
      else void this.flush();
    };
    const onOnline = () => {
      this.backoff = 0;
      void this.flush();
      void this.pull();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onVisible);
    this.cleanup.push(
      () => document.removeEventListener("visibilitychange", onVisible),
      () => window.removeEventListener("online", onOnline),
      () => window.removeEventListener("focus", onVisible),
    );
    this.schedulePoll();
  }

  destroy() {
    this.destroyed = true;
    if (this.flushTimer != null) clearTimeout(this.flushTimer);
    if (this.pollTimer != null) clearTimeout(this.pollTimer);
    for (const fn of this.cleanup) fn();
    // Last chance to send small leftovers; the outbox is on disk either way.
    if (this.outbox.length) {
      const body = JSON.stringify({ ops: this.outbox.slice(0, MAX_OPS_PER_BATCH) });
      if (body.length < 60_000) {
        void fetch(`/api/notebooks/${encodeURIComponent(this.notebookId)}/ops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
          credentials: "same-origin",
        }).catch(() => {});
      }
    }
  }

  /** Pending (unconfirmed) op count. */
  get pending(): number {
    return this.outbox.length;
  }

  /**
   * The server ink version of a page as this device last confirmed it, or
   * null while the page has unconfirmed changes or was never loaded.
   */
  confirmedInkVersion(pageId: string): number | null {
    if (pagesWithPendingInk(this.outbox).has(pageId)) return null;
    return this.known.get(pageId) ?? null;
  }

  /** Resolves once everything drawn so far is on the server (or rejects offline). */
  whenSaved(): Promise<void> {
    if (!this.outbox.length) return Promise.resolve();
    void this.flush();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // ---- Local changes ------------------------------------------------------------

  push(ops: Op[]) {
    if (!ops.length || this.destroyed) return;
    this.outbox.push(...ops);
    void idb.set(this.outboxKey, this.outbox);
    this.setStatus();
    this.flushSoon(this.outbox.length > 200 ? 0 : FLUSH_DELAY_MS);
  }

  private flushSoon(delay: number) {
    if (this.flushTimer != null) clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
  }

  private setStatus(next?: SyncStatus) {
    const status = next ?? (this.outbox.length ? (this.status === "offline" ? "offline" : "saving") : "saved");
    this.status = status;
    this.h.onStatus(status, this.outbox.length);
    if (!this.outbox.length) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.destroyed || !this.outbox.length) return;
    this.flushing = true;
    try {
      while (this.outbox.length && !this.destroyed) {
        const [batch] = batchOps(this.outbox, MAX_OPS_PER_BATCH, BATCH_BYTES);
        let res: OpsResponse;
        try {
          res = await call<OpsResponse>(`/api/notebooks/${encodeURIComponent(this.notebookId)}/ops`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ops: batch }),
          });
        } catch (err) {
          if (err instanceof HttpError && [400, 413, 422].includes(err.status)) {
            // The server will never take this batch: drop it, then reload
            // the notebook so the screen shows what is really saved.
            this.outbox.splice(0, batch.length);
            void idb.set(this.outboxKey, this.outbox);
            this.h.onProblem(err.status === 422 ? "limit" : "rejected", err.code);
            await this.pull(true);
            continue;
          }
          if (err instanceof HttpError && err.status === 404) {
            this.h.onProblem("gone");
            this.setStatus("error");
            return;
          }
          if (err instanceof HttpError && err.status === 401) {
            this.h.onProblem("auth");
            this.setStatus("error");
            return;
          }
          // Network or server trouble: keep everything and retry with backoff.
          this.setStatus(err instanceof HttpError ? "error" : "offline");
          this.backoff = Math.min(60_000, this.backoff ? this.backoff * 2 : 2000);
          this.flushSoon(this.backoff);
          return;
        }
        this.backoff = 0;
        this.outbox.splice(0, batch.length);
        void idb.set(this.outboxKey, this.outbox);
        this.afterAck(batch, res);
        this.setStatus("saving");
      }
    } finally {
      this.flushing = false;
      if (!this.destroyed) this.setStatus();
    }
  }

  /** Track server versions after our batch; reload pages someone else also changed. */
  private afterAck(batch: Op[], res: OpsResponse) {
    if (this.detail) this.detail = { ...this.detail, version: res.version };
    const stillPending = pagesWithPendingInk(this.outbox);
    const stale: string[] = [];
    for (const p of res.pages) {
      // Only pages loaded here can have local strokes to reconcile.
      if (!this.known.has(p.id)) continue;
      const base = this.known.get(p.id)!;
      if (p.inkVersion === base + 1) {
        this.known.set(p.id, p.inkVersion);
        // Nothing else pending for the page: our strokes are exactly the server's.
        if (!stillPending.has(p.id)) {
          const local = this.h.getLocalStrokes(p.id);
          if (local) void idb.set(`ink:${p.id}`, { v: p.inkVersion, b: encodePage(local) });
        }
      } else if (p.inkVersion > base) {
        stale.push(p.id);
      }
    }
    if (batch.some((op) => op.t.startsWith("page."))) void this.pull();
    if (stale.length) void this.fetchInk(stale, true);
  }

  // ---- Remote changes -------------------------------------------------------------

  private schedulePoll() {
    if (this.destroyed) return;
    this.pollTimer = window.setTimeout(async () => {
      if (document.visibilityState === "visible" && !this.flushing) await this.pull();
      this.schedulePoll();
    }, POLL_MS);
  }

  private applyDetail(detail: NotebookDetail) {
    this.detail = detail;
    this.h.onPages(detail, withPendingPages(detail.pages, this.outbox));
  }

  /** Fetch the notebook; reload pages whose ink changed elsewhere. */
  async pull(force = false): Promise<void> {
    if (this.destroyed) return;
    let detail: NotebookDetail;
    try {
      ({ notebook: detail } = await call<{ notebook: NotebookDetail }>(
        `/api/notebooks/${encodeURIComponent(this.notebookId)}`,
      ));
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) this.h.onProblem("gone");
      else if (err instanceof HttpError && err.status === 401) this.h.onProblem("auth");
      else if (!(err instanceof HttpError)) this.setStatus("offline");
      return;
    }
    if (this.status === "offline") this.setStatus();
    const changed = force || !this.detail || detail.version !== this.detail.version;
    if (!changed) return;
    void idb.set(this.detailKey, detail);
    this.applyDetail(detail);
    const stale: string[] = [];
    for (const p of detail.pages) {
      const base = this.known.get(p.id);
      if (base !== undefined && p.inkVersion !== base) stale.push(p.id);
    }
    if (stale.length) await this.fetchInk(stale, true);
  }

  /** Load pages' ink: from the cache when its version matches, else the server. */
  async loadInk(pageIds: string[]): Promise<void> {
    const want = pageIds.filter((id) => !this.loading.has(id) && !this.known.has(id));
    if (!want.length) return;
    for (const id of want) this.loading.add(id);
    const metas = new Map((this.detail?.pages ?? []).map((p) => [p.id, p]));
    const fromServer: string[] = [];
    await Promise.all(
      want.map(async (id) => {
        const meta = metas.get(id);
        if (!meta) {
          // A page added on this device and not confirmed yet: it starts empty.
          this.known.set(id, 0);
          this.loading.delete(id);
          this.h.onInk(id, withPendingInk(id, [], this.outbox));
          return;
        }
        const cached = await idb.get<{ v: number; b: Uint8Array }>(`ink:${id}`);
        if (cached && cached.v === meta.inkVersion) {
          this.deliver(id, cached.v, cached.b);
        } else if (meta.inkVersion === 0) {
          this.deliver(id, 0, new Uint8Array());
        } else {
          fromServer.push(id);
          // Offline: show the older cached copy rather than nothing.
          if (cached && !navigator.onLine) this.deliver(id, cached.v, cached.b);
        }
      }),
    );
    if (fromServer.length) await this.fetchInk(fromServer, false);
  }

  private async fetchInk(ids: string[], refresh: boolean) {
    for (let i = 0; i < ids.length; i += INK_BATCH) {
      const chunk = ids.slice(i, i + INK_BATCH);
      for (const id of chunk) this.loading.add(id);
      try {
        const res = await call<InkResponse>(
          `/api/notebooks/${encodeURIComponent(this.notebookId)}/ink?pages=${chunk.map(encodeURIComponent).join(",")}`,
        );
        for (const p of res.pages) {
          const bytes = fromBase64(p.ink);
          void idb.set(`ink:${p.id}`, { v: p.inkVersion, b: bytes });
          this.deliver(p.id, p.inkVersion, bytes);
        }
      } catch {
        if (!refresh) this.setStatus("offline");
      } finally {
        for (const id of chunk) this.loading.delete(id);
      }
    }
  }

  private deliver(pageId: string, version: number, bytes: Uint8Array) {
    let strokes: Stroke[];
    try {
      strokes = decodePage(bytes);
    } catch {
      strokes = [];
    }
    this.known.set(pageId, version);
    this.loading.delete(pageId);
    this.h.onInk(pageId, withPendingInk(pageId, strokes, this.outbox));
  }
}
