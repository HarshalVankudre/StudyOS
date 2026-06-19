# StudyOS — Complete Visual Upgrade

**Date:** 2026-06-20
**Status:** Design (awaiting review)
**Scope:** Whole app — marketing surfaces, generate flow, in-app workspace, settings, credits, pricing, auth

## 1. Summary

Replace the current warm "paper desk" visual identity with a **dark, modern software-product** identity. The app should feel like a premium AI tool (Lovable / Linear tier), not a printed notebook. Key moves:

- **Dark by default.** Deep near-black surfaces, layered elevation, soft teal glows.
- **Product UI front and center.** The landing hero is the prompt *next to* a rendered mockup of the generated workspace. Feature sections are real mockups (database table, calendar, agent chat) with real data — not icon cards.
- **Teal accent** (`#2dd4bf`) across CTAs, active states, focus rings, status pills, and the brand dot — replacing the indigo/lime.
- **Newsreader serif kept** but reserved for display headlines and large numeric moments only. All UI, body, and chrome use Hanken Grotesk + JetBrains Mono.
- **Numbered chapter structure** on the landing (`01 Generate` / `02 Organize` / `03 Ask`), each built around one real product mockup.
- Every surface — in-app included — gets the same dark treatment, tokens, and component refresh.

The font to keep (per the user's explicit instruction) is **Newsreader**, the Anthropic-style serif currently used as `--font-display`.

## 2. Design tokens

All tokens live in `src/app/globals.css`. The current file defines a warm light palette with a `.dark` override; we **invert** the default to dark and rework both ramps. The `--lime` alias and its indigo value are removed; teal becomes the accent.

### 2.1 Dark theme (new default)

```
--bg:            #0b0b0a   /* app background, near-black warm-neutral */
--surface:       #131312   /* sidebar, panels */
--surface-2:     #17171599 /* inputs, nested surfaces (with alpha) */
--text:          #f4f3ef   /* primary text, warm off-white */
--text-soft:     #a8a89e   /* secondary text */
--text-faint:    #6a6a62   /* tertiary, labels, mono captions */
--border-c:      rgba(255,255,255,0.08)
--border-strong-c: rgba(255,255,255,0.14)
--hover-c:       rgba(255,255,255,0.05)

--accent:        #2dd4bf   /* teal — CTAs, active, focus, brand dot */
--accent-on:     #0b0b0a   /* text on a teal fill */
--accent-deep:   #14b8a6   /* hover/pressed for teal */
--accent-faint:  rgba(45,212,191,0.16)
--accent-glow:   rgba(45,212,191,0.35)  /* soft halo behind CTAs/dots */

--shadow:        0 1px 1px rgba(0,0,0,0.25)
--shadow-card:   0 12px 32px -16px rgba(0,0,0,0.6)
--shadow-pop:    0 24px 60px -30px rgba(0,0,0,0.8), 0 0 60px -20px var(--accent-glow)
```

### 2.2 Light theme (optional toggle)

A cool, crisp light variant kept for the theme toggle — not the default. Neutral whites, same teal accent, hairline borders.

```
--bg:            #fafafa
--surface:       #ffffff
--surface-2:     #f4f4f5
--text:          #18181b
--text-soft:     #52525b
--text-faint:    #a1a1aa
--border-c:      rgba(24,24,27,0.10)
--border-strong-c: rgba(24,24,27,0.16)
--hover-c:       rgba(24,24,27,0.04)
--accent:        #0d9488   /* slightly deeper teal for light bg contrast */
--accent-on:     #ffffff
--accent-deep:   #0f766e
--accent-faint:  rgba(13,148,136,0.12)
```

### 2.3 Brand utility aliases

The app uses `bg-paper`, `text-ink`, `bg-lime`, `border-line`, etc. throughout. Rather than touch every call site, we **repoint the aliases**:

```
--paper       → var(--bg)
--ink         → var(--text)
--ink-soft    → var(--text-soft)
--ink-faint   → var(--text-faint)
--line        → var(--border-c)
--line-strong → var(--border-strong-c)
--lime        → var(--accent)        /* was indigo; now teal. Alias kept so call sites compile. */
--lime-deep   → var(--accent-deep)
--lime-on     → var(--accent-on)
--lime-faint  → var(--accent-faint)
```

`--color-lime-*` Tailwind utilities (`bg-lime`, `text-lime-on`, `bg-lime/20`, etc.) keep working because they reference these vars. Over time we can rename `--lime` → `--accent` in the alias, but that's a mechanical rename, not required for this upgrade.

### 2.4 shadcn semantic tokens

Repoint to the dark ramp so existing shadcn components pick up the new look automatically:

```
--background: var(--bg)
--foreground: var(--text)
--card: #171715            /* slightly above surface */
--card-foreground: var(--text)
--popover: #1c1c1a
--popover-foreground: var(--text)
--primary: var(--accent)   /* teal primary buttons */
--primary-foreground: var(--accent-on)
--secondary: var(--surface)
--secondary-foreground: var(--text)
--muted: var(--surface-2)
--muted-foreground: var(--text-soft)
--accent-bg: rgba(255,255,255,0.06)
--accent-foreground: var(--text)
--destructive: #f87171
--border: var(--border-c)
--input: var(--border-strong-c)
--ring: var(--accent)
--radius: 0.625rem          /* bump from 0.375rem for a slightly softer feel */
```

### 2.5 Typography

Fonts are already loaded in `layout.tsx` — no font changes. Usage rules:

| Role | Font | Notes |
|------|------|-------|
| Display (H1, chapter titles, stat numbers, large prices) | Newsreader | 700 weight, tight tracking (-0.025em to -0.038em), italic accents for secondary clauses |
| Body, UI labels, buttons, nav | Hanken Grotesk | 400/500/600 |
| Mono — eyebrows, captions, code, view tabs, status pills, dates | JetBrains Mono | 400/500, uppercase + wide tracking (0.08–0.16em) |

### 2.6 Radius, depth, motion

- **Radius:** `0.625rem` default (was 0.375). Cards/panels `0.75rem`, prompt boxes `0.875rem`, pills fully rounded, inputs `0.5rem`.
- **Depth:** layered, not flat. Surfaces separated by `--border-c` hairlines *plus* a shadow on elevated elements. Teal glows behind primary CTAs and the brand dot. Mockup frames get a large soft shadow with a faint teal outer glow.
- **Motion:** keep the existing `reveal` fade-up and `ai-fade` keyframes. Add a `pulse` keyframe for the "AI connected" dot (opacity 1↔0.4 over 2s). Keep the 0.4s bg/color transition on theme change. Respect `prefers-reduced-motion`.
- **Scrollbars:** thin, `--border-strong-c` thumb on transparent, matching the dark surface.

## 3. Shared component refresh

Update the shadcn primitives in `src/components/ui/` to match. These are mostly token-driven (they already use `--card`, `--border`, `--ring`, etc.), so repointing tokens carries most of them. Targeted edits:

### 3.1 Button (`button.tsx`)
- `default` variant → `bg-primary text-primary-foreground` (now teal CTA). Add a soft glow shadow on default: `shadow-[0_8px_24px_-8px_var(--accent-glow)]`. Hover → `bg-primary/90` (which maps to `--accent-deep` via the primary token). No new variants needed — the glow is part of `default`.
- `outline` → `border border-line-strong bg-transparent hover:bg-hover`. (Currently `bg-background`; switch to transparent for the dark see-through look.)
- `ghost` unchanged (token-driven).
- Default radius inherits `--radius` (now 0.625rem) — buttons get slightly softer.

### 3.2 Card (`card.tsx`)
- Add `shadow-card` (the dark layered shadow) to the base `Card` className. Replace `shadow-sm`.
- Keep `rounded-xl`; with `--radius` at 0.625rem this reads as `0.75rem`.

### 3.3 Input / Textarea / Label
- Token-driven; mainly need the focus ring to read as teal: `focus-visible:ring-ring/50` already references `--ring` (now teal). Inputs get `bg-white/[0.04]` surface and `border-line` hairline; focus → `border-accent` + `ring-2 ring-accent/30`.

### 3.4 Badge / pill (`badge.tsx`)
- Repoint variants to the dark surface. Add a `teal` variant: `bg-accent-faint text-accent ring-1 ring-inset ring-accent/30`.

### 3.5 Dialog / Dropdown / Tooltip / Sonner toast
- Token-driven surfaces (`--popover`, `--card`) repoint automatically. Add `shadow-pop` to dialog/dropdown containers. Ensure toast uses the dark `--card` surface with `border-line` and a teal accent for action toasts.

### 3.6 Workspace status colors (`src/lib/workspace/colors.ts`)
- `PILL_CLASSES` currently maps color names to light Tailwind classes (e.g. `bg-lime-100 text-lime-700`). These render on dark surfaces now, so they'd wash out. **Rewrite for dark:** each color uses a translucent fill + bright text + ring, e.g.:
  - `teal:   "bg-accent-faint text-accent ring-1 ring-inset ring-accent/30"`
  - `amber:  "bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/30"`
  - `green:  "bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30"`
  - `zinc:   "bg-white/[0.06] text-text-soft ring-1 ring-inset ring-white/10"`
  - …same pattern for the rest (red/rose/orange/yellow/blue/indigo/violet/purple/fuchsia/pink/cyan/sky).
- `DOT_CLASSES` → bright `-400` variants for visibility on dark (e.g. `teal: "bg-teal-400"`, `amber: "bg-amber-400"`).

## 4. Marketing surfaces

### 4.1 Landing (`src/app/page.tsx`)

Restructure into the Lovable/Linear hybrid seen in the approved mockup. Keep all existing i18n dictionary keys (`L.hero`, `L.how`, `L.features`, `L.builtFor`, `L.closing`, `L.preview`) — only markup and classes change.

**Nav:** sticky, `bg-bg/80 backdrop-blur-md border-b border-line`. Logo `StudyOS` in Newsreader + teal dot. Right side: `ThemeToggle`, `LanguageSwitcher`, "Sign in" ghost link, **teal** "Get started →" button.

**Hero** (two-column on lg):
- Left: mono eyebrow with pulsing teal dot (`L.hero.badge`); H1 in Newsreader 700 with an italic clause and one teal-highlighted word; `L.hero.subtitle` lede; the **prompt-as-hero** — a dark surface card with a mono header row (dots + "studyos · new workspace"), an italic Newsreader placeholder line, an input row with a teal "Build →" button, and a mono hint line (⌘↵, 10 languages, free to start).
- Right: a **rendered mockup of the generated workspace** (reuse `WorkspacePreview` but restyle to dark + real sidebar/board with the user's `L.preview` data). Window chrome dots, "Pre-med Spring '26 · generated" title in Newsreader, a "built in 9.4s" indicator with a teal dot. Sidebar with Workspace/Views sections; main area with view tabs + a 3-column board using real `L.preview.cards`/`L.preview.columns` and teal/amber/green status tags.

**Built-for strip:** mono uppercase label + the `L.builtFor.items` separated by dots, `text-ink-faint`.

**How it works** → renamed to **Chapter 01 · Generate**:
- Chapter head: `01` in teal mono + `Generate` label; `L.how.title` in Newsreader; `L.how.subtitle` lede.
- Body: left column copy + checkmark list (reuse `L.how.steps` content as bullets); right column a second prompt mockup showing a CS-sophomore example with a "generating… 9.4s" hint.

**Features** → **Chapter 02 · Organize**:
- Chapter head with `L.features.title` / `L.features.subtitle`.
- Body: **two real mockups side by side** — a database table view (reuse `L.preview` rows: Midterm Exam, Problem Set 3, Lab Report 2, Proofs Quiz, Essay Draft with course/due/weight/status columns and teal/amber/green status tags) and a month calendar with real deadline events color-coded. The six `L.features.items` become a compact bullet list above or beside the mockups (not a 3-card grid).

**New Chapter 03 · Ask** (uses existing `L.closing`-adjacent copy or the "ask in plain English" content from the README; if dictionary keys are missing, reuse `dict.landing.features.items.assistant` text and the README examples):
- Chapter head "Your workspace edits itself."
- Body: left copy with the three plain-English examples ("Add a midterm to CS next Friday." etc.) as a bullet list; right an **agent chat mockup** — header with teal "agent · connected" dot, a user message bubble, an AI response referencing the workspace update, a mono "Updating Assignments database · 1 row added" action line, and an input row.

**Stats row:** four stat cards (9.4s avg build · 10 languages · 3 views · $0 to start) in a 4-up grid with Newsreader numbers and mono labels. (Content is illustrative; wire to dictionary or hardcode.)

**Closing CTA:** centered, `border-top` with a teal gradient hairline, big Newsreader headline (`L.closing.titleLine1` / `titleLine2` with italic on line 2), `L.closing.subtitle`, large teal "Build your workspace →" button.

**Footer:** `StudyOS` + teal dot, `L.footer.tagline`.

### 4.2 Pricing (`src/app/pricing/page.tsx`)

Same dark shell. Heading centered with mono badge + Newsreader H1 + lede. Two plan cards:
- **Free:** `border-line` card, mono name, big Newsreader price, feature list with the existing `Feature` checkmarks (repoint the check circle to `bg-white/[0.06] text-text-faint` for the non-strong variant). Outline CTA.
- **Pro:** `border-accent` (teal border, 1.5px) card with the "★ most popular" badge in **teal** (`bg-accent text-accent-on`), same layout, **teal** primary CTA for upgrade. The "current plan" pill uses `bg-accent-faint ring-1 ring-inset ring-accent/30`.

Credits section, comparison table (Pro column highlight becomes `bg-accent-faint` instead of `bg-lime-faint`), FAQ cards, and bottom CTA all repoint via tokens. The `Feature` and `Mark` helpers: strong checkmarks → `bg-accent text-accent-on`; non-strong → `bg-white/[0.06] text-text-soft`.

### 4.3 Generate (`src/app/generate/GeneratorClient.tsx`)

Dark shell. `DescribeStage`: mono step label, Newsreader H1, lede, a **prompt surface** (dark card, `border-line`, `shadow-card`, focus-within → `border-accent`) with the textarea and a teal "Continue →" button. Example chips → `border-line` buttons with `hover:border-accent hover:text-text`. `QuestionsStage`: question cards become dark surfaces with `border-line` and `shadow-card`; option chips selected state → `bg-accent text-accent-on border-accent`; "Other" chip same selected style. Build button → teal primary. The fullscreen `AiActivity` / `GenerationActivity` overlays get dark surfaces + teal progress accents.

### 4.4 Auth (`sign-in` / `sign-up`)

Dark centered shell (`bg-bg`). Logo + teal dot in Newsreader. Clerk `<SignIn>`/`<SignUp>` — update the `appearance` prop in `layout.tsx` from `colorPrimary: "#1a1a17"` to `colorPrimary: "#2dd4bf"` (teal) so Clerk's primary buttons match. Clerk variables for dark mode: set `colorBackground`, `colorText`, `colorInputBackground`, `colorBorder` to match the dark tokens via the `appearance.variables` map. `LanguageSwitcher` below.

## 5. In-app workspace

### 5.1 App home (`src/app/app/page.tsx`)

Dark shell (`bg-bg text-text`). Header `border-b border-line bg-surface`. Logo + teal dot. The "Generate" prompt card becomes a dark surface with `shadow-pop` and a teal CTA. Workspace grid cards: `border-line bg-card shadow-card`, hover `-translate-y-0.5` + `border-accent/40` + `shadow-pop`. The upgrade/pro banners use `bg-accent-faint` + teal dot instead of `bg-lime-faint` + lime dot. Empty state dashed border → `border-line-strong`. "Load demo" outline button → `border-line-strong hover:bg-hover`.

### 5.2 Workspace editor (`WorkspaceEditor.tsx`)

- Root: `bg-bg text-text`.
- **Sidebar:** `bg-surface border-r border-line`. Logo + teal dot. Workspace icon/name inputs hover/focus → `bg-white/[0.04]` + `ring-accent/30`. Page nav items active → `bg-white/[0.06] text-text`; hover → `bg-hover`. Delete button → `hover:text-rose-400`.
- **Topbar:** `border-b border-line`. Breadcrumb in mono `text-text-faint`. The "Ask AI" toggle button: idle `border-line-strong bg-card`, active `border-accent bg-accent-faint text-text`, and its status dot → `bg-accent`. `SaveIndicator` dot colors: saving `bg-amber-400`, saved `bg-emerald-400`, error `bg-rose-500` (already semantic; keep).
- **PageView** content area: `bg-bg`, scrollable.

### 5.3 Database views (`DatabaseView.tsx`)

- View tabs: active `border-accent text-text` (was `border-ink`), inactive `border-transparent text-text-faint hover:text-text-soft`.
- **TableView:** container `border-line bg-card shadow-card`. Header row `bg-white/[0.02] text-text-faint` mono. Row hover `bg-hover`. Editable cell focus → `bg-white/[0.04] ring-1 ring-accent/30`. Checkbox `accent-[--accent]`. URL cells → `text-accent` (was `text-lime`).
- **BoardView:** columns get a subtle `bg-white/[0.02]` surface. Cards `border-line bg-card shadow-sm`. Drag-over column highlight → `bg-accent/10 ring-2 ring-accent/40` (was `bg-lime/20 ring-lime-deep/40`). Card drag handle, delete button → same hover semantics.
- **CalendarView:** container `border-line bg-card shadow-card`. Day cells `border-line`; today highlight → `bg-accent-faint` with `text-accent` day number (was `bg-lime/20`). Drag-over day → `bg-accent/10`. Event pills use the **rewritten** `pillClasses` (dark translucent). Month header in Newsreader.
- **DatabaseSettings** `<details>`: `border-line bg-surface`. Inputs/selects → dark surface + `border-line` + teal focus border.

### 5.4 Agent chat (`AgentChat.tsx`)

- Panel: `bg-bg border-l border-line`. Width unchanged (~390px).
- Header: agent orb avatar `bg-accent` with `bg-accent/30` ring when busy; the `ai-orb`/`ai-ring` animations keep working but now pulse teal. Title in Newsreader. Subtitle mono.
- User message bubble: `bg-accent text-accent-on rounded-2xl rounded-br-sm` (was `bg-ink`). 
- Assistant bubble: `border-line bg-card text-text rounded-2xl rounded-bl-sm`.
- Choice buttons: `border-line-strong bg-card hover:border-accent hover:bg-accent/10`. "Other" expanded state → `border-accent bg-accent text-accent-on`.
- "Workspace updated" pill → `bg-accent/30 text-accent ring-1 ring-inset ring-accent/40` (was lime). Affected-area pills → `bg-white/[0.06] text-text-soft`. Undo button unchanged (token-driven).
- Input row: `border-line-strong bg-card focus-within:border-accent/50`. Send button → `bg-accent text-accent-on` (was `bg-ink`).

### 5.5 Agent progress card (`AgentProgressCard.tsx`) & undo (`AgentUndoButton.tsx`)

Token-driven refresh: dark surface, teal progress bar fill, teal cancel/undo affordances. The progress bar already uses `bg-lime`-ish fills in places — repoint to `bg-accent`.

### 5.6 Settings (`src/app/app/settings/page.tsx`)

Dark shell. Section cards → `border-line bg-card/60` (the `/60` alpha over dark bg reads nicely). Profile avatar → `bg-accent text-accent-on` (was `bg-ink text-paper`). Plan badge: pro → `bg-accent text-accent-on`; free → `bg-white/[0.06] text-text`. Credit balance pill: teal dot (`text-accent`) + `bg-white/[0.05]`. Buttons → teal primary / outline secondary. Sign-out link → `hover:text-rose-400`.

### 5.7 Credits (`src/app/app/credits/page.tsx`)

Dark shell. Balance pill teal dot. The credit-pack card: `border-2 border-accent bg-card shadow-pop` with a teal outer glow. Buy button → teal primary.

### 5.8 Account menu, credit chip, language switcher

`AccountMenu`, `CreditChip`, `ManageAccountButton`, `LanguageSwitcher` — all token-driven; repointing tokens refreshes them. Verify the dropdown menu uses `--popover` (dark) and the credit chip's dot is teal.

## 6. Theme behavior

- **Default theme → dark.** Change `ThemeProvider` `defaultTheme="light"` to `defaultTheme="dark"`. Keep `enableSystem={false}` (we ship an explicit toggle, not OS-following).
- The light variant from §2.2 becomes the special case. Concretely: the existing `:root` block (currently the warm light palette) is **rewritten** to hold the dark ramp; the existing `.dark { ... }` block is **removed** (its dark values merge into `:root`); a new `.light { ... }` block holds the light overrides from §2.2. Since next-themes `attribute="class"` sets the theme name as a class, dark mode adds `class="dark"` (a no-op since `:root` is already dark) and light mode adds `class="light"` (which applies the overrides).
- The `ThemeToggle` icon (☾/☀) logic inverts: show ☀ in dark mode (to switch to light), ☾ in light mode. Adjust the condition.
- Keep the 0.4s bg/color transition.

## 7. Clerk appearance

In `layout.tsx`, expand the `ClerkProvider appearance` to theme Clerk's components for dark:

```
appearance={{
  variables: {
    colorPrimary: "#2dd4bf",
    colorBackground: "#131312",
    colorText: "#f4f3ef",
    colorInputBackground: "#17171599",
    colorInputText: "#f4f3ef",
    colorBorder: "rgba(255,255,255,0.14)",
    colorDanger: "#f87171",
    borderRadius: "0.625rem",
  },
  elements: {
    formButtonPrimary: "bg-[#2dd4bf] text-[#0b0b0a] hover:bg-[#14b8a6]",
    card: "bg-[#131312] border border-[rgba(255,255,255,0.08)]",
    headerTitle: "font-[Newsreader] !font-bold",
  },
}}
```

(Exact element keys per Clerk's appearance API; verify against `@clerk/nextjs` v7 docs at implementation time.)

## 8. What does NOT change

- **Fonts** (Newsreader, Hanken Grotesk, JetBrains Mono) and how they're loaded in `layout.tsx`.
- **i18n** dictionaries, structure, RTL handling, 10-language support.
- **Functionality** — no data model, API, routing, auth, billing, or agent-logic changes. Pure presentation + tokens + Clerk appearance.
- **Component APIs** — no prop signatures change; `WorkspaceEditor`, `AgentChat`, `DatabaseView`, etc. keep their interfaces.
- **`pillClasses`/`dotClass` function signatures** — only their internal class maps change.
- **Tests** — `AgentUndoButton.test.tsx` and `AgentProgressCard.test.tsx` should still pass (they test behavior, not styles). If any assert on class names, update those assertions.

## 9. Migration approach

Because the app uses semantic aliases (`bg-paper`, `text-ink`, `bg-lime`, `border-line`) everywhere, **the single highest-leverage edit is repointing the CSS variables in `globals.css`** — most of the app transforms the moment those flip. The remaining work is:

1. `globals.css` — rewrite `:root` to the dark ramp, add `.light` overrides, repoint aliases, bump radius, add `--accent-glow`.
2. `ThemeProvider.tsx` — `defaultTheme="dark"`, class strategy.
3. `ThemeToggle.tsx` — invert icon logic.
4. `layout.tsx` — Clerk `appearance` for dark + teal.
5. `src/lib/workspace/colors.ts` — rewrite `PILL_CLASSES`/`DOT_CLASSES` for dark.
6. `src/components/ui/button.tsx` — add teal glow shadow to `default`; `outline` → transparent bg.
7. `src/components/ui/card.tsx` — `shadow-sm` → `shadow-card`.
8. `src/app/page.tsx` — restructure landing into hero-with-mockup + numbered chapters (biggest markup change).
9. Per-surface class tweaks where tokens don't fully cover (status dots, specific hover states, the prompt-as-hero card, mockup components on landing).
10. Verify tests pass; run `pnpm lint` and `pnpm build`.

## 10. Open questions for review

- **Chapter 03 ("Ask") copy:** the landing currently has no dedicated "ask the agent" section in the dictionary — only a feature bullet and the README's examples. OK to add a small dictionary section (`landing.ask.*`) for the chapter title/subtitle/examples, or should Chapter 03 reuse existing `L.features.items.assistant` text and the README examples hardcoded?
- **Stats row content:** 9.4s / 10 / 3 / $0 are illustrative. Confirm these are acceptable, or drop the stats row entirely.
- **Light theme effort:** keeping a polished light variant doubles the token QA. Is a light toggle still wanted, or should we ship dark-only and drop the toggle for now?

