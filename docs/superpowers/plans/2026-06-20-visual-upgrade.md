# Visual Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the warm "paper desk" identity with a dark, modern software-product look (teal accent `#2dd4bf`, Newsreader serif kept for display) across the entire StudyOS app.

**Architecture:** Token-first migration. The app already uses semantic aliases (`bg-paper`, `text-ink`, `bg-lime`, `border-line`) everywhere, so repointing the CSS variables in `globals.css` transforms most surfaces in one edit. Per-surface class tweaks follow where visual semantics must change (e.g. a user chat bubble that was `bg-ink` should become `bg-lime` = teal). Dark becomes the default theme; light becomes a `.light` override.

**Tech Stack:** Next.js 16, React 19, Tailwind v4 (CSS-first `@theme inline`), shadcn/ui (new-york), next-themes, Clerk, Hanken Grotesk + Newsreader + JetBrains Mono via `next/font/google`.

## Global Constraints

- **No functionality changes.** No data model, API, routing, auth, billing, or agent-logic edits. Pure presentation + tokens + Clerk appearance.
- **No font changes.** Keep Newsreader (`--font-display`), Hanken Grotesk (`--font-sans`), JetBrains Mono (`--font-mono`) as loaded in `src/app/layout.tsx`.
- **No new i18n keys.** Reuse existing dictionary strings; the three plain-English "ask" examples are hardcoded (they already are in the README and `agentChat.suggestions`).
- **Accent is teal `#2dd4bf`** (dark) / `#0d9488` (light). The `--lime`/`--lime-deep`/`--lime-on`/`--lime-faint` aliases are repointed to teal, not removed, so existing `bg-lime`/`text-lime-on`/`bg-lime/20` call sites keep compiling.
- **Dark is default.** `:root` holds the dark ramp; `.light` holds light overrides; `ThemeProvider` `defaultTheme="dark"`.
- **Tailwind v4** uses CSS-first config via `@theme inline` in `globals.css` — no `tailwind.config.js`.
- **Radius** bumps from `0.375rem` to `0.625rem`.
- **Verify after every task** with `pnpm lint` and `pnpm build`; run `pnpm test` for tasks touching tested components.
- **Commit per task** with a `style:`/`feat:` prefix matching repo convention.
- The spec is `docs/superpowers/specs/2026-06-20-visual-upgrade-design.md` — read it before starting any task.

---

## File Map

**Tokens & theme:** `src/app/globals.css`, `src/components/ThemeProvider.tsx`, `src/components/ThemeToggle.tsx`, `src/app/layout.tsx` (Clerk appearance).

**Shared primitives:** `src/components/ui/button.tsx`, `src/components/ui/card.tsx`, `src/components/ui/badge.tsx`, `src/lib/workspace/colors.ts`.

**In-app workspace:** `src/components/workspace/{WorkspaceEditor,PageView,DatabaseView,AgentChat,AgentProgressCard,AgentUndoButton}.tsx`.

**Page shells:** `src/app/page.tsx` (biggest — landing restructure), `src/app/app/page.tsx`, `src/app/app/settings/page.tsx`, `src/app/app/credits/page.tsx`, `src/app/pricing/page.tsx`, `src/app/generate/GeneratorClient.tsx`, `src/app/sign-in/[[...sign-in]]/page.tsx`, `src/app/sign-up/[[...sign-up]]/page.tsx`.

**No new files** — landing mockups are inline components in `page.tsx`, matching the existing `WorkspacePreview` pattern.

---

## Task 1: Rework design tokens to dark + teal

**Files:** Modify `src/app/globals.css` (whole file)

**Interfaces:** Produces the dark `:root` ramp, `.light` overrides, repointed `--lime*`/`--paper`/`--ink` aliases, `--accent-glow`, `--radius: 0.625rem`, and a `pulse-dot` keyframe. Every later task depends on these tokens.

- [ ] **Step 1: Read `src/app/globals.css`** end to end. Note the `:root` block (warm light palette), the `.dark` block (current dark override), the `@theme inline` block, and the base/motion section.

- [ ] **Step 2: Replace the `:root` block with the dark ramp.** Substitute the entire `:root { ... }` block with:

