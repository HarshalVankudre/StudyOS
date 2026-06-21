# Daytona Sandbox — Real Agent Execution with Visual Artifacts

> Status: approved design (2026-06-21). This document specifies replacing the
> deferred self-hosted OS-sandbox (Milestone Two) with **Daytona** as the
> execution backend, and adding the workspace primitive needed to actually
> *display* what the sandbox produces.
>
> It **builds on** and does not duplicate:
> - [`2026-06-20-agent-upgrade-design.md`](./2026-06-20-agent-upgrade-design.md)
>   — staging, tiered models, background execution (this is the deferred
>   "paid sandbox", now un-deferred via Daytona).
> - [`2026-06-19-workspace-agent-tools-design.md`](./2026-06-19-workspace-agent-tools-design.md)
>   and "Milestone One" — the tool-loop engine, candidate→validate→atomic-apply
>   path, durable/cancelable `AgentTask`, and the trust-boundary seams
>   (`ai/sandbox/snapshot.ts`, `ai/sandbox/result.ts`).
>
> Where this document is silent on engine internals (loop states, validation,
> persistence), Milestone One governs.

## 1. Summary

The workspace agent gains **one** new capability: run an isolated tool in an
ephemeral **Daytona** sandbox, produce a **visual artifact** (an image), and have
that artifact land in the user's workspace as a new `media` block — through the
same candidate→validate→atomic-apply path with Undo that every other agent edit
already uses.

"Install any tool" is delivered as a single generic tool (`run_in_sandbox`), not
as N features: LaTeX, Mermaid, graphviz, pandoc, matplotlib, etc. are all the
same tool with different commands. The model proposes the commands; trusted
application code executes them, bounds them, and owns every byte that crosses
back in.

This ships **internal-only first**, behind the existing `AGENT_SANDBOX` flag, to
measure real cost per run before any public gating model is chosen.

## 2. Why this is now cheap to ship

The original OS-sandbox (Milestone Two) was paused on **cost and security**: it
required self-hosting isolation in your own GCP project — a Cloud Run Job per
task, a zero-role service account, a VPC egress jail, Cloud Tasks, and the
**keystone** of empirically proving the metadata-server (169.254.169.254) block
from inside a deployed Job.

Daytona moves the isolation boundary **off your GCP project** into Daytona's
environment. That deletes the entire original keystone risk: there is no GCP
metadata server to steal, no IAM to escape, no VPC egress to jail, because the
container is not in your cloud. The explicit trade: **Daytona becomes the
isolation vendor.**

## 3. The pivotal constraint: the workspace cannot show an artifact today

`src/lib/workspace/types.ts` `BlockType` is entirely text-or-database-view:

```
heading | paragraph | todo | bulleted_list_item | numbered_list_item
| quote | callout | divider | database_view
```

There is **no image/file/asset/embed block and no binary storage anywhere**. So
"the sandbox compiled a PDF — how do I see it?" has a blunt answer today: you
can't, because the workspace has nowhere to put it.

Therefore the **first real work is a display primitive**, not the sandbox. The
sandbox is the easy half.

Two facts (verified against current code) keep this small:

- The workspace tree persists as a **JSON string** in `Workspace.data`
  (`prisma/schema.prisma`). A new block variant needs **no migration** — only
  the new `Asset` table does.
- `BlockView` is a clean `switch (block.type)` with `default: return null`
  (`src/components/workspace/PageView.tsx`). A `media` case is an isolated
  addition with zero risk to existing blocks.
- **Undo is free**: `WorkspaceChange` stores full before/after JSON snapshots, so
  reverting a media-block insert just restores JSON (the `Asset` row is harmlessly
  orphaned; GC is a later sweep).

## 4. Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | First wedge | One generic `run_in_sandbox` tool ("install any tool"), not per-tool features |
| 2 | Result type | Both visuals and structured data eventually; **visuals first** (the prerequisite) |
| 3 | Media kind (MVP) | **Image only** (PNG/SVG). PDF embedding is a later extension |
| 4 | Integration shape | **C** — Daytona as one ephemeral tool inside the existing background agent loop |
| 5 | Gating / cost | **Internal-only first** behind `AGENT_SANDBOX`; measure real cost before public |

### Approaches considered

