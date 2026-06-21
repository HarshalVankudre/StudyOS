# Interactive React Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent place a live, interactive React component on a workspace page as a `react_artifact` block, rendered in a hard-sandboxed iframe.

**Architecture:** A new `react_artifact` block stores JSX source. A bundled runtime (`/public/embed/runtime.js`, built with esbuild) is loaded into a `sandbox="allow-scripts"` (opaque-origin) iframe served by `/embed/react` with a network-locked CSP; the parent posts the untrusted source via `postMessage`, the runtime transpiles it with Babel-standalone and renders `<App/>` inside an error boundary. The agent writes self-contained components (data baked in) via a planner-wired `interactive-builder` skill, compile-checked by a `check_component` tool. Entirely client-side — no Daytona, no migration.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19, TypeScript 5, Zod 4, Vitest, esbuild (build-time), `@babel/standalone`, `recharts`.

**Design source:** `docs/superpowers/specs/2026-06-21-interactive-react-artifacts-design.md`.

## Global Constraints

- **Containment, not trust.** Component source is UNTRUSTED. NEVER execute it server-side (no `eval`/`new Function` on source in Node — `check_component` does Babel **syntax transform only**). It runs ONLY inside the sandboxed iframe.
- **The iframe MUST be `sandbox="allow-scripts"` WITHOUT `allow-same-origin`** (opaque origin). A test asserts the attribute string.
- **CSP on `/embed/react`:** `default-src 'none'; script-src 'nonce-<per-request>' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; base-uri 'none'; form-action 'none'`. No `connect-src` (so `default-src 'none'` blocks all fetch/XHR/WebSocket → no exfiltration).
- **Entry-point contract:** component source defines a top-level component named `App`; the runtime renders `<App/>`. No ES-module `import`/`export` (libs are globals: `React`, `Recharts`).
- **React is 19.x — no UMD.** The runtime is esbuild-bundled from `src/embed/runtime/index.tsx`, not vendored UMD files.
- **Zod v4; Vitest**, colocated `*.test.ts(x)`. **Prisma not involved** (block is JSON; no migration).
- **Commands:** single test `pnpm exec vitest run <path>`; suite `pnpm test`; type-check `pnpm exec tsc --noEmit`; build `pnpm build`.
- **No feature flag** — this ships unconditionally (client-side, contained). The planner-menu entry is gated only on the skill being registered.

---

## File Structure

- Modify `src/lib/workspace/types.ts` — add `ReactArtifactBlock`.
- Modify `src/lib/workspace/schema.ts` — add `react_artifact` to the block union; export `MAX_COMPONENT_SOURCE`.
- Create `src/lib/workspace/react-artifact.test.ts`.
- Create `src/lib/ai/tools/component-tools.ts` — `check_component` tool.
- Create `src/lib/ai/tools/component-tools.test.ts`.
- Create `src/embed/runtime/index.tsx` — the iframe runtime (transpile + render + error boundary + height).
- Create `scripts/build-embed-runtime.mjs` — esbuild bundle → `public/embed/runtime.js`.
- Modify `package.json` — add deps + wire the runtime build into `build`.
- Create `src/app/embed/react/route.ts` — the runtime-shell route (HTML + nonce + CSP).
- Create `src/app/embed/react/route.test.ts`.
- Create `src/components/workspace/ReactArtifact.tsx` — parent iframe host (+ exported pure helpers).
- Create `src/components/workspace/ReactArtifact.test.ts` — helper tests.
- Modify `src/components/workspace/PageView.tsx` — `case "react_artifact"`.
- Modify `src/lib/ai/skills/catalog.ts` — `interactive-builder` skill + import component-tools.
- Modify `src/lib/ai/agent-loop.ts` — planner menu entry + `TOOL_INPUT_HINTS`.
- Modify `src/lib/i18n/dictionaries/*.ts` — block-type label (10 files).

---

### Task 1: `react_artifact` block type + schema

**Files:**
- Modify: `src/lib/workspace/types.ts`
- Modify: `src/lib/workspace/schema.ts`
- Test: `src/lib/workspace/react-artifact.test.ts`