```css
:root {
  /* StudyOS — dark, modern software-product identity. */
  --bg: #0b0b0a;
  --surface: #131312;
  --surface-2: #17171599;
  --text: #f4f3ef;
  --text-soft: #a8a89e;
  --text-faint: #6a6a62;
  --border-c: rgba(255, 255, 255, 0.08);
  --border-strong-c: rgba(255, 255, 255, 0.14);
  --hover-c: rgba(255, 255, 255, 0.05);

  --accent: #2dd4bf;
  --accent-on: #0b0b0a;
  --accent-deep: #14b8a6;
  --accent-faint: rgba(45, 212, 191, 0.16);
  --accent-glow: rgba(45, 212, 191, 0.35);

  --elev-1: 0 1px 1px rgba(0, 0, 0, 0.25);
  --elev-2: 0 12px 32px -16px rgba(0, 0, 0, 0.6);
  --elev-3: 0 24px 60px -30px rgba(0, 0, 0, 0.8), 0 0 60px -20px var(--accent-glow);

  --paper: var(--bg);
  --ink: var(--text);
  --ink-soft: var(--text-soft);
  --ink-faint: var(--text-faint);
  --line: var(--border-c);
  --line-strong: var(--border-strong-c);
  --lime: var(--accent);
  --lime-deep: var(--accent-deep);
  --lime-on: var(--accent-on);
  --lime-faint: var(--accent-faint);

  --radius: 0.625rem;
  --background: #0b0b0a;
  --foreground: #f4f3ef;
  --card: #171715;
  --card-foreground: #f4f3ef;
  --popover: #1c1c1a;
  --popover-foreground: #f4f3ef;
  --primary: #2dd4bf;
  --primary-foreground: #0b0b0a;
  --secondary: #131312;
  --secondary-foreground: #f4f3ef;
  --muted: #17171599;
  --muted-foreground: #a8a89e;
  --accent-bg: rgba(255, 255, 255, 0.06);
  --accent-foreground: #f4f3ef;
  --destructive: #f87171;
  --border: rgba(255, 255, 255, 0.08);
  --input: rgba(255, 255, 255, 0.14);
  --ring: #2dd4bf;
}
```

- [ ] **Step 3: Delete the `.dark { ... }` block and add `.light { ... }` overrides** in its place:

```css
.light {
  --bg: #fafafa;
  --surface: #ffffff;
  --surface-2: #f4f4f5;
  --text: #18181b;
  --text-soft: #52525b;
  --text-faint: #a1a1aa;
  --border-c: rgba(24, 24, 27, 0.1);
  --border-strong-c: rgba(24, 24, 27, 0.16);
  --hover-c: rgba(24, 24, 27, 0.04);

  --accent: #0d9488;
  --accent-on: #ffffff;
  --accent-deep: #0f766e;
  --accent-faint: rgba(13, 148, 136, 0.12);
  --accent-glow: rgba(13, 148, 136, 0.25);

  --elev-1: 0 1px 1px rgba(24, 24, 27, 0.04);
  --elev-2: 0 4px 16px -8px rgba(24, 24, 27, 0.12);
  --elev-3: 0 18px 48px -30px rgba(24, 24, 27, 0.26);

  --paper: var(--bg);
  --ink: var(--text);
  --ink-soft: var(--text-soft);
  --ink-faint: var(--text-faint);
  --line: var(--border-c);
  --line-strong: var(--border-strong-c);
  --lime: var(--accent);
  --lime-deep: var(--accent-deep);
  --lime-on: var(--accent-on);
  --lime-faint: var(--accent-faint);

  --background: #fafafa;
  --foreground: #18181b;
  --card: #ffffff;
  --card-foreground: #18181b;
  --popover: #ffffff;
  --popover-foreground: #18181b;
  --primary: #0d9488;
  --primary-foreground: #ffffff;
  --secondary: #f4f4f5;
  --secondary-foreground: #18181b;
  --muted: #f4f4f5;
  --muted-foreground: #52525b;
  --accent-bg: rgba(24, 24, 27, 0.05);
  --accent-foreground: #18181b;
  --destructive: #e11d48;
  --border: rgba(24, 24, 27, 0.1);
  --input: rgba(24, 24, 27, 0.16);
  --ring: #0d9488;
}
```

- [ ] **Step 4: Update the `@theme inline` elevation mapping.** Replace the existing `--shadow-card: var(--shadow); --shadow-pop: var(--shadow-lg);` lines with:

```css
  --shadow-card: var(--elev-2);
  --shadow-pop: var(--elev-3);
```

- [ ] **Step 5: Add the `pulse-dot` keyframe** after the `ai-fade` animation, before `@media (prefers-reduced-motion: reduce)`:

```css
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.pulse-dot {
  animation: pulse-dot 2s ease-in-out infinite;
}
```

And inside the `@media (prefers-reduced-motion: reduce)` block add `  .pulse-dot { animation: none; }`.

- [ ] **Step 6: Verify build.** Run `pnpm build`. Expected: succeeds. If Tailwind flags `shadow-card` unknown, confirm the `@theme inline` mapping in Step 4.

- [ ] **Step 7: Commit.**

```bash
git add src/app/globals.css
git commit -m "style: rework design tokens to dark default + teal accent"
```

---

## Task 2: Flip default theme to dark

**Files:** Modify `src/components/ThemeProvider.tsx`, `src/components/ThemeToggle.tsx`

**Interfaces:** Consumes the `.light` class strategy from Task 1. Produces dark as default; toggle switches to `.light`.

- [ ] **Step 1: Update `ThemeProvider` default.** In `src/components/ThemeProvider.tsx`, change `defaultTheme="light"` to `defaultTheme="dark"`. Keep `attribute="class"` and `enableSystem={false}`. Update the doc comment to note dark is default and `.light` overrides.