- **A — run the whole agent task inside Daytona.** Rejected: overkill. The model
  loop is trusted and runs fine in-process; only *tool execution* needs
  isolation. Paying sandbox-minutes for thinking time is waste.
- **B — call the Daytona SDK directly from the request handler.** Rejected:
  installs + compiles take 10s–minutes and exceed the 120s route ceiling, with no
  cancellation and cold-start on top.
- **C — Daytona as one ephemeral tool inside the existing background `AgentTask`
  loop. CHOSEN.** Reuses background tasks, the tool/skill registry,
  candidate→validate→apply, the inbound/outbound seams, and the cancel flag.
  Scopes the paid container to the narrowest possible window.

## 5. Architecture & data flow

```
User asks → in-process agent loop (background AgentTask; Stage-1 engine)
   │  model decides it needs a render
   ▼
run_in_sandbox tool   ── TRUSTED, server owns every step ──┐
   1. create ephemeral Daytona sandbox (per invocation)    │
      from a prebuilt StudyOS image (toolchains preloaded)  │
   2. write ONLY agent-authored inputs (/work/main.tex)     │
      — never the workspace snapshot, creds, env, secrets   │
   3. exec setup (optional install) + run (compile)         │
   4. read declared outputs from /work/out/                 │
   5. destroy sandbox (finally) + reaper backstop           ─┘
   │
   ▼  returns artifact bytes + mime + size  ← UNTRUSTED
Trusted server (inbound artifact boundary):
   • byte-cap BEFORE store · MIME allowlist (png, svg) · server-generated key
   • store bytes in GCS → create Asset row → AssetHandle (id, mime, dims)
   • bytes never returned to the model — only the opaque handle
   │
   ▼
model emits apply_ops → insert a `media` block { assetId } into a page
   │
   ▼  existing candidate → validate → atomic apply + Undo
PageView renders the media block via <img src={short-lived signed GCS URL}>
```

**The whole effort is five pieces, nothing more:**

1. `media` block type — `workspace/types.ts` + schema + `PageView.tsx` renderer.
2. Asset storage — GCS bucket + one `Asset` table + owner-scoped signed-URL
   issuance.
3. `run_in_sandbox` — one `ToolDefinition` wrapping the Daytona SDK, registered
   only in the background path behind the flags.
4. Inbound artifact boundary — `parseSandboxArtifact()` alongside the existing
   `parseSandboxResult()` (cap → MIME allowlist → store → handle).
5. Gating — reuse `AGENT_SANDBOX` (already exists, OFF), internal-only, with hard
   caps and a global kill-switch.

**Explicitly NOT built:** VPC egress proxy, zero-role SA, metadata-server
hardening, Cloud Run Job per task — Daytona's isolation replaces all of it.

## 6. The `media` block + asset storage

**MVP media kind is `image` (PNG/SVG), not PDF — and this is not a compromise.**
A LaTeX page renders to PNG/SVG as easily as to PDF (`tectonic` →
`pdftoppm`/`dvisvgm`); diagrams are already SVG/PNG; plots are PNG. So the
sandbox step emits an image and the renderer is a single `<img>`.

This also avoids a real XSS trap: **SVG can execute scripts when inlined
(`<svg>` / `<object>` / `<iframe>`), but is inert when loaded via `<img src>`.**
Media blocks therefore render **only** through `<img>`, never inline. True PDF
embedding (`<iframe sandbox>`) is a trivial later extension.

```ts
// src/lib/workspace/types.ts — new variant (JSON only, no migration)
export interface MediaBlock extends BaseBlock {
  type: "media";
  assetId: string;        // FK into Asset; never a raw or permanent URL
  mediaKind: "image";     // "pdf" later
  mime: string;           // image/png | image/svg+xml (cached for render)
  width?: number;
  height?: number;        // cached intrinsic dims to reserve layout
  caption?: string;       // editable via existing BlockText
  alt?: string;           // accessibility
}
```

Add `MediaBlock` to the `Block` union and the Zod workspace schema (unknown keys
stripped on parse, like every other block). Add a `case "media"` to `BlockView`
rendering `<img>` + optional caption; the block is read-only in the editor except
caption + delete.