**Interfaces:**
- Produces: `ReactArtifactBlock` in the `Block` union; the `react_artifact` schema variant; `export const MAX_COMPONENT_SOURCE = 100_000` (reused by Task 2's tool input cap).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/workspace/react-artifact.test.ts
import { describe, expect, it } from "vitest";
import { blockSchema, MAX_COMPONENT_SOURCE } from "@/lib/workspace/schema";

describe("react_artifact block", () => {
  const valid = { id: "b1", type: "react_artifact", title: "Grades", source: "function App(){return null}" };

  it("accepts a valid react_artifact block", () => {
    expect(blockSchema.safeParse(valid).success).toBe(true);
  });
  it("strips unknown keys", () => {
    const parsed = blockSchema.parse({ ...valid, evil: "x" });
    expect("evil" in parsed).toBe(false);
  });
  it("requires source and rejects oversized source", () => {
    const { source: _s, ...noSource } = valid;
    expect(blockSchema.safeParse(noSource).success).toBe(false);
    expect(blockSchema.safeParse({ ...valid, source: "x".repeat(MAX_COMPONENT_SOURCE + 1) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/workspace/react-artifact.test.ts`
Expected: FAIL — `react_artifact` variant and `MAX_COMPONENT_SOURCE` don't exist.

- [ ] **Step 3: Add the type**

In `src/lib/workspace/types.ts`: add `"react_artifact"` to `BlockType`, add the interface after `MediaBlock`, and add it to the `Block` union:

```ts
/** A live, interactive React component rendered in a sandboxed iframe. */
export interface ReactArtifactBlock extends BaseBlock {
  type: "react_artifact";
  title?: string;
  /** Self-contained JSX source defining a top-level `App` component. */
  source: string;
}
```
Add `| ReactArtifactBlock` to the `Block` union.

- [ ] **Step 4: Add the schema variant + cap**

In `src/lib/workspace/schema.ts`, above `export const workspaceSchema`, add:
```ts
/** Max bytes of a react_artifact component source (larger than a text field). */
export const MAX_COMPONENT_SOURCE = 100_000;
```
Add to the `block` discriminated union array (after the `media` entry):
```ts
  z.object({
    id: z.string(),
    type: z.literal("react_artifact"),
    title: z.string().optional(),
    source: z.string().min(1).max(MAX_COMPONENT_SOURCE),
  }),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/workspace/react-artifact.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspace/types.ts src/lib/workspace/schema.ts src/lib/workspace/react-artifact.test.ts
git commit -m "feat(workspace): add react_artifact block type"
```

---

### Task 2: `check_component` compile-check tool

**Files:**
- Create: `src/lib/ai/tools/component-tools.ts`
- Test: `src/lib/ai/tools/component-tools.test.ts`

**Interfaces:**
- Consumes: `MAX_COMPONENT_SOURCE` (Task 1); `ToolDefinition`/`ToolRegistry` (`./registry`).
- Produces: a registered tool `check_component` (input `{ source }`, output `{ ok, error? }`); `registerComponentTools(registry?)`.

- [ ] **Step 1: Add the dependency**

Run: `pnpm add @babel/standalone && pnpm add -D @types/babel__standalone`
Expected: both appear in `package.json`.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/ai/tools/component-tools.test.ts
import { describe, expect, it } from "vitest";
import { createToolRegistry } from "./registry";
import { registerComponentTools } from "./component-tools";

function reg() { const r = createToolRegistry(); registerComponentTools(r); return r; }

describe("check_component", () => {
  it("accepts valid JSX", async () => {
    const out = await reg().run("check_component", { source: "function App(){ return <div>hi</div>; }" }, { taskId: "t" });
    expect(out).toEqual({ ok: true });
  });
  it("reports a compile error for broken JSX", async () => {
    const out = (await reg().run("check_component", { source: "function App(){ return <div>; }" }, { taskId: "t" })) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(typeof out.error).toBe("string");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/ai/tools/component-tools.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement (syntax transform ONLY — never execute the source)**

```ts
// src/lib/ai/tools/component-tools.ts
import "server-only";
import { z } from "zod";
import { transform } from "@babel/standalone";
import { MAX_COMPONENT_SOURCE } from "@/lib/workspace/schema";
import { toolRegistry, type ToolRegistry } from "./registry";

export function registerComponentTools(registry: ToolRegistry = toolRegistry): void {
  registry.register({
    id: "check_component",
    description:
      "Compile-check a self-contained React component (JSX). Returns ok:true if it transpiles, else ok:false with the error to fix. The source must define a top-level `App` component and use ONLY the React and Recharts globals — no import/export statements.",
    input: z.object({ source: z.string().min(1).max(MAX_COMPONENT_SOURCE) }),
    output: z.object({ ok: z.boolean(), error: z.string().optional() }),
    limits: { timeoutMs: 5_000 },
    networkPermission: "none",
    handler: (input) => {
      try {
        // Syntax/transform check only. NEVER eval the result — the source is untrusted.
        transform(input.source, { presets: ["react"], filename: "component.tsx" });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "compile failed" };
      }
    },
    toProgress: (_i, o) => ({ title: o.ok ? "Component compiles" : "Fixing the component" }),
  });
}

registerComponentTools();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/ai/tools/component-tools.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/ai/tools/component-tools.ts src/lib/ai/tools/component-tools.test.ts
git commit -m "feat(agent): check_component syntax-check tool (no server-side eval)"
```

---

### Task 3: the iframe runtime + esbuild bundle

**Files:**
- Create: `src/embed/runtime/index.tsx`
- Create: `scripts/build-embed-runtime.mjs`
- Modify: `package.json` (deps + build script)

**Interfaces:**
- Produces: `public/embed/runtime.js` (the bundled runtime loaded by Task 4's route). Behavior contract: on load posts `{type:"ready"}` to `window.parent`; on `{type:"render",source}` transpiles + renders `<App/>`; posts `{type:"height",px}`.

This task has no unit test (it's browser/iframe code); its gate is that the bundle builds and Task 8 verifies it in a browser.

- [ ] **Step 1: Add dependencies**

Run: `pnpm add recharts && pnpm add -D esbuild`
Expected: `recharts` in dependencies, `esbuild` in devDependencies.

- [ ] **Step 2: Write the runtime**

```tsx
// src/embed/runtime/index.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import * as Recharts from "recharts";
import { transform } from "@babel/standalone";

const errStyle: React.CSSProperties = { padding: 16, font: "14px system-ui, sans-serif", color: "#b91c1c" };

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return React.createElement("div", { style: errStyle }, "⚠️ This component couldn't render: " + this.state.error.message);
    }
    return this.props.children as React.ReactElement;
  }
}

const root = createRoot(document.getElementById("root")!);

function renderSource(source: string) {
  let code: string | null | undefined;
  try {
    code = transform(source, { presets: ["react"], filename: "component.tsx" }).code;
  } catch (e) {
    root.render(React.createElement("div", { style: errStyle }, "⚠️ Couldn't compile: " + (e as Error).message));
    return;
  }
  try {
    // Untrusted code, but we are inside the opaque-origin sandbox with a network-locked CSP.
    const factory = new Function("React", "Recharts", `${code}\nreturn typeof App === "function" ? App : null;`);
    const App = factory(React, Recharts);
    if (!App) throw new Error("source must define a top-level `App` component");
    root.render(React.createElement(ErrorBoundary, null, React.createElement(App)));
  } catch (e) {
    root.render(React.createElement("div", { style: errStyle }, "⚠️ This component couldn't render: " + (e as Error).message));
  }
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window.parent) return;
  const d = ev.data as { type?: string; source?: unknown };
  if (d?.type === "render" && typeof d.source === "string") renderSource(d.source);
});

const post = (m: unknown) => window.parent.postMessage(m, "*");
new ResizeObserver(() => post({ type: "height", px: document.documentElement.scrollHeight })).observe(document.documentElement);
post({ type: "ready" });
```

- [ ] **Step 3: Write the esbuild build script**

```js
// scripts/build-embed-runtime.mjs
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("public/embed", { recursive: true });
await build({
  entryPoints: ["src/embed/runtime/index.tsx"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: "public/embed/runtime.js",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
});
console.log("built public/embed/runtime.js");
```

- [ ] **Step 4: Wire the runtime build into `package.json`**

Change the `build` script so the runtime bundles before the Next build:
```json
"build": "node scripts/build-embed-runtime.mjs && prisma generate && next build --webpack",
```
Add `public/embed/` to `.gitignore` (the bundle is a build artifact) by appending a line `public/embed/` — OR commit it; prefer gitignore to avoid a large committed bundle. Append to `.gitignore`:
```
/public/embed/
```

- [ ] **Step 5: Build the runtime and verify the bundle exists**

Run: `node scripts/build-embed-runtime.mjs`
Expected: prints `built public/embed/runtime.js`; the file exists and is non-trivial (`ls -la public/embed/runtime.js` shows a sizeable JS file — Babel-standalone makes it large; that's expected and cached at runtime).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore scripts/build-embed-runtime.mjs src/embed/runtime/index.tsx
git commit -m "feat(embed): sandboxed iframe runtime + esbuild bundle"
```

---

### Task 4: the `/embed/react` runtime-shell route

**Files:**
- Create: `src/app/embed/react/route.ts`
- Test: `src/app/embed/react/route.test.ts`

**Interfaces:**
- Consumes: `public/embed/runtime.js` (Task 3) at the URL `/embed/runtime.js`.
- Produces: `GET /embed/react` → HTML doc with a per-request nonce'd `<script src="/embed/runtime.js">` and the strict CSP header.

> Per `AGENTS.md`, confirm the App-Router route-handler shape for Next 16 (see `src/app/api/asset/[id]/route.ts` in-repo for the pattern). This route takes no params.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/embed/react/route.test.ts
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /embed/react", () => {
  it("returns HTML with a nonce'd runtime script and a locked-down CSP", async () => {
    const res = await GET();
    expect(res.headers.get("content-type")).toContain("text/html");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("connect-src"); // no connect-src -> default-src 'none' blocks fetch
    const html = await res.text();
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<script src="/embed/runtime.js" nonce="${nonce}">`);
  });

  it("uses a fresh nonce per request", async () => {
    const a = (await GET()).headers.get("content-security-policy");
    const b = (await GET()).headers.get("content-security-policy");
    expect(a).not.toEqual(b);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/app/embed/react/route.test.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement the route**

```ts
// src/app/embed/react/route.ts
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic"; // per-request nonce

export async function GET() {
  const nonce = randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const html =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<style>html,body{margin:0;padding:0}</style></head>` +
    `<body><div id="root"></div>` +
    `<script src="/embed/runtime.js" nonce="${nonce}"></script>` +
    `</body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/app/embed/react/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/embed/react/route.ts src/app/embed/react/route.test.ts
git commit -m "feat(embed): /embed/react runtime shell with nonce CSP"
```

---

### Task 5: parent iframe host component

**Files:**
- Create: `src/components/workspace/ReactArtifact.tsx`
- Test: `src/components/workspace/ReactArtifact.test.ts`

**Interfaces:**
- Produces: `ReactArtifact({ source, title })` React component (used by Task 6); exported pure helpers `clampArtifactHeight(px: number): number` and `isFromIframe(ev: MessageEvent, iframe: HTMLIFrameElement | null): boolean` (unit-tested).

- [ ] **Step 1: Write the failing test (pure helpers)**

```ts
// src/components/workspace/ReactArtifact.test.ts
import { describe, expect, it } from "vitest";
import { clampArtifactHeight, isFromIframe } from "./ReactArtifact";

describe("ReactArtifact helpers", () => {
  it("clamps height to a sane range", () => {
    expect(clampArtifactHeight(10)).toBe(60);
    expect(clampArtifactHeight(99999)).toBe(2000);
    expect(clampArtifactHeight(300)).toBe(300);
  });
  it("only accepts messages from our iframe's window", () => {
    const win = {} as Window;
    const iframe = { contentWindow: win } as HTMLIFrameElement;
    expect(isFromIframe({ source: win } as MessageEvent, iframe)).toBe(true);
    expect(isFromIframe({ source: {} as Window } as MessageEvent, iframe)).toBe(false);
    expect(isFromIframe({ source: win } as MessageEvent, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/components/workspace/ReactArtifact.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the host + helpers**

```tsx
// src/components/workspace/ReactArtifact.tsx
"use client";
import { useEffect, useRef, useState } from "react";

export function clampArtifactHeight(px: number): number {
  return Math.min(2000, Math.max(60, Math.round(px)));
}

export function isFromIframe(ev: MessageEvent, iframe: HTMLIFrameElement | null): boolean {
  return !!iframe && ev.source === iframe.contentWindow;
}

export function ReactArtifact({ source, title }: { source: string; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const iframe = ref.current;
      if (!isFromIframe(ev, iframe)) return;
      const d = ev.data as { type?: string; px?: unknown };
      if (d?.type === "ready") {
        iframe!.contentWindow?.postMessage({ type: "render", source }, "*");
      } else if (d?.type === "height" && typeof d.px === "number") {
        setHeight(clampArtifactHeight(d.px));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [source]);

  return (
    <figure className="my-3">
      {title ? <figcaption className="mb-1 text-xs text-ink-soft">{title}</figcaption> : null}
      {/* allow-scripts WITHOUT allow-same-origin => opaque origin (no parent access). */}
      <iframe
        ref={ref}
        src="/embed/react"
        sandbox="allow-scripts"
        title={title ?? "Interactive component"}
        style={{ width: "100%", height, border: 0 }}
        className="rounded-md border border-line bg-white"
      />
    </figure>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/components/workspace/ReactArtifact.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/ReactArtifact.tsx src/components/workspace/ReactArtifact.test.ts
git commit -m "feat(workspace): ReactArtifact iframe host (opaque-origin sandbox)"
```

---

### Task 6: render `react_artifact` in PageView + i18n

**Files:**
- Modify: `src/components/workspace/PageView.tsx`
- Modify: `src/lib/i18n/dictionaries/en.ts` (+ 9 siblings)

**Interfaces:**
- Consumes: `ReactArtifact` (Task 5).

- [ ] **Step 1: Add the renderer case**

In `src/components/workspace/PageView.tsx`, import the host at the top:
```tsx
import { ReactArtifact } from "./ReactArtifact";
```
Add a `case` to the `BlockView` switch (before `default`):
```tsx
    case "react_artifact":
      return <ReactArtifact source={block.source} title={block.title} />;
```

- [ ] **Step 2: Add i18n label**

In `src/lib/i18n/dictionaries/en.ts`, under `page.blockTypes`, add:
```ts
        react_artifact: "Interactive",
```
Mirror the key in each sibling dictionary (`de, es, fr, it, nl, pt, ja, zh, ar`) with a translated label. `tsc` enforces completeness.

- [ ] **Step 3: Type-check + build**

Run: `pnpm exec tsc --noEmit`
Expected: clean (all 10 dictionaries updated; the switch is exhaustive).

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/PageView.tsx src/lib/i18n/dictionaries
git commit -m "feat(workspace): render react_artifact blocks + i18n"
```

---

### Task 7: `interactive-builder` skill + planner wiring

**Files:**
- Modify: `src/lib/ai/skills/catalog.ts`
- Modify: `src/lib/ai/agent-loop.ts` (planner menu + `TOOL_INPUT_HINTS`)
- Test: extend `src/lib/ai/skills/catalog.test.ts` (or add `catalog.interactive.test.ts`)

**Interfaces:**
- Consumes: `check_component` (Task 2), `apply_ops` + inspect tools (existing).
- Produces: a registered `interactive-builder` skill reachable from the planner.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/skills/catalog.interactive.test.ts
import { describe, expect, it } from "vitest";
import { skillRegistry } from "./registry";
import "./catalog";

describe("interactive-builder skill", () => {
  it("is registered with check_component + apply_ops in its toolIds", () => {
    const skill = skillRegistry.get("interactive-builder");
    expect(skill).toBeTruthy();
    expect(skill!.toolIds).toContain("check_component");
    expect(skill!.toolIds).toContain("apply_ops");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/ai/skills/catalog.interactive.test.ts`
Expected: FAIL — skill not registered.

- [ ] **Step 3: Register the tool + skill**

In `src/lib/ai/skills/catalog.ts`, add an import near the other tool imports at the top:
```ts
import "../tools/component-tools"; // check_component
```
Inside `registerStage1Skills`, after the other skills, add:
```ts
  registry.register({
    id: "interactive-builder",
    version: "1.0.0",
    instructions:
      "Build ONE self-contained interactive React component. Write a top-level component named `App` (function App(){...}) using ONLY the globals `React` and `Recharts` (Recharts for charts) — NO import/export statements. If it needs data, read it first with the inspection tools and bake the values into the source as literals (it has no live data access). Call check_component and fix any error it reports. Then insert it via apply_ops with set_page_blocks as a block { type:'react_artifact', title:<short>, source:<the component> }. Keep ids exact.",
    toolIds: [...INSPECT, "check_component", "apply_ops"],
  });
```

- [ ] **Step 4: Wire the planner menu**

In `src/lib/ai/agent-loop.ts` `buildPlanMessages`, where the skill menu is computed (the same block that gates `render-visual`), extend it to also offer `interactive-builder` when registered. Replace the existing `canRender`/`skillMenu` computation with:
```ts
  const canRender = !!skillRegistry.get("render-visual");
  const canInteractive = !!skillRegistry.get("interactive-builder");
  const skillMenu = ["precise-edit", "study-planner",
    ...(canRender ? ["render-visual"] : []),
    ...(canInteractive ? ["interactive-builder"] : []),
  ].join("|");
```
And add a selection-hint line alongside the render-visual hint (only when available):
```ts
    canInteractive
      ? "Pick interactive-builder when the user wants a live/interactive widget — a chart of their data, a quiz, a calculator, or an interactive diagram."
      : "",
```
Add a `TOOL_INPUT_HINTS` entry:
```ts
  check_component: '{"source":"function App(){ return <div>...</div> }"}',
```

- [ ] **Step 5: Run the test + type-check**

Run: `pnpm exec vitest run src/lib/ai/skills/catalog.interactive.test.ts`
Then: `pnpm exec tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/skills/catalog.ts src/lib/ai/agent-loop.ts src/lib/ai/skills/catalog.interactive.test.ts
git commit -m "feat(agent): interactive-builder skill, planner-wired"
```

---

### Task 8: full gate + security keystone + acceptance

**Files:** none (verification only).

- [ ] **Step 1: Whole suite, lint, build**

Run: `pnpm test`
Run: `pnpm lint`
Run: `pnpm build`  (this runs the embed-runtime esbuild bundle, prisma generate, then `next build --webpack`)
Expected: all green; `public/embed/runtime.js` produced; the `/embed/react` route compiles.

- [ ] **Step 2: Security keystone (MUST PASS before exposing the feature)**

Run the app (`pnpm dev`), open a page, and have the agent (or a manual block insert) render a component whose `source` attempts to escape:
```jsx
function App(){
  let r = "ok";
  try { void window.parent.document; r = "LEAK parent.document"; } catch {}
  try { void document.cookie; } catch {}
  try { fetch("https://example.com"); r = "LEAK fetch"; } catch {}
  return <pre>{r}</pre>;
}
```
Expected: the component renders `ok` (or a thrown/blocked access), the network tab shows the `fetch` **blocked by CSP**, and `window.parent.document` access throws (opaque origin). Record the result. If any access succeeds, STOP — the sandbox/CSP is misconfigured; do not proceed.

- [ ] **Step 3: Acceptance**

In the running app, ask the agent: *"make an interactive chart of these numbers: 80, 92, 75, 88 and add it to the page."* Confirm a live Recharts chart renders inline, auto-sized, and Undo removes it. Try a deliberately broken component and confirm the error boundary shows instead of a blank frame.

- [ ] **Step 4: Commit (runbook note, if any infra docs change)**

No new infra. If you keep a verification note, add it under `docs/` and commit; otherwise nothing to commit here.

---

## Self-Review

**Spec coverage (against `2026-06-21-interactive-react-artifacts-design.md`):**
- §5 `react_artifact` block + source cap → Task 1. ✓
- §6 runtime shell, CSP, postMessage, Babel transpile, error boundary, auto-height → Tasks 3, 4. ✓
- §6 parent host + message validation → Task 5. ✓
- §4/§6 PageView render → Task 6. ✓
- §7 `interactive-builder` skill + planner menu + `check_component` → Tasks 2, 7. ✓
- §3/§8 containment (opaque-origin sandbox, no `connect-src`, no server-side eval) → Global Constraints + Tasks 4 (CSP), 5 (sandbox attr), 2 (transform-only) + Task 8 keystone. ✓
- §9 tests (unit/integration/security/acceptance) → Tasks 1–7 unit, Task 8 keystone + acceptance. ✓
- Undo (free via `WorkspaceChange`) → verified Task 8. ✓
- §8 separate-subdomain hardening → out of scope (v1.1), noted in spec. ✓
- §10 out-of-scope (PDF, live bridge, npm) → not implemented, correct. ✓

**Placeholder scan:** none — every code step is concrete; commands have expected output.

**Type consistency:** `MAX_COMPONENT_SOURCE` defined in Task 1, consumed in Task 2. `ReactArtifactBlock.{source,title}` (Task 1) consumed by `ReactArtifact({source,title})` (Task 5) and the PageView case (Task 6). Runtime message contract `{type:"ready"}` / `{type:"render",source}` / `{type:"height",px}` matches between the runtime (Task 3) and the host (Task 5). `check_component` id + `{source}`→`{ok,error?}` matches between Tasks 2 and 7. `clampArtifactHeight`/`isFromIframe` exported in Task 5 and tested there. ✓

**Note on Task 8 keystone:** it is a manual browser check (the iframe boundary can't be exercised in Vitest/jsdom). It is the gate that proves containment; do not expose the feature to users until it passes.
