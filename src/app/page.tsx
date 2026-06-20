import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { getI18n } from "@/lib/i18n/server";

type Landing = Dictionary["landing"];
type Preview = Landing["preview"];
type Feature = Landing["features"]["items"]["generate"];

const askExamples = [
  "Add a midterm to CS next Friday.",
  "Mark the Physics lab as done.",
  "Make a tracker for my thesis chapters.",
];

const assignmentRows = [
  {
    title: "Midterm Exam",
    course: "CS 101",
    due: "Mon 12",
    weight: "30%",
    status: "To do",
    tone: "teal",
  },
  {
    title: "Problem Set 3",
    course: "CS 101",
    due: "Fri 16",
    weight: "10%",
    status: "In progress",
    tone: "amber",
  },
  {
    title: "Lab Report 2",
    course: "PHYS 150",
    due: "Wed 14",
    weight: "15%",
    status: "Done",
    tone: "green",
  },
  {
    title: "Proofs Quiz",
    course: "MATH 201",
    due: "Tue 13",
    weight: "5%",
    status: "To do",
    tone: "teal",
  },
  {
    title: "Essay Draft",
    course: "ENG 102",
    due: "Fri 19",
    weight: "20%",
    status: "Done",
    tone: "green",
  },
] as const;

const calendarEvents: Record<
  number,
  { label: string; tone: "teal" | "amber" | "green" }
> = {
  8: { label: "Lab 2 · done", tone: "green" },
  9: { label: "Midterm · CS", tone: "teal" },
  10: { label: "PS3 · CS", tone: "amber" },
  12: { label: "Proofs · Math", tone: "teal" },
  16: { label: "Essay · ENG", tone: "amber" },
  20: { label: "Reading ✓", tone: "green" },
};

