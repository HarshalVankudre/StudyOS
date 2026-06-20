# Note Block Typeset Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render note blocks as typeset Markdown + KaTeX math (matching the AI chat) while keeping them editable via a live-split read/edit control.

**Architecture:** Extract the chat's Streamdown plugin set into a shared module. Add a read-only `RichText` renderer that sanitizes LaTeX text commands at render time and feeds Streamdown (Markdown + KaTeX + code). Add a `BlockText` control that shows the typeset render when idle and, when focused, shows the raw `<input>` plus a live-updating preview. Swap every text block's bare `<input>` in `PageView` for `BlockText`.

**Tech Stack:** Next.js (React 19, client components), `streamdown` + `@streamdown/{cjk,code,math,mermaid}`, KaTeX (CSS already global), Vitest + jsdom + React Testing Library.

## Global Constraints

- This is NOT stock Next.js — read the relevant guide in `node_modules/next/dist/docs/` before writing framework-coupled code (per `AGENTS.md`). The components here are plain client components, so this is low-risk, but heed it.
- KaTeX CSS is already imported globally at `src/app/layout.tsx:4` (`import "katex/dist/katex.min.css";`). Do NOT re-import it.
- No new dependencies. Everything needed (`streamdown`, `@streamdown/*`, `katex`) is already installed.
- No changes to `src/lib/ai/generate.ts` and no data migration — `RichText` sanitizes at render time.
- Tests: Vitest is configured WITHOUT globals. Import `describe/it/expect/vi` from `"vitest"`. Setup file (`src/test/setup.ts`) already wires `@testing-library/jest-dom` and auto-cleanup. Run a single file with `pnpm exec vitest run <path>`.
- Render-time sanitize uses the EXISTING `sanitizeLatexText` from `src/lib/ai/sanitize.ts` — do not reimplement it.

---

### Task 1: Shared Streamdown plugin module

Extract the plugin object currently inline in `message.tsx` so chat and notes render identically. This is a behavior-preserving refactor verified by the existing suite + lint.

**Files:**
- Create: `src/lib/streamdown-plugins.ts`
- Modify: `src/components/ai-elements/message.tsx:15-18` (imports) and `:325-330` (local `streamdownPlugins`)

**Interfaces:**
- Produces: `export const streamdownPlugins` — a plugin record `{ cjk, code, math, mermaid }` consumed by `message.tsx` (Task 1) and `RichText` (Task 2).

- [ ] **Step 1: Create the shared plugin module**

Create `src/lib/streamdown-plugins.ts`:

```ts
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";

/**
 * Streamdown plugin set shared by the AI chat (message.tsx) and the note-block
 * renderer (RichText). Single source of truth so both render identically:
 * Markdown + KaTeX math (single- and double-dollar) + code + mermaid + CJK.
 */
export const streamdownPlugins = {
  cjk,
  code,
  math: createMathPlugin({ singleDollarTextMath: true }),
  mermaid,
};
```

- [ ] **Step 2: Point message.tsx at the shared module**

In `src/components/ai-elements/message.tsx`, remove the four `@streamdown/*` imports (lines 15-18) and the local `streamdownPlugins` constant (lines 325-330), and import the shared one. The imports block at the top becomes (keep `sanitizeLatexText` if still used elsewhere in the file — it is imported at line 19; leave it):

Replace lines 15-18:
```tsx
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
```
with:
```tsx
import { streamdownPlugins } from "@/lib/streamdown-plugins";
```

Then delete the local constant (lines 325-330):
```tsx
const streamdownPlugins = {
  cjk,
  code,
  math: createMathPlugin({ singleDollarTextMath: true }),
  mermaid,
};
```
The `<Streamdown plugins={streamdownPlugins} ...>` usage in `MessageResponse` stays unchanged — it now references the imported constant.

- [ ] **Step 3: Verify no regressions**

Run: `pnpm exec vitest run`
Expected: PASS — same number of passing tests as before (no chat test depends on the local constant; the refactor is behavior-preserving).

Run: `pnpm lint`
Expected: clean (no unused-import errors for the removed `@streamdown/*` imports).

- [ ] **Step 4: Commit**

```bash
git add src/lib/streamdown-plugins.ts src/components/ai-elements/message.tsx
git commit -m "refactor: extract shared Streamdown plugin set"
```

---

### Task 2: RichText read-only renderer

A memoized component that sanitizes LaTeX text commands at render time and renders Markdown + KaTeX via Streamdown.

**Files:**
- Create: `src/components/RichText.tsx`
- Test: `src/components/RichText.test.tsx`

