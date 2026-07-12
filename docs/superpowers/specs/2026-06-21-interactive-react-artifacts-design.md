# Interactive React Artifacts — Live Components in the Workspace

> Status: approved design (2026-06-21). Adds a second artifact type to the
> StudyOS workspace: **live, interactive React components** the agent writes,
> rendered in a hard-sandboxed iframe.
>
> Sibling to the image-render feature
> ([`2026-06-21-daytona-sandbox-design.md`](./2026-06-21-daytona-sandbox-design.md)),
> but a **separate, client-side pipeline** — it does not use Daytona. It shares
> only the pattern "agent produces an artifact → it becomes a workspace block,"
> the candidate→validate→atomic-apply path, and the planner-menu lesson learned
> from that feature (registering a skill ≠ making it reachable).

## 1. Summary

The agent can build a **self-contained interactive React component** (a chart of
the student's data, a quiz, a calculator, an interactive diagram) and place it on
a page as a new `react_artifact` block. The component is **untrusted code** —
agent-generated, and the model can be prompt-injected via workspace or web
content — so it is never trusted; it is **contained** in a hard-sandboxed iframe
running on an opaque origin with a network-locked CSP. The component is
**self-contained**: any data it needs is read from the workspace and baked into
the source at generation time. No live data bridge, no write-back (both are
explicit non-goals for v1).

## 2. Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Execution model | **Client-runtime sandboxed iframe** — store JSX source, transpile + run in an isolated iframe. No server build, no Daytona. |
| 2 | Data access | **Self-contained** — agent bakes any needed data into the source at generation. No live bridge, no write-back. |
| 3 | Transpile runtime | **Babel-standalone** in the iframe (esbuild-wasm is a later drop-in behind the same interface). |
| 4 | Isolation | `sandbox="allow-scripts"` **without** `allow-same-origin` (opaque origin) + strict CSP (`connect-src` none). |
| 5 | Library allowlist (v1) | React + ReactDOM + Recharts + inline styling. Extensible. |

### Approaches considered (execution model)

- **Client-runtime iframe (CHOSEN).** Arbitrary interactive React, instant, no
  server cost; how Claude Artifacts / CodeSandbox work.
- **Build-in-Daytona → bundle → iframe.** Rejected for v1: adds a paid container
  per build and seconds of latency for no benefit when the runtime can transpile
  client-side. Supports npm deps — revisit only if the allowlist proves limiting.
- **Declarative component catalog.** Rejected: safe but not "any React
  component"; limited to pre-built widgets. (This was the deferred presentation
  catalog from the agent-upgrade design.)

## 3. The pivotal constraint: containment, not trust

The component source is untrusted. We do not sanitize or analyze it for safety —
we **contain** it so that even fully malicious code is harmless:

- `sandbox="allow-scripts"` **without** `allow-same-origin` gives the iframe a
  **unique opaque origin**. It cannot read the parent's cookies, `localStorage`,
  DOM, or call StudyOS APIs as the user.
- A strict CSP with **no `connect-src`** means the component **cannot fetch,
  XHR, WebSocket, or beacon** — no data can leave the iframe.
- Untrusted source is delivered via `postMessage` *after* the iframe loads, so it
  is **never inlined into the parent's HTML**.

Worst case is a component that throws (caught by an error boundary) — never a
data leak or a same-origin escape.

## 4. Architecture & data flow

```
Agent (interactive-builder skill)
   │  reads workspace data if needed → BAKES it into the JSX as literals
   ▼
check_component(source)   ← Babel-in-Node compile check; broken → repair signal
   ▼
apply_ops → insert react_artifact block { title, source } into a page
   │   (workspace JSON → Undo + versioning for free, like every block)
   ▼
PageView: <iframe sandbox="allow-scripts" src="/embed/react">   (NO allow-same-origin)
   │   parent → iframe: postMessage({ source }) after ready handshake
   ▼
Runtime shell (served by /embed/react, strict CSP, bundled libs):
   1. validate handshake, receive source
   2. Babel.transform(source, {presets:['react']}) → eval
   3. render inside an error boundary (+ transpile-error catch)
   4. ResizeObserver → postMessage height → parent sizes the iframe
   ▼
Live interactive component, fully isolated.
```