- [ ] **Step 2: Verify `ThemeToggle` icon logic.** In `src/components/ThemeToggle.tsx`, the condition is `mounted && isDark ? "☀" : "☾"` — show sun in dark mode (offers switch to light), moon in light. This is already correct for the new default; no change needed. Leave button classes alone (token-driven).

- [ ] **Step 3: Verify toggle works.** Run `pnpm dev`, open `http://localhost:3000`, confirm dark by default, toggle flips to light and back with the 0.4s crossfade.

- [ ] **Step 4: Commit.**

```bash
git add src/components/ThemeProvider.tsx src/components/ThemeToggle.tsx
git commit -m "style: default to dark theme"
```

---

## Task 3: Theme Clerk for dark + teal

**Files:** Modify `src/app/layout.tsx` (the `ClerkProvider appearance` prop)

**Interfaces:** Produces Clerk auth components styled to match the dark shell.

- [ ] **Step 1: Read `src/app/layout.tsx`** — note the current `appearance={{ variables: { colorPrimary: "#1a1a17" } }}`.

- [ ] **Step 2: Replace the `appearance` prop** on `ClerkProvider` with:

```tsx
              appearance={{
                variables: {
                  colorPrimary: "#2dd4bf",
                  colorPrimaryText: "#0b0b0a",
                  colorBackground: "#131312",
                  colorText: "#f4f3ef",
                  colorTextSecondary: "#a8a89e",
                  colorInputBackground: "#171715",
                  colorInputText: "#f4f3ef",
                  colorBorder: "rgba(255,255,255,0.14)",
                  colorDanger: "#f87171",
                  borderRadius: "0.625rem",
                  fontSize: "14px",
                },
                elements: {
                  formButtonPrimary:
                    "bg-[#2dd4bf] text-[#0b0b0a] hover:bg-[#14b8a6]",
                  card:
                    "bg-[#131312] border border-[rgba(255,255,255,0.08)] shadow-[0_24px_60px_-30px_rgba(0,0,0,0.8)]",
                  headerTitle: "font-serif font-bold tracking-tight",
                  headerSubtitle: "text-[#a8a89e]",
                  socialButtonsBlockButton:
                    "bg-[#171715] border border-[rgba(255,255,255,0.14)] text-[#f4f3ef] hover:bg-[#1c1c1a]",
                  formFieldLabel: "text-[#a8a89e]",
                  footerActionLink: "text-[#2dd4bf] hover:text-[#14b8a6]",
                },
              }}
```

If a key is rejected at runtime, drop it — the `variables` block does most of the work.

- [ ] **Step 3: Verify auth pages render dark.** Run `pnpm dev`, visit `/sign-in` and `/sign-up`. Confirm dark card, teal primary button, dark inputs, teal focus ring.

- [ ] **Step 4: Commit.**

```bash
git add src/app/layout.tsx
git commit -m "style: theme Clerk auth for dark + teal"
```

---

## Task 4: Refresh shared UI primitives

**Files:** Modify `src/components/ui/button.tsx`, `src/components/ui/card.tsx`, `src/components/ui/badge.tsx`

**Interfaces:** Produces buttons with teal glow on `default`, transparent `outline` bg, cards with `shadow-card`, a `teal` badge variant.

- [ ] **Step 1: Add teal glow to default button.** In `src/components/ui/button.tsx`, replace the `default` variant line with:

```tsx
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_8px_24px_-8px_var(--accent-glow)]",
```

- [ ] **Step 2: Make outline transparent.** Replace the `outline` variant line with:

```tsx
        outline:
          "border border-line-strong bg-transparent hover:bg-hover hover:text-accent-foreground",
```

- [ ] **Step 3: Update Card shadow.** In `src/components/ui/card.tsx`, in `Card`'s `className`, replace `shadow-sm` with `shadow-card`.

- [ ] **Step 4: Add teal badge variant.** Read `src/components/ui/badge.tsx`; if no `teal` variant exists, add to `variants.variant`:

```tsx
        teal:
          "bg-accent-faint text-accent ring-1 ring-inset ring-accent/30",
```

(Use `bg-lime-faint text-lime` if the file uses the alias naming pattern instead of `accent`.)

- [ ] **Step 5: Verify.** Run `pnpm lint` then `pnpm build`. Both pass.

- [ ] **Step 6: Commit.**

```bash
git add src/components/ui/button.tsx src/components/ui/card.tsx src/components/ui/badge.tsx
git commit -m "style: teal glow on primary button, dark card shadow, teal badge"
```

---

## Task 5: Rewrite workspace status colors for dark

**Files:** Modify `src/lib/workspace/colors.ts` (whole file)

**Interfaces:** Produces `PILL_CLASSES`/`DOT_CLASSES` whose class strings render on dark (translucent fills + bright text + ring). Consumed by `DatabaseView.tsx`.

- [ ] **Step 1: Read `src/lib/workspace/colors.ts`** — 19 entries per map, all light Tailwind classes.

- [ ] **Step 2: Replace `PILL_CLASSES`** with dark-appropriate classes. Each color uses a translucent `*-400/15` fill, bright `*-300` text, and a `ring-1 ring-inset ring-*-400/30`:

```ts
export const PILL_CLASSES: Record<string, string> = {
  zinc: "bg-white/[0.06] text-ink-soft ring-1 ring-inset ring-white/10",
  gray: "bg-white/[0.06] text-ink-soft ring-1 ring-inset ring-white/10",
  red: "bg-red-400/15 text-red-300 ring-1 ring-inset ring-red-400/30",
  rose: "bg-rose-400/15 text-rose-300 ring-1 ring-inset ring-rose-400/30",
  orange: "bg-orange-400/15 text-orange-300 ring-1 ring-inset ring-orange-400/30",
  amber: "bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/30",
  yellow: "bg-yellow-400/15 text-yellow-300 ring-1 ring-inset ring-yellow-400/30",
  lime: "bg-lime-400/15 text-lime-300 ring-1 ring-inset ring-lime-400/30",
  green: "bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30",
  emerald: "bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30",
  teal: "bg-lime-faint text-lime ring-1 ring-inset ring-lime/30",
  cyan: "bg-cyan-400/15 text-cyan-300 ring-1 ring-inset ring-cyan-400/30",
  sky: "bg-sky-400/15 text-sky-300 ring-1 ring-inset ring-sky-400/30",
  blue: "bg-blue-400/15 text-blue-300 ring-1 ring-inset ring-blue-400/30",
  indigo: "bg-indigo-400/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/30",
  violet: "bg-violet-400/15 text-violet-300 ring-1 ring-inset ring-violet-400/30",
  purple: "bg-purple-400/15 text-purple-300 ring-1 ring-inset ring-purple-400/30",
  fuchsia: "bg-fuchsia-400/15 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-400/30",
  pink: "bg-pink-400/15 text-pink-300 ring-1 ring-inset ring-pink-400/30",
};
```

(`teal` uses the `lime` alias since `--lime` is now teal — keeps the brand accent consistent.)

- [ ] **Step 3: Replace `DOT_CLASSES`** with bright `-400` variants for dark visibility:

```ts
export const DOT_CLASSES: Record<string, string> = {
  zinc: "bg-zinc-400", gray: "bg-zinc-400",
  red: "bg-red-400", rose: "bg-rose-400",
  orange: "bg-orange-400", amber: "bg-amber-400",
  yellow: "bg-yellow-400", lime: "bg-lime-400",
  green: "bg-emerald-400", emerald: "bg-emerald-400",
  teal: "bg-lime", cyan: "bg-cyan-400",
  sky: "bg-sky-400", blue: "bg-blue-400",
  indigo: "bg-indigo-400", violet: "bg-violet-400",
  purple: "bg-purple-400", fuchsia: "bg-fuchsia-400",
  pink: "bg-pink-400",
};
```

- [ ] **Step 4: Verify.** Run `pnpm lint` then `pnpm build`. If `text-ink-soft` or `bg-lime` is flagged unknown, confirm `@theme inline` mappings in `globals.css`.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/workspace/colors.ts
git commit -m "style: rewrite workspace status colors for dark surfaces"
```

---

## Task 6: Restyle workspace editor + page view

**Files:** Modify `src/components/workspace/WorkspaceEditor.tsx`, `src/components/workspace/PageView.tsx`

**Interfaces:** Produces a dark workspace shell with teal active/Ask-AI affordances and dark editable surfaces. Most classes are token-driven and flipped in Task 1; this task covers semantic class swaps.

- [ ] **Step 1: Read `src/components/workspace/WorkspaceEditor.tsx`** — note sidebar, topbar, Ask-AI button (~line 201), SaveIndicator.

- [ ] **Step 2: Update Ask-AI button active state** (~line 204). Replace the className ternary's active branch with teal accent:

```tsx
                className={`flex items-center gap-2 rounded-md border px-3.5 py-1.5 text-xs font-semibold transition ${
                  aiOpen
                    ? "border-lime bg-lime-faint text-ink"
                    : "border-line-strong bg-card text-ink hover:bg-hover"
                }`}
```

The `bg-lime` status dot (line 210) stays — now renders teal via alias.

- [ ] **Step 3: Update `PageView` focus surfaces.** Read `src/components/workspace/PageView.tsx`. Replace `hover:bg-paper focus:bg-paper` with `hover:bg-white/[0.04] focus:bg-white/[0.04]` on the page-icon and page-title inputs. Replace `focus:bg-paper` in the editable-text `base` const with `focus:bg-white/[0.04]`. Leave the callout's `bg-paper` container as-is (reads fine on dark). The `text-lime` checkbox stays (now teal).

- [ ] **Step 4: Verify.** Run `pnpm lint` then `pnpm build`. Both pass.

- [ ] **Step 5: Commit.**

```bash
git add src/components/workspace/WorkspaceEditor.tsx src/components/workspace/PageView.tsx
git commit -m "style: dark workspace shell + teal active states"
```

---

## Task 7: Restyle database views (table, board, calendar)

**Files:** Modify `src/components/workspace/DatabaseView.tsx`

**Interfaces:** Produces dark database surfaces with teal active tab, teal drag-over highlights.

- [ ] **Step 1: Read `src/components/workspace/DatabaseView.tsx`** — note view tabs (~line 87), board drag-over (~line 894), calendar drag-over (~line 1106), URL cell `text-lime` (~line 770).

- [ ] **Step 2: Update view-tab active border** (~line 87). Change `border-ink` to `border-lime`:

```tsx
              className={`-mb-px border-b-2 px-2 pb-2 text-sm transition ${
                v.id === view.id
                  ? "border-lime font-medium text-ink"
                  : "border-transparent text-ink-faint hover:text-ink-soft"
              }`}