export default async function Home() {
  const { userId } = await auth();
  const { dict } = await getI18n();
  const L = dict.landing;
  const features = [
    L.features.items.generate,
    L.features.items.databases,
    L.features.items.calendar,
    L.features.items.dashboard,
    L.features.items.autosave,
    L.features.items.assistant,
  ];
  const promptExample = dict.generate.examples[1].text;
  const [heroLead, heroAccent] = splitLastWord(L.hero.titleLine2);

  return (
    <div className="min-h-screen bg-paper text-ink antialiased">
      <header className="sticky top-0 z-40 border-b border-line bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-7">
          <Brand />
          <nav className="hidden items-center gap-8 text-sm text-ink-soft md:flex">
            <a href="#generate" className="transition-colors hover:text-ink">
              {L.nav.howItWorks}
            </a>
            <a href="#organize" className="transition-colors hover:text-ink">
              {L.nav.features}
            </a>
            <Link href="/pricing" className="transition-colors hover:text-ink">
              {L.nav.pricing}
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageSwitcher compact />
            {userId ? (
              <>
                <Link
                  href="/app"
                  className="hidden rounded-lg bg-lime px-4 py-2 text-[13px] font-semibold text-lime-on shadow-[0_8px_24px_-8px_var(--accent-glow)] transition hover:bg-lime-deep sm:inline-flex"
                >
                  {L.nav.openApp}
                  <span aria-hidden>→</span>
                </Link>
                <UserButton />
              </>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className="hidden px-3 py-2 text-[13px] font-medium text-ink-soft transition hover:text-ink sm:block"
                >
                  {L.nav.signIn}
                </Link>
                <Link
                  href="/sign-up"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-lime px-4 py-2 text-[13px] font-semibold text-lime-on shadow-[0_8px_24px_-8px_var(--accent-glow)] transition hover:bg-lime-deep"
                >
                  {L.nav.getStarted}
                  <span aria-hidden>→</span>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="overflow-hidden border-b border-line">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-16 sm:px-7 sm:py-20 lg:grid-cols-[0.92fr_1.08fr] lg:gap-12 lg:py-24">
            <div>
              <p
                className="reveal flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint"
                style={{ animationDelay: "0s" }}
              >
                <span
                  className="pulse-dot h-2 w-2 rounded-full bg-lime shadow-[0_0_12px_var(--accent-glow)]"
                  aria-hidden
                />
                {L.hero.badge}
              </p>
              <h1
                className="reveal mt-5 font-display text-[3.25rem] font-bold leading-[0.94] tracking-[-0.04em] text-balance sm:text-[4.75rem]"
                style={{ animationDelay: "0.07s" }}
              >
                <span className="font-medium italic text-ink-soft">
                  {L.hero.titleLine1}
                </span>
                <br />
                {heroLead && <>{heroLead} </>}
                <span className="text-lime">{heroAccent}</span>
              </h1>
              <p
                className="reveal mt-6 max-w-[42ch] text-[17px] leading-7 text-ink-soft"
                style={{ animationDelay: "0.14s" }}
              >
                {L.hero.subtitle}
              </p>
              <div
                className="reveal mt-8"
                style={{ animationDelay: "0.21s" }}
              >
                <PromptCard
                  prompt={promptExample}
                  finePrint={L.hero.finePrint}
                  demoLabel={L.hero.ctaDemo}
                />
              </div>
            </div>

            <div
              className="reveal lg:-mr-16"
              style={{ animationDelay: "0.18s" }}
            >
              <WorkspacePreview preview={L.preview} />
            </div>
          </div>
        </section>

        <section className="border-b border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-5 font-mono text-[10px] uppercase tracking-[0.11em] text-ink-faint sm:px-7">
            <span className="text-lime">{L.builtFor.label}</span>
            {L.builtFor.items.map((item, index) => (
              <span key={item} className="flex items-center gap-4">
                {index > 0 && (
                  <span className="text-line-strong" aria-hidden>
                    ·
                  </span>
                )}
                {item}
              </span>
            ))}
          </div>
        </section>

        <section id="generate" className="scroll-mt-20 border-b border-line">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-7 sm:py-24">
            <ChapterHeader
              number="01"
              label="Generate"
              title={L.how.title}
              subtitle={L.how.subtitle}
            />
            <div className="mt-12 grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
              <ul className="space-y-1">
                {L.how.steps.map((step) => (
                  <li
                    key={step.title}
                    className="flex gap-4 border-b border-line py-5 first:pt-0"
                  >
                    <span
                      className="mt-0.5 font-mono text-sm text-lime"
                      aria-hidden
                    >
                      →
                    </span>
                    <div>
                      <h3 className="font-medium text-ink">{step.title}</h3>
                      <p className="mt-1.5 text-sm leading-6 text-ink-soft">
                        {step.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <GenerationPromptPreview prompt={dict.generate.examples[0].text} />
            </div>
          </div>
        </section>

        <section id="organize" className="scroll-mt-20 border-b border-line">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-7 sm:py-24">
            <ChapterHeader
              number="02"
              label="Organize"
              title={L.features.title}
              subtitle={L.features.subtitle}
            />
            <FeatureList features={features} />
            <div className="mt-10 grid gap-5 lg:grid-cols-[1.18fr_0.82fr]">
              <AssignmentsPreview preview={L.preview} />
              <CalendarPreview />
            </div>
          </div>
        </section>

        <section id="ask" className="scroll-mt-20 border-b border-line">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-7 sm:py-24">
            <ChapterHeader
              number="03"
              label="Ask"
              title="Your workspace edits itself."
              subtitle={L.features.items.assistant.body}
            />
            <div className="mt-12 grid items-center gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:gap-16">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-lime">
                  {L.features.items.assistant.title}
                </p>
                <ul className="mt-5 space-y-3">
                  {askExamples.map((example) => (
                    <li
                      key={example}
                      className="flex gap-3 text-[15px] leading-6 text-ink-soft"
                    >
                      <span className="font-mono text-lime" aria-hidden>
                        →
                      </span>
                      “{example}”
                    </li>
                  ))}
                </ul>
                <p className="mt-6 max-w-md text-sm leading-6 text-ink-faint">
                  Changes happen live in the right database and stay reversible.
                </p>
              </div>
              <AgentPreview />
            </div>
          </div>
        </section>

        <StatsRow />

        <section className="px-5 sm:px-7">
          <div className="relative mx-auto max-w-6xl py-24 text-center sm:py-28">
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{
                background:
                  "linear-gradient(90deg, transparent, var(--accent), transparent)",
              }}
              aria-hidden
            />
            <h2 className="font-display text-5xl font-bold leading-[0.98] tracking-[-0.035em] sm:text-6xl">
              {L.closing.titleLine1}
              <br />
              <span className="font-medium italic text-ink-soft">
                {L.closing.titleLine2}
              </span>
            </h2>
            <p className="mx-auto mt-5 max-w-md text-[17px] text-ink-soft">
              {L.closing.subtitle}
            </p>
            <Link
              href="/generate"
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-lime px-7 py-4 text-sm font-bold text-lime-on shadow-[0_12px_32px_-10px_var(--accent-glow)] transition hover:bg-lime-deep"
            >
              Build your workspace
              <span aria-hidden>→</span>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 sm:flex-row sm:px-7">
          <Brand />
          <span className="text-sm text-ink-faint">{L.footer.tagline}</span>
        </div>
      </footer>
    </div>
  );
}

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-1.5 font-display text-xl font-bold tracking-[-0.02em]"
    >
      StudyOS
      <span
        className="mb-2 h-1.5 w-1.5 rounded-full bg-lime shadow-[0_0_10px_var(--accent-glow)]"
        aria-hidden
      />
    </Link>
  );
}

function PromptCard({
  prompt,
  finePrint,
  demoLabel,
}: {
  prompt: string;
  finePrint: string;
  demoLabel: string;
}) {
  return (
    <div className="max-w-[470px] rounded-2xl border border-line-strong bg-surface p-3 shadow-pop">
      <div className="flex items-center gap-2 border-b border-line px-1 pb-3 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">
        <WindowDots />
        <span className="ml-auto">studyos · new workspace</span>
      </div>
      <div className="px-1 pb-1 pt-4">
        <p className="font-display text-lg italic leading-7 text-ink">“{prompt}”</p>
        <div className="mt-4 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate rounded-lg border border-line bg-white/[0.03] px-3 py-2.5 text-xs text-ink-faint">
            Describe your semester…
          </span>
          <Link
            href="/generate"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-lime px-4 py-2.5 text-xs font-semibold text-lime-on transition hover:bg-lime-deep"
          >
            Build
            <span aria-hidden>→</span>
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] text-ink-faint">
          <span>{finePrint}</span>
          <Link
            href="/app"
            className="text-ink-soft underline-offset-4 hover:text-ink hover:underline"
          >
            {demoLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}

function WorkspacePreview({ preview }: { preview: Preview }) {
  const columns = [
    {
      label: preview.columns.todo,
      count: "4",
      cards: [
        { title: "Proofs Quiz", course: "MATH 201", tone: "neutral" },
        { title: "Midterm Exam", course: "CS 101", tone: "teal" },
      ],
    },
    {
      label: preview.columns.doing,
      count: "2",
      cards: [
        { title: "Problem Set 3", course: "CS 101", tone: "amber" },
        { title: preview.cards[1], course: "CS 210", tone: "neutral" },
      ],
    },
    {
      label: preview.columns.done,
      count: "7",
      cards: [
        { title: preview.cards[2], course: "PHYS 150", tone: "green" },
      ],
    },
  ];

  return (
    <figure className="w-full min-w-0 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-pop">
      <div className="flex items-center gap-3 border-b border-line bg-white/[0.02] px-4 py-3">
        <WindowDots />
        <figcaption className="min-w-0 truncate font-display text-sm font-semibold">
          {preview.name}
          <span className="font-normal italic text-ink-faint"> · generated</span>
        </figcaption>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[9px] text-ink-faint">
          <span
            className="h-1.5 w-1.5 rounded-full bg-lime shadow-[0_0_8px_var(--accent-glow)]"
            aria-hidden
          />
          built in 9.4s
        </span>
      </div>
      <div className="grid min-h-[330px] grid-cols-[112px_1fr] sm:grid-cols-[145px_1fr]">
        <aside className="border-r border-line bg-black/10 p-2.5">
          <SidebarLabel>Workspace</SidebarLabel>
          <SidebarItem label="Dashboard" count="·" tone="teal" active />
          <SidebarItem label="Assignments" count="14" tone="amber" />
          <SidebarItem label={preview.coursesLabel} count="3" tone="green" />
          <SidebarItem label="Reading list" count="22" tone="blue" />
          <div className="my-2 border-t border-line" />
          <SidebarLabel>Views</SidebarLabel>
          <SidebarItem label="Board" />
          <SidebarItem label="Calendar" />
        </aside>
        <div className="min-w-0 p-3 sm:p-4">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="font-display text-base font-semibold">
              {preview.thisWeek}
            </h3>
            <div className="flex gap-1 font-mono text-[8px]">
              <span className="rounded-md border border-line-strong bg-hover px-2 py-1 text-ink">
                Board
              </span>
              <span className="px-2 py-1 text-ink-faint">Table</span>
              <span className="px-2 py-1 text-ink-faint">Calendar</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {columns.map((column) => (
              <div key={column.label} className="min-w-0">
                <p className="mb-2 flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.08em] text-ink-faint">
                  <span className="truncate">{column.label}</span>
                  <span className="rounded bg-hover px-1 py-0.5 text-[7px] text-ink-soft">
                    {column.count}
                  </span>
                </p>
                <div className="space-y-2">
                  {column.cards.map((card) => (
                    <div
                      key={card.title}
                      className="rounded-lg border border-line bg-white/[0.03] p-2"
                    >
                      <p className="text-[10px] font-medium leading-tight text-ink sm:text-[11px]">
                        {card.title}
                      </p>
                      <StatusTag tone={card.tone}>{card.course}</StatusTag>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

function SidebarLabel({ children }: { children: string }) {
  return (
    <p className="px-2 pb-1 pt-1 font-mono text-[7px] uppercase tracking-[0.12em] text-ink-faint sm:text-[8px]">
      {children}
    </p>
  );
}

function SidebarItem({
  label,
  count,
  tone = "neutral",
  active = false,
}: {
  label: string;
  count?: string;
  tone?: "neutral" | "teal" | "amber" | "green" | "blue";
  active?: boolean;
}) {
  const dotClass = {
    neutral: "bg-line-strong",
    teal: "bg-lime",
    amber: "bg-amber-400",
    green: "bg-emerald-400",
    blue: "bg-blue-400",
  }[tone];

  return (
    <div
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[9px] sm:text-[11px] ${
        active ? "bg-lime-faint text-ink" : "text-ink-soft"
      }`}
    >
      <span className={`h-2.5 w-2.5 rounded-[3px] ${dotClass}`} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count && (
        <span className="font-mono text-[7px] text-ink-faint sm:text-[8px]">
          {count}
        </span>
      )}
    </div>
  );
}

function ChapterHeader({
  number,
  label,
  title,
  subtitle,
}: {
  number: string;
  label: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-[86px_1fr] sm:gap-8">
      <p className="font-mono text-xs tracking-[0.1em] text-lime">
        {number}
        <span className="mt-1 block text-[9px] uppercase text-ink-faint">
          {label}
        </span>
      </p>
      <div>
        <h2 className="max-w-2xl font-display text-4xl font-semibold leading-[1.02] tracking-[-0.025em] sm:text-[2.75rem]">
          {title}
        </h2>
        <p className="mt-4 max-w-[58ch] text-[16px] leading-7 text-ink-soft">
          {subtitle}
        </p>
      </div>
    </div>
  );
}

function GenerationPromptPreview({ prompt }: { prompt: string }) {
  return (
    <div className="rounded-2xl border border-line-strong bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-center gap-2 border-b border-line pb-4 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">
        <WindowDots />
        <span className="ml-auto">workspace brief</span>
      </div>
      <blockquote className="px-2 pb-5 pt-6 font-display text-2xl italic leading-8 text-ink sm:text-3xl sm:leading-10">
        “{prompt}.”
      </blockquote>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-white/[0.03] p-2">
        <span className="min-w-0 flex-1 truncate px-2 text-sm text-ink-faint">
          Add a detail, or press Build…
        </span>
        <span className="rounded-lg bg-lime px-4 py-2.5 text-xs font-semibold text-lime-on">
          Build →
        </span>
      </div>
      <div className="mt-3 flex justify-between font-mono text-[9px]">
        <span className="text-ink-faint">generating…</span>
        <span className="text-lime">9.4s</span>
      </div>
    </div>
  );
}

function FeatureList({ features }: { features: Feature[] }) {
  return (
    <div className="mt-12 grid border-y border-line sm:grid-cols-2 lg:grid-cols-3">
      {features.map((feature, index) => (
        <div
          key={feature.title}
          className={`py-5 sm:px-5 ${
            index % 2 === 0 ? "sm:border-r sm:border-line" : ""
          } ${index % 3 !== 2 ? "lg:border-r lg:border-line" : ""} ${
            index < features.length - 2 ? "border-b border-line lg:border-b-0" : ""
          }`}
        >
          <p className="font-mono text-[9px] uppercase tracking-[0.11em] text-lime">
            {feature.k}
          </p>
          <h3 className="mt-2 text-sm font-semibold text-ink">
            {feature.title}
          </h3>
          <p className="mt-1.5 text-xs leading-5 text-ink-soft">
            {feature.body}
          </p>
        </div>
      ))}
    </div>
  );
}

function AssignmentsPreview({ preview }: { preview: Preview }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-card">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="font-display text-sm font-semibold">Assignments</span>
        <span className="ml-auto font-mono text-[8px] uppercase tracking-[0.08em] text-ink-faint">
          {preview.cards.length + 11} rows · table
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-[11px]">
          <thead>
            <tr className="bg-white/[0.015] font-mono text-[8px] uppercase tracking-[0.08em] text-ink-faint">
              <th className="border-b border-line px-4 py-3 font-medium">
                Assignment
              </th>
              <th className="border-b border-line px-3 py-3 font-medium">
                Course
              </th>
              <th className="border-b border-line px-3 py-3 font-medium">Due</th>
              <th className="border-b border-line px-3 py-3 font-medium">
                Weight
              </th>
              <th className="border-b border-line px-3 py-3 font-medium">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {assignmentRows.map((row) => (
              <tr key={row.title} className="transition hover:bg-hover">
                <td className="border-b border-line px-4 py-3 font-medium text-ink">
                  {row.title}
                </td>
                <td className="border-b border-line px-3 py-3 text-ink-soft">
                  {row.course}
                </td>
                <td className="border-b border-line px-3 py-3 text-ink-soft">
                  {row.due}
                </td>
                <td className="border-b border-line px-3 py-3 text-ink-soft">
                  {row.weight}
                </td>
                <td className="border-b border-line px-3 py-3">
                  <StatusTag tone={row.tone}>{row.status}</StatusTag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CalendarPreview() {
  const weekdays = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <div className="overflow-hidden rounded-xl border border-line-strong bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h3 className="font-display text-sm font-semibold">
          June <span className="font-normal text-ink-faint">2026</span>
        </h3>
        <span className="rounded-md border border-line bg-hover px-2 py-1 font-mono text-[8px] text-ink-soft">
          Month
        </span>
      </div>
      <div className="grid grid-cols-7">
        {weekdays.map((day, index) => (
          <span
            key={`${day}-${index}`}
            className="border-b border-line py-2 text-center font-mono text-[8px] text-ink-faint"
          >
            {day}
          </span>
        ))}
        {Array.from({ length: 21 }, (_, index) => index + 1).map((day) => {
          const event = calendarEvents[day];
          return (
            <div
              key={day}
              className={`relative min-h-16 border-b border-r border-line p-1.5 text-[9px] text-ink-soft [&:nth-child(7n)]:border-r-0 ${
                day === 9 ? "bg-lime-faint" : ""
              }`}
            >
              <span className={day === 9 ? "font-semibold text-lime" : ""}>
                {day}
              </span>
              {event && (
                <span
                  className={`absolute inset-x-1 bottom-1 truncate rounded border-l-2 px-1 py-0.5 text-[7px] ${eventClass(
                    event.tone,
                  )}`}
                >
                  {event.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-line-strong bg-surface shadow-pop">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
        <span
          className="pulse-dot h-2 w-2 rounded-full bg-lime shadow-[0_0_9px_var(--accent-glow)]"
          aria-hidden
        />
        agent · connected
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-sm bg-lime px-4 py-3 text-sm leading-5 text-lime-on">
          Add a midterm to CS next Friday and make it worth 30%.
        </div>
        <div className="max-w-[88%] rounded-2xl rounded-bl-sm border border-line bg-card px-4 py-3 text-sm leading-6 text-ink-soft">
          Added <strong className="font-semibold text-ink">Midterm Exam</strong>{" "}
          to <strong className="font-semibold text-ink">CS 101</strong> for next
          Friday, weighted at <strong className="font-semibold text-ink">30%</strong>.
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-white/[0.03] px-3 py-2.5 font-mono text-[9px] text-ink-soft">
          <span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
          Updating Assignments database · 1 row added
        </div>
      </div>
      <div className="m-4 mt-0 flex items-center gap-2 rounded-xl border border-line-strong bg-white/[0.03] px-3 py-2.5 text-xs text-ink-faint">
        Ask in plain English…
        <span className="ml-auto grid h-7 w-7 place-items-center rounded-lg bg-lime font-semibold text-lime-on">
          →
        </span>
      </div>
    </div>
  );
}

function StatsRow() {
  const stats = [
    { value: "9.4", unit: "s", label: "avg workspace build" },
    { value: "10", unit: "", label: "languages, including RTL" },
    { value: "3", unit: "", label: "views from one dataset" },
    { value: "$0", unit: "", label: "to start, no card" },
  ];

  return (
    <section className="border-b border-line px-5 py-8 sm:px-7">
      <div className="mx-auto grid max-w-6xl overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-surface px-5 py-6">
            <p className="font-display text-4xl font-bold tracking-[-0.025em]">
              {stat.value}
              {stat.unit && <span className="text-lime">{stat.unit}</span>}
            </p>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.09em] text-ink-faint">
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function WindowDots() {
  return (
    <span className="flex gap-1.5" aria-hidden>
      <span className="h-2 w-2 rounded-full bg-line-strong" />
      <span className="h-2 w-2 rounded-full bg-line-strong" />
      <span className="h-2 w-2 rounded-full bg-line-strong" />
    </span>
  );
}

function StatusTag({
  tone,
  children,
}: {
  tone: string;
  children: string;
}) {
  const toneClass = {
    teal: "bg-lime-faint text-lime ring-lime/30",
    amber: "bg-amber-400/15 text-amber-300 ring-amber-400/30",
    green: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30",
    neutral: "bg-white/[0.05] text-ink-soft ring-white/10",
  }[tone] ?? "bg-white/[0.05] text-ink-soft ring-white/10";

  return (
    <span
      className={`mt-1.5 inline-block rounded px-1.5 py-0.5 font-mono text-[7px] ring-1 ring-inset ${toneClass}`}
    >
      {children}
    </span>
  );
}

function eventClass(tone: "teal" | "amber" | "green") {
  return {
    teal: "border-lime bg-lime-faint text-lime",
    amber: "border-amber-400 bg-amber-400/15 text-amber-300",
    green: "border-emerald-400 bg-emerald-400/15 text-emerald-300",
  }[tone];
}

function splitLastWord(value: string): [string, string] {
  const normalized = value.trim();
  const lastSpace = normalized.lastIndexOf(" ");
  if (lastSpace === -1) return ["", normalized];
  return [normalized.slice(0, lastSpace), normalized.slice(lastSpace + 1)];
}