**New/changed pieces (all client-side except the skill/tool):**
1. `react_artifact` block type — `workspace/types.ts` + schema (with a dedicated
   source-size cap) + `PageView.tsx` renderer.
2. The **runtime shell** — a route `GET /embed/react` serving a static HTML doc
   that bundles React + ReactDOM + Babel-standalone + Recharts, with the strict
   CSP, the `postMessage` receiver, the transpile+render+error-boundary, and the
   auto-height reporter.
3. A small **iframe-host renderer component** on the parent side that mounts the
   iframe, performs the ready handshake, posts the source, and applies the
   reported height.
4. `interactive-builder` **skill** (`catalog.ts`) + its entry in the planner menu
   (`buildPlanMessages`).
5. `check_component` **tool** — Babel-in-Node compile check returning ok/error.

Nothing here touches Daytona, GCS, or the image pipeline.

## 5. The `react_artifact` block

```ts
// workspace/types.ts — new variant (JSON only, no migration)
export interface ReactArtifactBlock extends BaseBlock {
  type: "react_artifact";
  title?: string;
  source: string; // JSX/TSX component source
}
```

- Add to the `Block` union and `BlockType`; add to the Zod `blockSchema`
  discriminated union with `source: z.string().max(MAX_COMPONENT_SOURCE)`.
- `MAX_COMPONENT_SOURCE` ≈ 100 KB — components are larger than a text field, so
  this is a dedicated cap, distinct from the 20 KB agent op-string cap. The whole
  agent result is still bounded by `maxResultBytes` (2 MB).
- **Entry-point contract:** the source defines a single top-level component
  named `App` (e.g. `function App() { … }` or `const App = () => …`). The runtime
  renders `<App/>`. (Not ES-module `export default` — the runtime evaluates the
  Babel-transpiled JSX in a non-module scope, so a named `App` global is the
  reliable entry point.) The skill instructions pin this contract.

## 6. The runtime shell (`/embed/react`)

A route returning a static, cacheable HTML document. It loads **only
same-origin, bundled** assets (React, ReactDOM, Babel-standalone, Recharts) — no
third-party CDN — so the CSP can be tight.

**Response headers / CSP** (the network lockdown):
```
Content-Security-Policy:
  default-src 'none';
  script-src 'self' 'unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  font-src 'self' data:;
  base-uri 'none'; form-action 'none';
```
- No `connect-src` → no `fetch`/XHR/WebSocket/`sendBeacon`: the component cannot
  exfiltrate.
- `'unsafe-eval'` is required (Babel transpiles → eval/`new Function`) and is safe
  here precisely because the iframe's opaque origin holds nothing sensitive.

**Runtime script behavior:**
1. On load, `postMessage({ type: "ready" })` to the parent; wait for
   `{ type: "render", source }`. Validate the message shape; ignore others.
2. `Babel.transform(source, { presets: ["react"], filename: "component.tsx" })`.
   On throw → render a "couldn't compile" notice with the message.
3. Evaluate the transpiled code in a scope exposing only `React`, `ReactDOM`,
   `Recharts` (and the standard JS globals the opaque origin already has), then
   read the `App` global the source defines (§5 entry-point contract).
4. Render `<ErrorBoundary><Component/></ErrorBoundary>` into the root. The error
   boundary renders "⚠️ This component couldn't render" on a runtime throw.
5. A `ResizeObserver` on the root posts `{ type: "height", px }` to the parent.

**Parent-side host component:** renders
`<iframe sandbox="allow-scripts" src="/embed/react">`, waits for `ready`, posts
`{ type: "render", source }`, and sets the iframe height from `height` messages.
It validates `event.source === iframe.contentWindow` on inbound messages.

## 7. Agent integration