```

- [ ] **Step 3: Update board drag-over highlight** (~line 894). Replace `bg-lime/20 ring-2 ring-lime-deep/40` with `bg-lime/10 ring-2 ring-lime/40`:

```tsx
            className={`w-64 shrink-0 rounded-md p-1 transition ${
              isOver ? "bg-lime/10 ring-2 ring-lime/40" : ""
            }`}
```

- [ ] **Step 4: Update calendar drag-over highlight** (~line 1106). Replace `bg-lime/20` with `bg-lime/10`:

```tsx
              className={`group/cell min-h-[92px] border-b border-r border-line p-1.5 [&:nth-child(7n)]:border-r-0 ${
                isOver ? "bg-lime/10" : ""
              }`}
```

- [ ] **Step 5: URL cell** at ~line 770 uses `text-lime` — now teal via alias. No change needed.

- [ ] **Step 6: Verify.** Run `pnpm lint` then `pnpm build`. Both pass.

- [ ] **Step 7: Commit.**

```bash
git add src/components/workspace/DatabaseView.tsx
git commit -m "style: teal active tab + dark board/calendar highlights"
```

---

## Task 8: Restyle the agent chat panel

**Files:** Modify `src/components/workspace/AgentChat.tsx`, `src/components/workspace/AgentProgressCard.tsx`

**Interfaces:** Produces dark agent chat with teal user bubbles, teal "updated" pill, teal send button, teal agent orb.

- [ ] **Step 1: Read both files.** Note the orb (~AgentChat line 236), user bubble (~line 288), choice buttons (~line 307), "updated" pill (~line 385), send button (~line 450); and AgentProgressCard's orb/progress bar.

- [ ] **Step 2: Make the user message bubble teal** (~AgentChat line 288). Replace `bg-ink ... text-paper` with `bg-lime text-lime-on`:

```tsx
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-lime px-3.5 py-2 text-sm text-lime-on">
```

- [ ] **Step 3: Make the agent orb teal** (~line 236). Replace `bg-ink` (orb fill) with `bg-lime`, and the inner dot `bg-lime` with `bg-lime-on`:

```tsx
          <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-lime">
            {busy && (
              <span className="ai-ring absolute inset-0 rounded-full bg-lime/30" />
            )}
            <span
              className={`relative h-2 w-2 rounded-full bg-lime-on ${
                busy ? "ai-orb" : ""
              }`}
              aria-hidden
            />
```

- [ ] **Step 4: Update the "workspace updated" pill** (~line 385). Replace `text-ink ring-lime-deep/40` with `text-lime ring-lime/40`:

```tsx
                  <span className="inline-flex items-center gap-1 rounded-full bg-lime/30 px-2 py-0.5 text-[10px] font-semibold text-lime ring-1 ring-inset ring-lime/40">
```

- [ ] **Step 5: Make the send button teal** (~line 450). Replace `bg-ink text-paper` with `bg-lime text-lime-on`:

```tsx
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-lime text-lime-on transition enabled:hover:bg-lime-deep disabled:opacity-40"
```

- [ ] **Step 6: Update choice-button hover states** (~line 307 and ~326). Replace `hover:border-ink hover:bg-lime/20` with `hover:border-lime hover:bg-lime/10` in both the choice button and the "Other" idle state. The "Other" expanded state (~line 326) `border-ink bg-ink text-paper` becomes `border-lime bg-lime text-lime-on`.

- [ ] **Step 7: Update the "Other" reply send button** (~line 374). Replace `bg-ink text-paper` with `bg-lime text-lime-on`:

```tsx
                        className="rounded-md bg-lime px-2.5 py-1.5 text-xs font-semibold text-lime-on transition enabled:hover:bg-lime-deep disabled:opacity-40"