```prisma
// prisma/schema.prisma — the ONLY migration in this effort
model Asset {
  id          String   @id @default(cuid())
  ownerId     String                 // owner-scoped like everything else
  workspaceId String?
  mime        String
  sizeBytes   Int
  storageKey  String                 // GCS object path (server-generated)
  sourceRunId String?                // AgentTask that produced it (audit)
  checksum    String?
  createdAt   DateTime @default(now())
  @@index([ownerId])
}
```

- Bytes live in a **GCS bucket** (reachable from both the Vercel and Cloud Run
  deployments). The block stores `assetId`, never bytes or a permanent URL.
- **Render-time hydration:** when the page API loads a workspace, for each `media`
  block it issues a **short-TTL signed GCS URL** after an owner check. The client
  renders `<img src={signedUrl}>`. URLs expire; assets are never public.

## 7. The `run_in_sandbox` tool contract

One `ToolDefinition`, registered only when `AUTHENTIC_AGENT` **and**
`AGENT_SANDBOX` are on, and callable only inside the background `AgentTask` path.

```ts
// model-facing input — the model proposes; trusted code bounds & executes
run_in_sandbox({
  inputs:  [{ path: "main.tex", content: "<agent-authored source>" }], // ≤N files, ≤size each
  setup:   ["tlmgr install foo"],   // OPTIONAL installs; ≤M commands; usually empty
  run:     ["tectonic main.tex",
            "pdftoppm -png -r 200 main.pdf out/page"],                  // ≤M commands
  outputs: ["out/page-1.png"],      // declared artifacts; MUST live under out/
  timeoutSec: 120                   // clamped to the hard cap
})
// → returned to the model loop:
{
  artifacts: [{ assetId, mime, width, height, filename }],  // AssetHandle[] — NOT bytes
  logTail: "<last few KB of stdout/stderr>",                // bounded; for the model to observe
  exitCode: 0
}
```

**Trusted handler sequence (server-owned):**

1. Validate input against a bounded schema: file count/size, command count,
   every `outputs` path resolves under `out/`, `timeoutSec` clamped.
2. Create an **ephemeral Daytona sandbox** from a **prebuilt StudyOS snapshot
   image** with common toolchains preinstalled (tectonic/TeX, mermaid-cli,
   graphviz, pandoc, python+matplotlib). Most renders therefore use `setup: []`
   — no install, no meaningful egress, a few seconds, cheapest path. `setup` is
   only for the long tail.
3. Write `inputs` into `/work`. Nothing else is written — no workspace snapshot,
   no secrets, no env. (Intentionally tighter than `snapshot.ts`, which is **not**
   used on this path.)
4. `exec` setup then run under a wall-clock deadline (`AbortSignal`).
5. Read declared `outputs`; run each through the **inbound artifact boundary**
   (§8). Reject anything oversized or off-allowlist.
6. `finally`: destroy the sandbox (plus reaper backstop, §9).
7. Return `AssetHandle[]` + bounded `logTail`. The model then emits `apply_ops`
   inserting one `media` block per artifact through the existing
   candidate→validate→atomic-apply path.

**Invariant (from Milestone One):** the model never sees artifact bytes — only an
opaque handle — and the artifact reaches the workspace only as a typed op through
the apply boundary already trusted.

## 8. Security posture

- **Isolation is Daytona's**, off your GCP project. No metadata server, IAM, or
  VPC egress to defend. Accepted trade: Daytona is the isolation vendor.
- **The sandbox is fed nothing sensitive** — only agent-authored input files. No
  workspace snapshot, DB creds, API keys, or env vars. A fully compromised
  sandbox has nothing of the user's to exfiltrate; it only ever saw a file the
  agent itself wrote. This is the property that makes everything else safe.
- **Egress is allowed** (installs need it) precisely because there is no secret or
  user data in the container, and the network is Daytona's, not yours.