- **Skill `interactive-builder`** (`catalog.ts`): tools = inspection
  (`summarize_workspace`/`find_entities`/`read_area`/`inspect_workspace`) +
  `check_component` + `apply_ops`. Instructions: write ONE self-contained React
  component using only the available globals (`React`, `Recharts`); read needed
  data first and bake it in as literals; the component must define the entry the
  runtime expects (§5); call `check_component` and fix any compile error; then
  insert a `react_artifact` block via `apply_ops` (`set_page_blocks`).
- **Planner menu** (`buildPlanMessages`): add `interactive-builder` to the
  skill options **only when `skillRegistry.get("interactive-builder")` is
  present**, with a selection hint ("a live/interactive widget — chart of their
  data, quiz, calculator, interactive diagram"). This is the lesson from the
  image-render rollout: a registered skill is unreachable unless the planner is
  told about it.
- **`check_component` tool:** `ToolDefinition` with `input { source }`, `output
  { ok, error? }`; handler runs Babel transform in Node (bounded input size,
  timeout) and returns the compile result. `networkPermission: "none"`.

## 8. Security & reliability

- **Containment over trust** (§3): opaque-origin sandbox + no-`connect-src` CSP +
  postMessage source delivery. A malicious component cannot reach the parent
  origin, cookies, storage, APIs, or the network.
- **Prompt-injection invariant:** content the model reads cannot change the
  sandbox attributes, CSP, tool permissions, or apply policy — those are fixed in
  app code.
- **No same-origin escape hatch:** the iframe MUST NOT be given
  `allow-same-origin`; a test asserts the attribute string.
- **Failure isolation:** transpile errors and runtime throws are caught in the
  iframe; a broken component degrades to an inline error, never a broken page.
- **Hardening (v1.1, flagged):** serve `/embed/react` from a separate subdomain
  (e.g. `embed.studyos…`) for true cross-origin isolation on top of the
  opaque-origin sandbox. v1 guarantee is the sandbox attribute + CSP.
- **Undo/versioning:** the block lives in workspace JSON, so removal and revert
  are free via the existing `WorkspaceChange` snapshots.

## 9. Testing

- **Unit:** `react_artifact` block schema (source cap; strips unknown keys);
  `check_component` (valid JSX → ok, broken JSX → error); planner menu includes
  `interactive-builder` only when the skill is registered; the host component's
  inbound-message validation (rejects wrong source/shape).
- **Integration (fake model):** loop → `interactive-builder` → `check_component`
  repair on a deliberately broken component → valid `react_artifact` block in the
  workspace JSON; Undo removes it.
- **Security keystone (gates rollout):** a component whose source attempts
  `document.cookie`, `parent.location`, `localStorage`, or `fetch("https://…")`
  is contained — the first three are denied by the opaque origin, the fetch by
  CSP `connect-src 'none'`. Verified with a runtime harness + manual check. This
  is the analog of the OS-sandbox metadata-block keystone.
- **UI/acceptance:** "make an interactive chart of my grades" → a live Recharts
  chart on the page; "make a flashcard quiz" → an interactive quiz; a broken
  component shows the error boundary, not a blank frame; auto-height with no
  inner scrollbar; dark mode; mobile.

## 10. Out of scope (separate follow-ups)

- **Static-artifact broadening** (PDF download, raw HTML embeds) — a small
  separate pass on the existing media/asset infra; not part of this spec.
- **Live data bridge / write-back** — explicit v1 non-goals; would require a
  controlled postMessage data channel and (for write-back) the full
  candidate→validate→apply rigor applied to iframe-originated ops.
- **Arbitrary npm dependencies** — v1 is a fixed allowlist; npm support would
  pull in the Daytona-build approach (approach 2).
- **Separate-subdomain isolation** — v1.1 hardening (§8).

## 11. Success criteria

- The agent can produce a working interactive component (e.g. a Recharts chart of
  the student's real data) that renders live on a page, and is **undoable**.
- The component is provably contained: no access to parent origin, cookies,
  storage, APIs, or network — verified by the security keystone test.
- Broken or malicious source degrades to an inline error, never a broken page or
  a leak.
- `interactive-builder` is reachable from the planner (not a registered-but-dead
  skill).
- Lint, tests, type-checking, and the production build pass. (No DB migration —
  the block is JSON; no new cloud infra.)