```

- [ ] **Step 8: AgentProgressCard.** Read `src/components/workspace/AgentProgressCard.tsx`. The header uses `bg-ink text-paper` — now dark via alias, leave it. The orb (`bg-lime text-ink`) stays (teal fill, dark glyph). The progress bar fill `bg-lime` stays (teal). The `text-lime` percentage stays. The phase-dot `bg-lime text-ink` / `bg-ink text-paper` states stay (teal active, dark queued). No changes needed in AgentProgressCard — it's already alias-driven and reads correctly on dark.

- [ ] **Step 9: Verify.** Run `pnpm lint`, `pnpm build`, and `pnpm test` (this component has `AgentProgressCard.test.tsx` and `AgentUndoButton.test.tsx`). Tests should still pass (they test behavior, not styles). If any test asserts on a class name that changed, update the assertion.

- [ ] **Step 10: Commit.**

```bash
git add src/components/workspace/AgentChat.tsx src/components/workspace/AgentProgressCard.tsx
git commit -m "style: teal agent chat bubbles, orb, send button, updated pill"
```

---

## Task 9: Restyle the app home + workspace cards

**Files:** Modify `src/app/app/page.tsx`

**Interfaces:** Produces a dark app home with teal CTAs, dark workspace cards with teal hover borders.

- [ ] **Step 1: Read `src/app/app/page.tsx`** — note the header, generate prompt card, workspace grid cards, empty state, upgrade banners.

- [ ] **Step 2: Workspace card hover.** The grid card (~line 177) uses `hover:-translate-y-0.5 hover:border-ink/25 hover:shadow-pop`. Change `hover:border-ink/25` to `hover:border-lime/40` for a teal hover border:

```tsx
                  className="flex min-h-[172px] flex-col rounded-md border border-line bg-card p-5 shadow-card transition hover:-translate-y-0.5 hover:border-lime/40 hover:shadow-pop"
```

- [ ] **Step 3: Upgrade/credits banners.** The banners (~lines 93, 99) use `bg-lime-faint` + `bg-lime` dot — now teal via alias. No change needed.

- [ ] **Step 4: Verify.** Run `pnpm lint` then `pnpm build`. Both pass.

- [ ] **Step 5: Commit.**

```bash
git add src/app/app/page.tsx
git commit -m "style: dark app home + teal workspace card hover"
```

---

## Task 10: Restyle settings + credits pages

**Files:** Modify `src/app/app/settings/page.tsx`, `src/app/app/credits/page.tsx`

**Interfaces:** Produces dark settings/credits shells with teal accents.

- [ ] **Step 1: Settings profile avatar** (`src/app/app/settings/page.tsx` ~line 74). Replace `bg-ink text-paper` with `bg-lime text-lime-on`:

```tsx
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-lime text-lg font-bold text-lime-on">
```

- [ ] **Step 2: Settings plan badge** (~line 97). The pro branch `bg-ink text-paper` stays (dark badge on dark = reads as a solid pill). The free branch `bg-ink/10 text-ink` stays. No change.

- [ ] **Step 3: Settings credit balance dot** (~line 147). `text-lime-deep` stays (now teal-deep). No change.

- [ ] **Step 4: Credits page balance dot** (`src/app/app/credits/page.tsx` ~line 56). `text-lime-deep` stays (teal-deep). No change.

- [ ] **Step 5: Credits pack card** (~line 64). Uses `border-2 border-ink bg-card` + a big shadow. Change `border-ink` to `border-lime` for a teal accent border, and add the teal glow to the shadow:

```tsx
        <div className="mx-auto mt-10 max-w-sm rounded-2xl border-2 border-lime bg-card p-8 text-center shadow-pop">
```

- [ ] **Step 6: Verify.** Run `pnpm lint` then `pnpm build`. Both pass.

- [ ] **Step 7: Commit.**

```bash
git add src/app/app/settings/page.tsx src/app/app/credits/page.tsx
git commit -m "style: dark settings + credits with teal accents"
```

---

## Task 11: Restyle the pricing page

**Files:** Modify `src/app/pricing/page.tsx`

**Interfaces:** Produces a dark pricing page with teal Pro card border, teal "most popular" badge, teal CTAs.

- [ ] **Step 1: Read `src/app/pricing/page.tsx`** — note plan cards, `Feature`/`Mark` helpers, comparison table, FAQ, bottom CTA.

- [ ] **Step 2: Pro card border + badge.** The Pro card (~line 183) uses `border-[1.5px] border-ink`. Change to `border-lime`. The "most popular" badge (~line 184) uses `bg-lime text-lime-on` — now teal via alias, no change.

- [ ] **Step 3: `Feature` helper strong checkmark** (~line 437). The strong branch uses `bg-lime text-lime-on` — stays (teal). The non-strong branch `bg-hover text-ink-faint` stays. No change.

- [ ] **Step 4: `Mark` helper** (~line 466). The strong branch `bg-lime text-lime-on` stays. The non-strong `bg-hover text-ink` stays. No change.

- [ ] **Step 5: Comparison table Pro column.** The Pro column cells (~line 354) use `bg-lime-faint` — now teal-faint via alias. No change.

- [ ] **Step 6: Bottom CTA.** The bottom CTA section (~line 392) uses `bg-primary text-primary-foreground` (now teal-on-dark) and the button `bg-lime text-lime-on` (teal). Both read correctly via alias. No change.

- [ ] **Step 7: Verify.** Run `pnpm lint` then `pnpm build`. Both pass.

- [ ] **Step 8: Commit.**

```bash
git add src/app/pricing/page.tsx
git commit -m "style: dark pricing with teal Pro card"
```

---

## Task 12: Restyle the generate flow

**Files:** Modify `src/app/generate/GeneratorClient.tsx`

**Interfaces:** Produces a dark generate flow with teal primary buttons and dark question cards.

- [ ] **Step 1: Read `src/app/generate/GeneratorClient.tsx`** — note `DescribeStage` (prompt textarea + Continue button + example chips) and `QuestionsStage` (question cards, option chips, Build button).

- [ ] **Step 2: DescribeStage prompt card** (~line 347). Uses `border-ink/15 bg-card shadow-sm focus-within:border-ink/40`. The `border-ink/15` and `border-ink/40` resolve to near-transparent on dark (since `--ink` is now light text color, `border-ink/15` is a faint light border — actually fine on dark). For a crisper dark look, change to `border-line` and `focus-within:border-lime/50`:

```tsx
      <div className="mt-8 rounded-xl border border-line bg-card shadow-card transition focus-within:border-lime/50">
