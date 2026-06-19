# Typeset Markdown + LaTeX rendering in note blocks

**Date:** 2026-06-20
**Branch:** feat/agent-sandbox-increment-b
**Status:** Approved design

## Problem

AI-generated notes (e.g. an "SQL-Spickzettel" cheat sheet) contain Markdown and
LaTeX such as `\texttt{SELECT}`, `$\wedge$`, `$\neq$`. In the note/document view
this text appears verbatim instead of being rendered.

Root cause: every text block in `PageView.tsx` renders `block.text` inside a bare
single-line `<input>` (`BlockView`, `PageView.tsx:197-329`). An `<input>` can only
display literal characters — it cannot render Markdown, KaTeX, or any formatting.

The earlier KaTeX work (commits `4b7ad41`, `d13bc43`) only wired math rendering
into the **AI chat** messages (`message.tsx` → Streamdown). It was never connected
to the note blocks, which is what the screenshot shows.

## Goal

Render note blocks as **typeset** content (Markdown + KaTeX math + code), matching
the chat, while keeping blocks editable.

Chosen interaction model (user decision): **live split**. When a block is focused,
show the raw-text `<input>` *and* a live rendered preview that updates as you type;
when not focused, show only the typeset render.

## Non-goals

- Page title (header `<input>`, `PageView.tsx:69`) stays plain text — titles do not
  carry LaTeX.
- Editing stays **single-line** as today. No multi-line textarea rework.
- No changes to `generate.ts` and no data migration — see "Render-time sanitize".

## Existing assets (no new dependencies)

- `streamdown` + `@streamdown/{cjk,code,math,mermaid}` are already installed and
  used by chat (`message.tsx:325-330`).
- `katex/dist/katex.min.css` is imported globally in `layout.tsx:4`, so KaTeX styles
  already apply everywhere, including the note view.
- `sanitizeLatexText` (`src/lib/ai/sanitize.ts`) converts stray LaTeX text commands
  (`\texttt{}`, `\textbf{}`, `\item`, …) to Markdown while leaving `$…$` / `$$…$$`
  math regions untouched for KaTeX.

## Design

### 1. Shared Streamdown plugin set (DRY with chat)

Extract the plugin object currently inline in `message.tsx` into a shared module so
chat and notes render identically:

```ts
// src/lib/streamdown-plugins.ts
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";

export const streamdownPlugins = {
  cjk,
  code,
  math: createMathPlugin({ singleDollarTextMath: true }),
  mermaid,
};
```

`message.tsx` imports `streamdownPlugins` instead of defining its own.

### 2. `RichText` — read-only renderer

```tsx
// src/components/RichText.tsx ("use client")
// memoized on `text` + `className`
<Streamdown
  plugins={streamdownPlugins}
  className={cn("[&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
>
  {sanitizeLatexText(text)}
</Streamdown>
```

- **Render-time sanitize:** calling `sanitizeLatexText` here fixes existing generated
  notes with no data migration and no `generate.ts` change. `\texttt{SELECT}` →
  `` `SELECT` `` (inline code); `$\wedge$` passes through to KaTeX → ∧.
- `className` lets each block apply its own typography (heading size/weight, quote
  italic, todo strikethrough, etc.); the margin resets neutralize Streamdown's
  default block spacing inside a block.

### 3. `BlockText` — live-split read/edit control

Replaces the bare `<input>` text portion of every text block type: `heading`,
`paragraph`, `todo`, `bulleted_list_item`, `numbered_list_item`, `quote`, `callout`.

Props: `value: string`, `onCommit: (text: string) => void`,
`placeholder?: string`, `className?: string`, and the remount `key` (the existing
`${block.id}:${rev}` is passed by the parent as `key`, so AI edits still refresh it).

Behavior:

- **Not focused:** render `<RichText text={value} className={...} />`. If `value` is
  empty, render the placeholder (muted). Clicking/focusing enters edit mode.
- **Focused (editing):** local `draft` state seeded from `value`.
  - Raw `<input value={draft} onChange=…>` (autofocused on entry).
  - Live `<RichText text={draft} />` preview that updates as `draft` changes.
  - `onBlur` → `onCommit(draft)` then exit edit mode.

This preserves today's commit semantics (commit on blur) while adding the live
preview. The heading level `<select>`, todo checkbox, and callout emoji input are
unchanged — only the text input becomes `BlockText`.

### Layout of the live-split (editing state)

Preview above, raw input below, within the block's existing container:

```
[ rendered preview:  SELECT … WHERE  =  ≠  ≤  (typeset) ]
[ raw input:         $=,\; \neq,\; \leq$            | ]
```

## Files touched

- `src/lib/streamdown-plugins.ts` — new shared plugin set.
- `src/components/RichText.tsx` — new read-only renderer.
- `src/components/ai-elements/message.tsx` — import shared plugins (remove local copy).
- `src/components/workspace/PageView.tsx` — swap each text block's `<input>` for
  `BlockText`; keep select/checkbox/emoji controls.

## Risks / edge cases

- Block text starting with a Markdown-significant character (`#`, `-`, `1.`) may be
  reinterpreted by Streamdown (e.g. become a heading/list). This is the same tradeoff
  the chat already accepts; acceptable for AI-generated note content.
- Per-block Streamdown instances add render cost on large notes; mitigated by
  memoizing `RichText` on `text`. Each block's text is small.
- Cosmetic: escaped LaTeX inside code spans (`\_`, `\%`) renders literally. Acceptable.

## Verification

- Open the SQL cheat-sheet note: `\texttt{...}` renders as inline code, `$\wedge$`,
  `$\neq$`, `$\leq$`, `$\geq$` render as ∧ ≠ ≤ ≥.
- Click a block → raw `$…$`/`\texttt{}` source appears in the input with a live
  typeset preview; edit updates the preview; blur re-renders and persists.
- Empty block shows its placeholder.
- Chat math still renders (shared plugin refactor regression check).