**Interfaces:**
- Consumes: `streamdownPlugins` from `@/lib/streamdown-plugins` (Task 1); `sanitizeLatexText` from `@/lib/ai/sanitize`; `cn` from `@/lib/utils`.
- Produces: `export function RichText(props: { text: string; className?: string }): JSX.Element` — consumed by `BlockText` (Task 3).

- [ ] **Step 1: Write the failing test**

Create `src/components/RichText.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Render Streamdown as a passthrough so we can assert exactly what text
// RichText feeds it (i.e. that sanitize ran). The real Streamdown needs
// browser layout APIs we don't exercise here.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => (
    <div data-testid="md">{children}</div>
  ),
}));
// Stub the plugin set so the @streamdown/* factories never load in jsdom.
vi.mock("@/lib/streamdown-plugins", () => ({ streamdownPlugins: {} }));

import { RichText } from "./RichText";

describe("RichText", () => {
  it("converts stray LaTeX text commands to Markdown before rendering", () => {
    render(<RichText text={"Use \\texttt{SELECT} now"} />);
    expect(screen.getByTestId("md")).toHaveTextContent("Use `SELECT` now");
  });

  it("leaves real math regions untouched for KaTeX", () => {
    render(<RichText text={"x $\\wedge$ y"} />);
    expect(screen.getByTestId("md")).toHaveTextContent("x $\\wedge$ y");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/RichText.test.tsx`