```

- [ ] **Step 3: DescribeStage example chips** (~line 379). `border-ink/15 ... hover:border-ink/40` — change to `border-line ... hover:border-lime/40 hover:text-ink`:

```tsx
              className="group flex items-center gap-2 rounded-lg border border-line bg-card px-3.5 py-2 text-left text-sm transition hover:border-lime/40 hover:text-ink disabled:opacity-50"
```

- [ ] **Step 4: QuestionsStage question cards** (~line 455). `border-ink/10 bg-card p-5 shadow-sm` → `border-line bg-card p-5 shadow-card`.

- [ ] **Step 5: QuestionsStage option chips** (~line 477). Selected state `border-ink bg-ink font-medium text-paper` → `border-lime bg-lime font-medium text-lime-on`. Idle `border-ink/15 bg-card text-ink-soft hover:border-ink/40 hover:text-ink` → `border-line bg-card text-ink-soft hover:border-lime/40 hover:text-ink`.

- [ ] **Step 6: QuestionsStage "Other" chip** (~line 492). Same swap as option chips: selected `border-lime bg-lime text-lime-on`, idle `border-line bg-card text-ink-soft hover:border-lime/40 hover:text-ink`.

- [ ] **Step 7: QuestionsStage custom-answer container** (~line 503). `border-ink/20 bg-paper/50 focus-within:border-ink/50` → `border-line bg-white/[0.02] focus-within:border-lime/50`.

- [ ] **Step 8: Verify.** Run `pnpm lint` then `pnpm build`. Both pass.

- [ ] **Step 9: Commit.**

```bash
git add src/app/generate/GeneratorClient.tsx
git commit -m "style: dark generate flow with teal selection states"
```

---

## Task 13: Restructure the landing page

**Files:** Modify `src/app/page.tsx` (biggest change — full restructure)

**Interfaces:** Produces the dark, product-first landing: hero = prompt + generated-workspace mockup, numbered chapters (01 Generate / 02 Organize / 03 Ask) each built around a real product mockup, stats row, closing CTA. Reuses existing i18n keys (`L.hero`, `L.how`, `L.features`, `L.builtFor`, `L.closing`, `L.preview`); hardcodes the three "ask" examples (already in README/`agentChat.suggestions`).

This is the largest task. Reference the approved mockup in `.superpowers/brainstorm/*/content/dark-product-direction.html` and the spec §4.1 for the target layout.

- [ ] **Step 1: Read `src/app/page.tsx`** end to end. Note the current `Home()` component and the `WorkspacePreview` helper at the bottom. All i18n keys used: `L.nav`, `L.hero`, `L.builtFor`, `L.how`, `L.features`, `L.closing`, `L.footer`, `L.preview`.

- [ ] **Step 2: Rewrite the nav + hero.** Replace the current `<header>` and hero `<section>` with a dark nav (sticky, `bg-bg/80 backdrop-blur-md border-b border-line`, logo + teal dot, teal "Get started →" button) and a two-column hero: left = mono eyebrow with pulsing teal dot + Newsreader H1 (`L.hero.titleLine1`/`titleLine2`, italic on line 1, teal-highlighted last word) + `L.hero.subtitle` + a prompt-as-hero card (dark surface, mono header row, italic Newsreader placeholder = `promptExample`, input row with teal "Build →" button linking to `/generate`, mono hint line with `L.hero.finePrint` + `L.hero.ctaDemo`); right = a restyled `WorkspacePreview` mockup (dark surface, window chrome, sidebar, board with teal/amber/green tags, "built in 9.4s" indicator with teal dot). Use `L.preview` data.

- [ ] **Step 3: Rewrite the "Built for" strip.** Mono uppercase label `L.builtFor.label` + items separated by dots, `text-ink-faint`.

- [ ] **Step 4: Rewrite "How it works" as Chapter 01 · Generate.** Chapter head: `01` in teal mono + `Generate` label; `L.how.title` in Newsreader; `L.how.subtitle` lede. Body: left column with a checkmark list derived from `L.how.steps` (render each step's `title` + `body` as a bullet with a teal `→`); right column a second prompt mockup (CS-sophomore example sentence, "generating… 9.4s" hint in teal).

- [ ] **Step 5: Rewrite "Features" as Chapter 02 · Organize.** Chapter head with `L.features.title`/`subtitle`. Body: two real mockups side by side — (a) a database table view built from `L.preview` data (5 rows: Midterm Exam, Problem Set 3, Lab Report 2, Proofs Quiz, Essay Draft with course/due/weight/status columns and teal/amber/green status tags) and (b) a month calendar with 3-4 real deadline events color-coded. Above or beside the mockups, a compact bullet list of the six `L.features.items` (each item's `k` as a mono label + `title` + `body`). Not a 3-card grid.

- [ ] **Step 6: Add Chapter 03 · Ask.** Chapter head: `03` + `Ask` label; a Newsreader title "Your workspace edits itself." (reuse `L.features.items.assistant.title`); lede = `L.features.items.assistant.body`. Body: left column with the three plain-English examples as a bullet list ("Add a midterm to CS next Friday." / "Mark the Physics lab as done." / "Make a tracker for my thesis chapters."); right column an agent-chat mockup (header with teal "agent · connected" dot, a user message bubble in teal, an AI response referencing the workspace update, a mono "Updating Assignments database · 1 row added" action line, an input row).

- [ ] **Step 7: Add a stats row.** Four stat cards in a 4-up grid: `9.4s` (avg workspace build), `10` (languages), `3` (views from one dataset), `$0` (to start). Newsreader numbers with the unit in teal; mono labels. Hardcoded (illustrative).

- [ ] **Step 8: Rewrite the closing CTA.** Centered, top border with a teal gradient hairline (`linear-gradient(90deg, transparent, var(--accent), transparent)`), Newsreader H1 (`L.closing.titleLine1` / `titleLine2` with italic on line 2), `L.closing.subtitle`, large teal "Build your workspace →" button linking to `/generate`.

- [ ] **Step 9: Rewrite the footer.** `StudyOS` + teal dot in Newsreader, `L.footer.tagline`.

- [ ] **Step 10: Update the `WorkspacePreview` helper** (or replace it) to render the dark mockup with sidebar + board described in Step 2, using `L.preview` data.

- [ ] **Step 11: Verify.** Run `pnpm lint` then `pnpm build`. Both pass. Then `pnpm dev` and visually confirm the landing: dark, hero prompt + mockup side by side, three numbered chapters each with a real mockup, stats row, closing CTA.

- [ ] **Step 12: Commit.**

```bash
git add src/app/page.tsx
git commit -m "feat: restructure landing into dark product-first chapters"
```

---

## Task 14: Restyle auth pages + final verification

**Files:** Modify `src/app/sign-in/[[...sign-in]]/page.tsx`, `src/app/sign-up/[[...sign-up]]/page.tsx`

**Interfaces:** Produces dark auth shells consistent with the rest of the app.

- [ ] **Step 1: Sign-in page.** `src/app/sign-in/[[...sign-in]]/page.tsx` uses `bg-paper` (now dark via alias) and `bg-lime` dot (now teal). The `font-display text-2xl font-extrabold` logo stays. No class changes needed — token-driven. Verify visually.

- [ ] **Step 2: Sign-up page.** Same as sign-in. No class changes. Verify visually.

- [ ] **Step 3: Full-app visual sweep.** Run `pnpm dev`. Visit every route: `/`, `/pricing`, `/generate`, `/sign-in`, `/sign-up`, `/app`, `/app/<id>` (workspace editor), `/app/settings`, `/app/credits`. Confirm each is dark with teal accents, no leftover warm-paper colors, no contrast issues. Toggle light mode on each and confirm the light variant reads well too.

- [ ] **Step 4: Run lint + build + tests.**

```bash
pnpm lint
pnpm build
pnpm test
```

All pass. If `AgentProgressCard.test.tsx` or `AgentUndoButton.test.tsx` fail on a class assertion, update the assertion to match the new class.

- [ ] **Step 5: Commit** (if any test assertions were updated).

```bash
git add src/app/sign-in/[[...sign-in]]/page.tsx src/app/sign-up/[[...sign-up]]/page.tsx
git commit -m "style: verify dark auth pages + final sweep"
```

---

## Self-Review

**Spec coverage:** Every spec section maps to a task — §2 tokens (T1), §3 components (T4, T5), §4.1 landing (T13), §4.2 pricing (T11), §4.3 generate (T12), §4.4 auth (T3, T14), §5.1 app home (T9), §5.2 editor (T6), §5.3 database (T7), §5.4 agent chat (T8), §5.5 progress/undo (T8), §5.6 settings (T10), §5.7 credits (T10), §6 theme behavior (T1, T2), §7 Clerk (T3).

**Placeholder scan:** No TBD/TODO. Every step has concrete code or a concrete read-and-edit instruction.

**Type consistency:** `PILL_CLASSES`/`DOT_CLASSES` signatures unchanged. `--lime` alias used consistently for teal throughout. `bg-lime`/`text-lime-on`/`bg-lime-faint`/`border-lime` utilities all resolve via the `@theme inline` mappings from Task 1.

**Scope:** 14 tasks, each independently testable (lint+build after every one). The landing (T13) is the largest single edit; the rest are small, focused class tweaks driven by the token change in T1.
