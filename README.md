<div align="center">

<img src="public/studyos-logo.png" alt="StudyOS" width="108" height="108" />

# StudyOS&nbsp;&nbsp;✦

### Your semester, set up in about a minute. Then it keeps itself current.

Describe your courses or upload a syllabus. StudyOS sets up your deadlines, a plan
for today and a place to study. Connect your school calendar and new deadlines come
in on their own. Miss a day and the plan rebuilds around what's left.

<br/>

![Ten languages](https://img.shields.io/badge/languages-10-2dd4bf?style=flat-square&labelColor=0b0b0a)
![Studying is free](https://img.shields.io/badge/studying-free_on_every_plan-2dd4bf?style=flat-square&labelColor=0b0b0a)

</div>

---

## How it works

1. **Describe your courses.** One sentence is enough, or paste or upload your
   syllabus. StudyOS asks a couple of short questions, then builds your workspace.
   A build takes about a minute.
2. **Connect your school calendar.** Paste the calendar link from Moodle, ILIAS,
   Stud.IP, Canvas, Blackboard, Brightspace or Google Calendar (or upload an `.ics`
   file). Deadlines come in with their dates and courses.
3. **Open Today.** Each day you get a short list that fits the time you have.
   Whatever you don't finish moves forward without piling up.

## What it does

| | |
| :--- | :--- |
| **Deadlines that fill themselves in** | Calendar feeds from Moodle (English or German sites), ILIAS, Stud.IP, Canvas, Blackboard, Brightspace and Google Calendar. When you open a workspace, StudyOS checks for new and changed deadlines (at most every six hours, or when you tap *Sync now*). Your own edits are kept; a deadline removed from the calendar is flagged, never deleted. Links are stored encrypted (set `FEED_URL_KEY`). Going the other way, subscribe to your deadlines from Google, Apple or Outlook Calendar. |
| **A daily plan that forgives missed days** | *Today* picks a short list from deadlines, exams, flashcards and to-dos, sized to your daily time (30 minutes to 6 hours). Unfinished items roll forward, exams get short reviews in the three weeks before, and it warns when the coming days hold more work than your time allows. Deterministic: no AI credits, no invented coursework. |
| **Built for the Klausurenphase** | An exam that decides a module (a *Klausur*, or any exam worth half the grade or more) is planned from six weeks out: twice a week, then every other day, then daily in the last two weeks, with about 30 hours of preparation (6 per ECTS when the table has credits, or your own estimate). With several exams in the same weeks the nearest gets the most of the day. |
| **Fristen that cannot be missed** | Exam registration and deregistration, re-enrolment (*Rückmeldung*) and fee deadlines are read as what they are: ten minutes of paperwork that cannot be made up. They are never mistaken for an exam, are guaranteed a place in the plan in their last three days, and are reminded 7, 3 and 1 day before. A registration window in a university's calendar file is imported as a deadline on the day it closes. |
| **Study kits from your own material** | Upload slides, notes or readings (PDF, Word, text). StudyOS writes summary notes, flashcards and a practice quiz; every card and question keeps a quote from your material, and the quote is verified against the document before it is kept. Unverifiable suggestions are dropped. You see the cost first and pay only if it works. |
| **Handwritten notebooks** | Notebooks you write in by hand, like paper: pens with pressure, a highlighter, an eraser, a lasso to move, resize and recolor what you wrote, and shapes. Ruled, grid, dotted and Cornell paper, or import a PDF (lecture slides, worksheets) and annotate it page by page. Your handwriting is recognised in the background so the search finds it, and a notebook linked to a course makes study kits from your notes. Works with Apple Pencil on iPad as an installed web app, and with a pen, touch or mouse on a PC. |
| **Practice quizzes** | Multiple choice, true/false and short answers, an exam mode (optional timer, no feedback until you submit) and a round of the questions you keep missing. |
| **Flashcards on FSRS** | Spaced repetition with FSRS scheduling, a gentle catch-up after days off, streak freezes, practice mode, statistics, and import/export for Anki and Quizlet text formats. |
| **Grade tracker** | Where you stand and what you need on the rest to reach a target, in percentages, US letter grades or GPA, UK degree classes or German grades, with a what-if mode. With German grades you enter module grades (1,0 to 5,0) and credits directly and get the Notenschnitt: weighted by ECTS, failed modules left out, cut off after the first decimal as examination regulations prescribe. The same calculation is free and needs no account at `/tools/grade-calculator`. |
| **Agenda and grades at a glance** | The agenda lists every deadline and exam across all your courses for the next two weeks (overdue first), filterable by course, each with a Focus button. The grades overview shows every course's standing and what you need on the rest, with an overall GPA or average per grading scale (never mixed across scales). |
| **An assistant that edits your workspace** | Ask in plain words; each change comes with an Undo button, the conversation persists, and one message never spends more than a fixed credit ceiling. |
| **A real editor** | Block pages (type `/` to insert), tables, boards and calendars with saved filters and sorts, workspace-wide undo and redo, version-checked autosave and a 30-day trash. |
| **A focus timer that counts** | Start a 15, 25 or 50-minute block from any item on Today (or the command palette). It keeps running while you move around the app, survives a refresh, chimes when time is up and records the minutes against the course, so Today and the insights page show how much you really studied. |
| **Study insights** | Focus time, active days, streaks, cards reviewed, recall rate and quiz accuracy for the last 7, 30 or 90 days, compared with the period before, per course, with your best time of day and a CSV download. |
| **Share a page** | Publish one page at a private, unguessable link: classmates see the notes and tables and can practise its flashcards and quizzes, without an account. Grades and the rest of the workspace stay private, the link can be turned off at any time, and visitors can save a copy to their own StudyOS. |
| **Coming from Notion** | Upload Notion's "Markdown & CSV" export (.zip, up to 25 MB): pages, subpages, callouts, code, math and links between pages come in as pages, and CSV databases as tables with a board and a calendar view. No AI, no credits; what doesn't fit is listed. |
| **Help and your rights** | A searchable help centre at `/help` (14 articles, every number taken from the product's own settings). For buyers in the EU: withdraw from a purchase at `/withdraw` and cancel a subscription at `/cancel`, without signing in, each confirmed by email (§ 356a and § 312k BGB). |
| **Everything else** | Search across workspaces, export to Markdown, CSV or `.zip`, print to PDF, install to the home screen, "Download my data" and self-serve account deletion. Ten languages, Arabic right to left. |

## Pricing

Studying is free on every plan: flashcard reviews, quizzes, Today, the grade tracker,
editing, deadline sync, export and undo never use credits. Credits pay for AI work.
There are no feature gates: every feature is on both plans. Handwriting recognition
for search uses no credits either: it only indexes your own notes, and a daily cap
(300 pages a day on Free, 1,500 on Pro) bounds it instead.

- **Free** is a trial: a new account gets 300 credits once, to try everything. There
  is no monthly top-up.
- **Pro:** $7.99 a month or $39.99 a year (the prices shown while billing is off;
  with billing on, the pages show what the Stripe prices charge). Pro gives 1,000
  credits for every paid month, higher hourly limits and a higher per-message ceiling
  (30 credits on Free, 100 on Pro).
- **Credit packs:** 1,000 credits for $10, one-time, on either plan.
- **Invites:** every student has a personal invite link. When a friend who signed up
  through it builds their first workspace, both get 100 credits. The inviter earns
  them for up to 20 friends, 5 in any 24 hours; past that the friend still gets theirs.
- Credits never expire and unused credits carry over.

Every AI action has a fixed, published price, shown before the student starts it:

| Action | Credits |
| :--- | ---: |
| Build a workspace (setup questions included) | 30 |
| One assistant message | 3 |
| Study kit, per part of the material processed | 10 |
| A rendered visual from the sandbox | 2 |

What is charged equals what was shown, except that a failure that delivered nothing
is free (for assistant messages, up to 3 a day) and a stopped run pays only the share
it completed, never more than the price. If the configured model is expensive enough
that an action's real cost exceeds its price, the action is charged its real cost and
the pages show the higher figure (and the most it can cost) up front: the list price
is a floor, not a promise the code cannot keep. A long assistant request can likewise
cost more than 3, never more than the per-message ceiling.

One module holds all of it: `src/lib/price-list.ts` (trial, Pro and invite grants, action
prices, per-message ceilings, hourly limits, the fallback Pro prices). The pricing,
landing, credits, settings, generator and terms pages, the assistant chat and the
study-kit dialog read it; `src/lib/price-list.test.ts` checks this README against it.
Displayed Pro prices with billing on come from Stripe (`src/lib/plan-pricing.ts`,
`STRIPE_PRICE_PRO`, `STRIPE_PRICE_PRO_ANNUAL`); `STUDYOS_PRO_MONTHLY_PRICE` /
`STUDYOS_PRO_ANNUAL_PRICE` override the fallback shown while billing is off. Existing
subscribers keep the Stripe price they subscribed at.

## Development

Next.js 16, React 19, TypeScript, Tailwind 4, Prisma on Postgres, Clerk, Stripe,
Vitest. Read `AGENTS.md` first: this Next.js version differs from older ones.

```bash
npx pnpm@10 install
cp .env.example .env.local   # fill in the values; src/lib/ops/env.ts documents each one
npx pnpm@10 dev
npx pnpm@10 exec tsc --noEmit
npx pnpm@10 lint
npx pnpm@10 test
```

Running it as a business: the operator console at `/app/admin` (accounts, revenue,
AI spend, failed runs, student feedback, reported share links) opens for the Clerk
user ids in `STUDYOS_ADMIN_USER_IDS`. The legal notice, VAT, invoices and the EU
withdrawal consent at checkout are switched on by settings; `docs/launch-checklist.md`
lists every step between this code and the first paying customer.

Public settings worth knowing: `STUDYOS_SUPPORT_EMAIL` (the support address shown on
public pages), `STUDYOS_PRO_MONTHLY_PRICE` / `STUDYOS_PRO_ANNUAL_PRICE` (displayed
prices), `FEED_URL_KEY` (encrypts connected calendar links; set it in production).

<sub>StudyOS ✦ The study planner that keeps itself up to date.</sub>