Expected: FAIL — `Failed to resolve import "./RichText"` (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/components/RichText.tsx`:

```tsx
"use client";

import { memo } from "react";
import { Streamdown } from "streamdown";
import { sanitizeLatexText } from "@/lib/ai/sanitize";
import { streamdownPlugins } from "@/lib/streamdown-plugins";
import { cn } from "@/lib/utils";

export type RichTextProps = {
  text: string;
  className?: string;
};

/**
 * Read-only Markdown + KaTeX renderer for note-block text. Sanitizes stray
 * LaTeX text commands (\texttt{}, \textbf{}, ...) to Markdown at render time so
 * existing AI-generated notes render without a data migration; real $...$ /
 * $$...$$ math is preserved and typeset by KaTeX.
 */
export const RichText = memo(function RichText({ text, className }: RichTextProps) {
  return (
    <Streamdown
      className={cn("[&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      plugins={streamdownPlugins}
    >
      {sanitizeLatexText(text)}
    </Streamdown>
  );
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/RichText.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/RichText.tsx src/components/RichText.test.tsx
git commit -m "feat: add RichText renderer for note-block markdown + math"
```

---

### Task 3: BlockText live-split read/edit control

Shows the typeset render when idle; when focused, shows the raw `<input>` plus a live preview that updates as you type; commits on blur.

**Files:**
- Create: `src/components/workspace/BlockText.tsx`
- Test: `src/components/workspace/BlockText.test.tsx`

**Interfaces:**
- Consumes: `RichText` from `@/components/RichText` (Task 2); `cn` from `@/lib/utils`.
- Produces: `export function BlockText(props: { value: string; onCommit: (text: string) => void; placeholder?: string; className?: string }): JSX.Element` — consumed by `PageView` (Task 4). The same `className` is applied to BOTH the rendered output and the raw `<input>` so typography is identical in read and edit modes.

- [ ] **Step 1: Write the failing test**

Create `src/components/workspace/BlockText.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// RichText pulls in Streamdown; render it as a passthrough so the preview's
// text is directly assertable and no browser layout APIs are needed.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => (
    <div data-testid="md">{children}</div>
  ),
}));
vi.mock("@/lib/streamdown-plugins", () => ({ streamdownPlugins: {} }));

import { BlockText } from "./BlockText";

describe("BlockText", () => {
  it("renders the value typeset when idle", () => {
    render(<BlockText value="hello" onCommit={vi.fn()} />);
    expect(screen.getByTestId("md")).toHaveTextContent("hello");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the placeholder when empty and idle", () => {
    render(<BlockText value="" onCommit={vi.fn()} placeholder="Type here" />);
    expect(screen.getByText("Type here")).toBeInTheDocument();
  });

  it("reveals a raw input with a live preview on focus, and commits on blur", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<BlockText value="hello" onCommit={onCommit} />);

    await user.click(screen.getByText("hello"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("hello");

    await user.clear(input);
    await user.type(input, "world $x$");
    // Live preview reflects the draft as it is typed.
    expect(screen.getByTestId("md")).toHaveTextContent("world $x$");

    await user.tab(); // blur
    expect(onCommit).toHaveBeenCalledWith("world $x$");
    // Back to read mode showing the committed value.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByTestId("md")).toHaveTextContent("hello");
  });
});
```

Note on the last assertion: `BlockText` is uncontrolled with respect to `value` (the parent re-renders it with the new `value` via a key bump after commit — Task 4). In isolation here the prop stays `"hello"`, so after blur the read view shows the original `value`. That is the correct in-isolation behavior.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/workspace/BlockText.test.tsx`
Expected: FAIL — `Failed to resolve import "./BlockText"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/workspace/BlockText.tsx`:

```tsx
"use client";

import { useState } from "react";
import { RichText } from "@/components/RichText";
import { cn } from "@/lib/utils";

export type BlockTextProps = {
  value: string;
  onCommit: (text: string) => void;
  placeholder?: string;
  className?: string;
};

/**
 * Live-split read/edit control for a single line of note-block text.
 * - Idle: renders `value` typeset via RichText (placeholder when empty).
 * - Focused: shows the raw <input> plus a live RichText preview of the draft;
 *   commits the draft on blur and returns to the typeset render.
 * The same `className` styles both modes so typography never shifts. The parent
 * remounts this component (key bump) after AI edits, resetting local state.
 */
export function BlockText({ value, onCommit, placeholder, className }: BlockTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const startEditing = () => {
    setDraft(value);
    setEditing(true);
  };

  if (!editing) {
    const isEmpty = value.trim() === "";
    return (
      <div
        tabIndex={0}
        onClick={startEditing}
        onFocus={startEditing}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            startEditing();
          }
        }}
        className={cn("cursor-text", className)}
      >
        {isEmpty ? (
          <span className="text-ink-soft/40">{placeholder}</span>
        ) : (
          <RichText text={value} className={className} />
        )}
      </div>
    );
  }

  return (
    <div>
      {draft.trim() !== "" && (
        <div className="pointer-events-none mb-1 opacity-90">
          <RichText text={draft} className={className} />
        </div>
      )}
      <input
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          onCommit(draft);
          setEditing(false);
        }}
        className={className}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/workspace/BlockText.test.tsx`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/BlockText.tsx src/components/workspace/BlockText.test.tsx
git commit -m "feat: add BlockText live-split read/edit control"
```

---

### Task 4: Wire BlockText into PageView text blocks

Replace the bare `<input>` text field of each text block type with `BlockText`. Keep the heading-level `<select>`, todo checkbox, and callout emoji `<input>` exactly as they are. The page title (`PageView.tsx:69`) stays a plain `<input>` (non-goal).

**Files:**
- Modify: `src/components/workspace/PageView.tsx` — `BlockView` (lines ~197-329); add the import.

**Interfaces:**
- Consumes: `BlockText` from `./BlockText` (Task 3). Uses the existing `commitText` helper (`PageView.tsx:184-188`) as `onCommit`, and the existing remount key `const k = \`${block.id}:${rev}\`` (`PageView.tsx:195`) as the `BlockText` `key`.

- [ ] **Step 1: Add the import**

In `src/components/workspace/PageView.tsx`, add to the import block (near line 7):

```tsx
import { BlockText } from "./BlockText";
```

- [ ] **Step 2: Replace the heading text input**

In `BlockView`, the `heading` case currently ends with (lines ~222-227):

```tsx
          <input
            key={k}
            defaultValue={block.text}
            onBlur={(e) => commitText(e.target.value)}
            className={`font-display font-bold text-ink ${size} ${textInputClass}`}
          />
```

Replace that `<input>` with:

```tsx
          <BlockText
            key={k}
            value={block.text}
            onCommit={commitText}
            className={`font-display font-bold text-ink ${size} ${textInputClass}`}
          />
```

- [ ] **Step 3: Replace the paragraph block**

Replace the `paragraph` case (lines ~231-240):

```tsx
    case "paragraph":
      return (
        <input
          key={k}
          defaultValue={block.text}
          onBlur={(e) => commitText(e.target.value)}
          placeholder={dict.page.placeholders.paragraph}
          className={`py-1 text-[15px] leading-7 text-ink placeholder:text-ink-soft/40 ${textInputClass}`}
        />
      );
```

with:

```tsx
    case "paragraph":
      return (
        <BlockText
          key={k}
          value={block.text}
          onCommit={commitText}
          placeholder={dict.page.placeholders.paragraph}
          className={`py-1 text-[15px] leading-7 text-ink placeholder:text-ink-soft/40 ${textInputClass}`}
        />
      );
```

- [ ] **Step 4: Replace the todo text input**

In the `todo` case, replace the text `<input>` (lines ~257-265) — keep the checkbox above it unchanged:

```tsx
          <input
            key={k}
            defaultValue={block.text}
            onBlur={(e) => commitText(e.target.value)}
            placeholder={dict.page.placeholders.todo}
            className={`flex-1 rounded bg-transparent px-1 outline-none focus:bg-white/[0.04] ${
              block.checked ? "text-ink-faint line-through" : "text-ink"
            }`}
          />
```

with:

```tsx
          <BlockText
            key={k}
            value={block.text}
            onCommit={commitText}
            placeholder={dict.page.placeholders.todo}
            className={`flex-1 rounded bg-transparent px-1 outline-none focus:bg-white/[0.04] ${
              block.checked ? "text-ink-faint line-through" : "text-ink"
            }`}
          />
```

- [ ] **Step 5: Replace the bulleted list item input**

In `bulleted_list_item` (lines ~272-278), replace the `<input>` — keep the `•` span:

```tsx
          <input
            key={k}
            defaultValue={block.text}
            onBlur={(e) => commitText(e.target.value)}
            placeholder={dict.page.placeholders.listItem}
            className={textInputClass}
          />
```

with:

```tsx
          <BlockText
            key={k}
            value={block.text}
            onCommit={commitText}
            placeholder={dict.page.placeholders.listItem}
            className={textInputClass}
          />
```

- [ ] **Step 6: Replace the numbered list item input**

In `numbered_list_item` (lines ~285-290), replace the `<input>` — keep the `1.` span:

```tsx
          <input
            key={k}
            defaultValue={block.text}
            onBlur={(e) => commitText(e.target.value)}
            className={textInputClass}
          />
```

with:

```tsx
          <BlockText
            key={k}
            value={block.text}
            onCommit={commitText}
            className={textInputClass}
          />
```

- [ ] **Step 7: Replace the quote input**

In `quote` (lines ~296-301), replace the `<input>`:

```tsx
          <input
            key={k}
            defaultValue={block.text}
            onBlur={(e) => commitText(e.target.value)}
            className={`${textInputClass} italic`}
          />
```

with:

```tsx
          <BlockText
            key={k}
            value={block.text}
            onCommit={commitText}
            className={`${textInputClass} italic`}
          />
```

- [ ] **Step 8: Replace the callout text input**

In `callout` (lines ~321-327), replace the text `<input>` — keep the emoji `<input>` above it unchanged:

```tsx
          <input
            key={k}
            defaultValue={block.text}
            onBlur={(e) => commitText(e.target.value)}
            placeholder={dict.page.placeholders.callout}
            className={textInputClass}
          />
```

with:

```tsx
          <BlockText
            key={k}
            value={block.text}
            onCommit={commitText}
            placeholder={dict.page.placeholders.callout}
            className={textInputClass}
          />
```

- [ ] **Step 9: Verify the suite, lint, and types**

Run: `pnpm exec vitest run`
Expected: PASS — all tests (existing + Task 2 + Task 3) green.

Run: `pnpm lint`
Expected: clean — in particular no unused `textInputClass`/`commitText` (both still used) and no remaining references to a removed symbol.

Run: `pnpm exec tsc --noEmit`
Expected: no NEW type errors in `PageView.tsx`, `BlockText.tsx`, `RichText.tsx`, `streamdown-plugins.ts`, or `message.tsx`. (If the command reports pre-existing errors elsewhere, confirm none are in the files this plan touched.)

- [ ] **Step 10: Manual verification in the running app**

Run: `pnpm dev`, open a workspace, and view a note containing LaTeX (e.g. regenerate the SQL cheat sheet, or paste `\texttt{SELECT}` and `$\wedge$, $\neq$, $\leq$, $\geq$` into blocks). Confirm:
- `\texttt{...}` renders as inline code; `$\wedge$ $\neq$ $\leq$ $\geq$` render as ∧ ≠ ≤ ≥ (typeset).
- Clicking a block reveals the raw source in an input with a live typeset preview that updates as you type; blur re-renders and persists.
- An empty block shows its placeholder.
- AI-editing a page still refreshes block text (the `key={k}` rev bump remounts `BlockText`).

- [ ] **Step 11: Commit**

```bash
git add src/components/workspace/PageView.tsx
git commit -m "feat: render note blocks as typeset markdown + math"
```

---

## Self-Review Notes

- **Spec coverage:** Shared plugins (Task 1) ↔ spec §1; `RichText` + render-time sanitize (Task 2) ↔ spec §2; `BlockText` live-split (Task 3) ↔ spec §3 + chosen interaction model; PageView wiring across all seven text block types (Task 4) ↔ spec §3 + "Files touched"; page title left plain + single-line editing ↔ spec "Non-goals".
- **Type consistency:** `streamdownPlugins` (Task 1) consumed unchanged in Tasks 1–2. `RichText({ text, className })` defined in Task 2, consumed in Task 3. `BlockText({ value, onCommit, placeholder, className })` defined in Task 3, consumed identically in Task 4 (`onCommit={commitText}` where `commitText: (text: string) => void`).
- **Risk acknowledged in spec:** block text beginning with a Markdown-significant char may be reinterpreted by Streamdown — accepted tradeoff, same as chat.
