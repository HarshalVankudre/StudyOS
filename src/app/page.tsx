import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

export default async function Home() {
  const { userId } = await auth();
  const { dict } = await getI18n();
  const L = dict.landing;

  const steps = L.how.steps;
  const features = [
    L.features.items.generate,
    L.features.items.databases,
    L.features.items.calendar,
    L.features.items.dashboard,
    L.features.items.autosave,
    L.features.items.assistant,
  ];
  const promptExample = dict.generate.examples[1].text;

  return (
    <div className="bg-paper text-ink antialiased">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-line bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-7 py-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 font-display text-xl font-extrabold tracking-tight"
          >
            StudyOS
            <span className="mb-2.5 h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
          </Link>
          <nav className="hidden items-center gap-9 text-sm text-ink-soft md:flex">
            <a href="#how" className="transition-colors hover:text-ink">
              {L.nav.howItWorks}
            </a>
            <a href="#features" className="transition-colors hover:text-ink">
              {L.nav.features}
            </a>
            <Link href="/pricing" className="transition-colors hover:text-ink">
              {L.nav.pricing}
            </Link>
          </nav>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <LanguageSwitcher compact />
            {userId ? (
              <>
                <Link
                  href="/app"
                  className="hidden rounded-md border border-line-strong px-3.5 py-1.5 text-sm font-medium text-ink transition hover:bg-hover sm:block"
                >
                  {L.nav.openApp}
                </Link>
                <UserButton />
              </>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className="hidden rounded-md px-3 py-2 text-[13.5px] font-medium text-ink-soft transition hover:text-ink sm:block"
                >
                  {L.nav.signIn}
                </Link>
                <Link
                  href="/sign-up"
                  className="rounded-md bg-ink px-4 py-2 text-[13.5px] font-semibold text-paper shadow-card transition hover:opacity-90"
                >
                  {L.nav.getStarted}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="border-b border-line">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-7 py-20 lg:grid-cols-[1.04fr_0.96fr] lg:gap-14 lg:py-24">
            <div className="flex flex-col justify-center">
              <p
                className="reveal flex items-center gap-3 font-mono text-[11.5px] uppercase tracking-[0.16em] text-ink-faint"
                style={{ animationDelay: "0s" }}
              >
                <span className="h-px w-7 bg-line-strong" aria-hidden />
                {L.hero.badge}
              </p>
              <h1
                className="reveal mt-6 font-display text-[3.1rem] font-extrabold leading-[1.0] tracking-[-0.035em] text-balance sm:text-[4.6rem]"
                style={{ animationDelay: "0.07s" }}
              >
                {L.hero.titleLine1}
                <br />
                {L.hero.titleLine2}
              </h1>
              <p
                className="reveal mt-6 max-w-md text-lg leading-relaxed text-ink-soft"
                style={{ animationDelay: "0.14s" }}
              >
                {L.hero.subtitle}
              </p>
              <div
                className="reveal mt-8"
                style={{ animationDelay: "0.21s" }}
              >
                <Link
                  href="/generate"
                  className="group flex max-w-[480px] items-center gap-2.5 rounded-md border border-line-strong bg-card py-2 pl-4 pr-2 shadow-card transition hover:border-ink/30"
                >
                  <span className="font-mono text-xs text-ink-faint" aria-hidden>
                    ›
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">
                    {promptExample}
                  </span>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-paper transition group-hover:opacity-90">
                    {L.hero.ctaGenerate}
                    <span className="transition group-hover:translate-x-0.5" aria-hidden>
                      →
                    </span>
                  </span>
                </Link>
                <p className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-faint">
                  <span>{L.hero.finePrint}</span>
                  <Link
                    href="/app"
                    className="font-medium text-ink-soft underline-offset-4 transition hover:text-ink hover:underline"
                  >
                    {L.hero.ctaDemo}
                  </Link>
                </p>
              </div>
            </div>

            <div
              className="reveal flex items-center justify-center"
              style={{ animationDelay: "0.18s" }}
            >
              <WorkspacePreview preview={L.preview} />
            </div>
          </div>
        </section>

        {/* Built for */}
        <section className="border-b border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-7 py-5 text-[13.5px] text-ink-soft">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
              {L.builtFor.label}
            </span>
            {L.builtFor.items.map((n, i) => (
              <span key={n} className="flex items-center gap-3">
                {i > 0 && <span className="text-ink-faint">·</span>}
                <span>{n}</span>
              </span>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-b border-line">
          <div className="mx-auto max-w-6xl px-7 py-20 sm:py-24">
            <h2 className="max-w-md font-display text-3xl font-bold tracking-tight sm:text-[2.5rem]">
              {L.how.title}
            </h2>
            <p className="mt-3.5 max-w-md text-[17px] leading-relaxed text-ink-soft">
              {L.how.subtitle}
            </p>
            <div className="mt-12 grid overflow-hidden rounded-md border border-line sm:grid-cols-3 sm:divide-x sm:divide-line">
              {steps.map((s, i) => (
                <div
                  key={s.title}
                  className="border-b border-line bg-surface-2 p-8 last:border-b-0 sm:border-b-0"
                >
                  <span
                    className={`inline-block rounded-md px-2.5 py-1 font-mono text-[13px] font-semibold ${
                      i === 0
                        ? "bg-lime text-lime-on"
                        : "border border-line-strong text-ink-faint"
                    }`}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-4 font-display text-xl font-bold">{s.title}</h3>
                  <p className="mt-2.5 leading-relaxed text-ink-soft">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-b border-line">
          <div className="mx-auto max-w-6xl px-7 py-20 sm:py-24">
            <h2 className="max-w-lg font-display text-3xl font-bold tracking-tight sm:text-[2.5rem]">
              {L.features.title}
            </h2>
            <p className="mt-3.5 max-w-lg text-[17px] leading-relaxed text-ink-soft">
              {L.features.subtitle}
            </p>
            <div className="mt-12 grid overflow-hidden rounded-md border border-line sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f, i) => (
                <div
                  key={f.title}
                  className={`group bg-surface-2 p-7 transition hover:bg-hover ${
                    i % 3 !== 2 ? "lg:border-r lg:border-line" : ""
                  } ${i % 2 === 0 ? "sm:border-r sm:border-line" : ""} ${
                    i < features.length - 1 ? "border-b border-line" : ""
                  }`}
                >
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                    {f.k}
                  </span>
                  <h3 className="mt-3 font-display text-lg font-bold">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    {f.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA — the one dark moment */}
        <section className="bg-primary text-primary-foreground">
          <div className="mx-auto max-w-3xl px-7 py-24 text-center">
            <h2 className="font-display text-4xl font-extrabold tracking-tight sm:text-[3.25rem] sm:leading-[1.02]">
              {L.closing.titleLine1}
              <br />
              {L.closing.titleLine2}
            </h2>
            <p className="mx-auto mt-5 max-w-md text-[17px] text-primary-foreground/60">
              {L.closing.subtitle}
            </p>
            <Link
              href="/generate"
              className="mt-9 inline-flex items-center gap-2 rounded-md bg-lime px-8 py-4 text-sm font-bold text-lime-on transition hover:opacity-90"
            >
              {L.closing.cta}
              <span aria-hidden>→</span>
            </Link>
          </div>
        </section>
      </main>

      <footer>
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-7 py-8 sm:flex-row">
          <span className="flex items-center gap-1.5 font-display font-bold text-ink">
            StudyOS
            <span className="mb-2 h-1 w-1 rounded-full bg-lime" aria-hidden />
          </span>
          <span className="text-sm text-ink-soft">{L.footer.tagline}</span>
        </div>
      </footer>
    </div>
  );
}

function WorkspacePreview({
  preview,
}: {
  preview: Dictionary["landing"]["preview"];
}) {
  const board = [
    {
      label: preview.columns.todo,
      cls: "bg-hover text-ink-soft",
      cards: [[preview.cards[0], "MATH 201"]],
    },
    {
      label: preview.columns.doing,
      cls: "bg-amber-100 text-amber-800",
      cards: [[preview.cards[1], "CS 210"]],
    },
    {
      label: preview.columns.done,
      cls: "bg-emerald-100 text-emerald-800",
      cards: [[preview.cards[2], "PHYS 150"]],
    },
  ];
  const courses: [string, string][] = [
    [preview.courses[0], "CS 210"],
    [preview.courses[1], "MATH 201"],
    [preview.courses[2], "PHYS 150"],
  ];
  return (
    <figure className="w-full max-w-md">
      <div className="overflow-hidden rounded-md border border-line-strong bg-card shadow-pop">
        <div className="flex items-center gap-1.5 border-b border-line px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="ml-1.5 font-display text-sm font-bold text-ink">
            {preview.name}
          </span>
          <span className="ml-auto rounded-md border border-line px-2 py-0.5 font-mono text-[10.5px] text-ink-faint">
            9.4s
          </span>
        </div>
        <div className="p-[18px]">
          <p className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
            {preview.thisWeek}
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            {board.map((col) => (
              <div key={col.label}>
                <span
                  className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold ${col.cls}`}
                >
                  {col.label}
                </span>
                {col.cards.map(([title, course]) => (
                  <div
                    key={title}
                    className="mt-2 rounded-md border border-line bg-surface-2 p-2.5"
                  >
                    <div className="text-[11.5px] font-medium leading-tight text-ink">
                      {title}
                    </div>
                    <span className="mt-1.5 inline-block font-mono text-[9.5px] text-ink-faint">
                      {course}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="mb-3 mt-[18px] font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
            {preview.coursesLabel}
          </p>
          <div className="divide-y divide-line overflow-hidden rounded-md border border-line">
            {courses.map(([c, code]) => (
              <div
                key={code}
                className="flex items-center justify-between px-3 py-2.5 text-xs"
              >
                <span className="text-ink">{c}</span>
                <span className="font-mono text-[10px] text-ink-faint">{code}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