- **Inbound artifacts are untrusted:** byte-cap *before* store → MIME allowlist
  (`image/png`, `image/svg+xml`) → **server-generated `storageKey`** (the
  sandbox's filename is never trusted) → stored opaque, never executed → served
  only via `<img src>` signed URL (SVG inert as an image). A CSP backstop is set
  on the asset-serving path.
- **Prompt-injection invariant holds:** nothing the model reads or the sandbox
  emits can change tool permissions, budgets, system instructions, or apply
  policy — those are fixed in app code.
- **Daytona API key** is a server-only secret (existing secret mechanism / GCP
  Secret Manager), never exposed to the model or to tools.
- **Logs** store IDs, timings, exit codes, sizes, and safe categories — never raw
  source, artifact bytes, secrets, or full sandbox output.

## 9. Lifecycle & cost

- **Ephemeral per invocation:** create → run → `destroy` in a `finally`.
- **Reaper backstop:** set Daytona's own auto-delete TTL aggressively so a server
  crash between create and destroy still kills the container vendor-side; also
  track the live sandbox id on the `AgentTask` and sweep orphans.
- **Cancellation:** task cancelled mid-render → the tool's `AbortSignal` fires →
  sandbox destroyed → no artifact, no apply. The loop already checks the cancel
  flag before/after every tool call.
- **Cost caps (internal-only first):**
  - `AGENT_SANDBOX` OFF in prod; ON only for the internal cohort. Flipping it off
    is the **global kill-switch** (the tool unregisters instantly).
  - Hard caps: per-run wall-clock ≤120–180s (clamped); **1 concurrent sandbox per
    user**; a small global concurrent ceiling; a daily run quota per user.
  - **Instrument cost per run** (sandbox-seconds, run count) — the exact data
    missing when the effort was paused. The internal phase exists to produce these
    numbers before any public gating model is chosen.
  - The prebuilt image keeps the common path install-free, so typical cost is a
    few compile-seconds, not multi-minute `apt`/`tlmgr` pulls.

## 10. Testing strategy

- **Unit (no Daytona):** input-schema bounds (file count/size, command count,
  `outputs` resolves under `out/`, timeout clamp); inbound boundary (oversized →
  reject, bad MIME → reject, server-generated key); `media` block schema strips
  unknown keys; Asset owner-scoping on signed-URL issuance and page hydration;
  an assertion that the render path is `<img>`, never inline `<svg>`/`<object>`.
- **Integration (fake Daytona client injected):** happy path write→exec→pull→
  store→`apply_ops`→media block present in JSON + Asset row exists;
  compile-failure → safe `logTail`, no apply, model can repair within budget;
  cancel mid-render → `destroy` called, no apply; orphan reaper on simulated
  crash; cross-tenant isolation (user B cannot resolve user A's asset); size/MIME
  rejection leaves workspace + assets unchanged.
- **Real-Daytona smoke (manual/internal, NOT in CI):** one LaTeX formula → PNG
  appears in a page. **This is the empirical keystone for this effort** — the
  analog of the original "prove the metadata block": prove the
  create→exec→pull→destroy loop *and capture real cost per run* before widening
  past internal.
- **UI:** media block renders desktop/tablet/mobile + dark mode; caption editable;
  delete + Undo remove it; all locales (new i18n strings).
- **Browser acceptance:** "render the quadratic formula as an image" → block
  appears, is undoable; cancel a long render (no block appears); close/reopen
  during render recovers via the existing reconnect path.

## 11. Open details for planning

1. Exact Daytona SDK surface; where the prebuilt snapshot image is defined and
   maintained (e.g. `infra/sandbox/`), and how it is versioned/rebuilt.
2. Daytona API-key secret storage and rotation (server-only).
3. Background-task execution mechanism on Cloud Run (in-process detached vs.
   queued worker) — inherited open question from the parent design; the sandbox
   tool runs wherever that lands.
4. Asset GC-sweep policy for orphaned assets (deferred follow-up).
5. PDF as the second `media` kind (`<iframe sandbox>`).
6. Optional manual "upload image" block reusing the same Asset + `media` path
   (natural freebie; out of scope unless wanted).
7. GCS bucket provisioning + IAM for signed-URL issuance from both deployments.

## 12. Success criteria

- The agent can run a tool in a Daytona sandbox and the resulting **image appears
  in the user's workspace** as a `media` block, through the existing
  candidate→validate→atomic-apply path, and is **undoable**.
- The sandbox receives only agent-authored inputs — never workspace data,
  secrets, or env — verified by test.
- Inbound artifacts are size- and MIME-bounded; no artifact bytes ever reach the
  model; cross-tenant assets are isolated.
- A render can outlive the request (background task) and be cancelled reliably
  with no apply.
- Cost per run is instrumented and observable throughout the internal phase.
- Lint, tests, type-checking, production build, and the Neon migration check for
  the `Asset` table all pass.
