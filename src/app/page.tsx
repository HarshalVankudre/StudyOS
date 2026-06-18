import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
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

  return (
    <div className="bg-paper text-ink antialiased">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
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
            <a href="#pricing" className="transition-colors hover:text-ink">
              {L.nav.pricing}
            </a>
          </nav>
          <div className="flex items-center gap-2.5">
            <LanguageSwitcher compact />
            {userId ? (
              <>
                <Link
                  href="/app"
                  className="hidden rounded-lg border border-ink/15 px-3.5 py-1.5 text-sm font-medium text-ink transition hover:border-ink/40 sm:block"
                >
                  {L.nav.openApp}
                </Link>
                <UserButton />
              </>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className="hidden rounded-lg px-3.5 py-1.5 text-sm font-medium text-ink-soft transition hover:text-ink sm:block"
                >
                  {L.nav.signIn}
                </Link>
                <Link
                  href="/sign-up"
                  className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper shadow-sm transition hover:bg-ink/90"
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
        <section className="border-b border-ink/10">
          <div className="mx-auto grid max-w-6xl gap-14 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:py-28">
            <div className="flex flex-col justify-center">
              <p
                className="reveal flex items-center gap-2 text-sm font-medium text-ink-soft"
                style={{ animationDelay: "0s" }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
                {L.hero.badge}
              </p>
              <h1
                className="reveal mt-6 font-display text-[3.1rem] font-extrabold leading-[1.03] tracking-[-0.02em] sm:text-[4.5rem]"
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
                className="reveal mt-9 flex flex-wrap items-center gap-3"
                style={{ animationDelay: "0.21s" }}
              >
                <Link
                  href="/generate"
                  className="group inline-flex items-center gap-2 rounded-lg bg-ink px-6 py-3.5 text-sm font-semibold text-paper shadow-sm transition hover:bg-ink/90"
                >
                  {L.hero.ctaGenerate}
                  <span className="transition group-hover:translate-x-0.5">→</span>
                </Link>
                <Link
                  href="/app"
                  className="rounded-lg border border-ink/15 px-6 py-3.5 text-sm font-semibold text-ink transition hover:border-ink/40 hover:bg-white"
                >
                  {L.hero.ctaDemo}
                </Link>
              </div>
              <p
                className="reveal mt-6 text-sm text-ink-soft/80"
                style={{ animationDelay: "0.27s" }}
              >
                {L.hero.finePrint}
              </p>
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
        <section className="border-b border-ink/10">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-6 py-5 text-sm text-ink-soft">
            <span className="text-ink-soft/60">{L.builtFor.label}</span>
            {L.builtFor.items.map((n, i) => (
              <span key={n} className="flex items-center gap-3">
                {i > 0 && <span className="text-ink-soft/30">·</span>}
                <span>{n}</span>
              </span>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-b border-ink/10">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="max-w-md font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {L.how.title}
            </h2>
            <p className="mt-3 max-w-md text-ink-soft">{L.how.subtitle}</p>
            <div className="mt-12 grid overflow-hidden rounded-xl border border-ink/10 sm:grid-cols-3 sm:divide-x sm:divide-ink/10">
              {steps.map((s, i) => (
                <div
                  key={s.title}
                  className="border-b border-ink/10 bg-white/40 p-7 last:border-b-0 sm:border-b-0"
                >
                  <span className="font-mono text-sm text-ink-soft">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-3 font-display text-xl font-bold">{s.title}</h3>
                  <p className="mt-2 leading-relaxed text-ink-soft">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-b border-ink/10">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="max-w-lg font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {L.features.title}
            </h2>
            <p className="mt-3 max-w-lg text-ink-soft">{L.features.subtitle}</p>
            <div className="mt-12 grid overflow-hidden rounded-xl border border-ink/10 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f, i) => (
                <div
                  key={f.title}
                  className={`group bg-white/40 p-7 transition hover:bg-white ${
                    i % 3 !== 2 ? "lg:border-r lg:border-ink/10" : ""
                  } ${i % 2 === 0 ? "sm:border-r sm:border-ink/10" : ""} ${
                    i < features.length - 1 ? "border-b border-ink/10" : ""
                  }`}
                >
                  <span className="font-mono text-xs uppercase tracking-wider text-ink-soft/70">
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

        {/* Pricing */}
        <section id="pricing" className="border-b border-ink/10">
          <div className="mx-auto max-w-5xl px-6 py-20">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {L.pricing.title}
            </h2>
            <p className="mt-3 text-ink-soft">{L.pricing.subtitle}</p>

            <div className="mt-10 grid gap-0 overflow-hidden rounded-xl border border-ink/10 sm:grid-cols-2 sm:divide-x sm:divide-ink/10">
              {/* Free */}
              <div className="flex flex-col bg-white/40 p-8">
                <span className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
                  {L.pricing.free.name}
                </span>
                <div className="mt-3 font-display text-5xl font-extrabold">
                  {L.pricing.free.price}
                </div>
                <ul className="mt-6 space-y-2.5 text-sm text-ink-soft">
                  {L.pricing.free.features.map((feat) => (
                    <li key={feat}>{feat}</li>
                  ))}
                </ul>
                <Link
                  href="/sign-up"
                  className="mt-8 rounded-lg bg-ink px-5 py-3 text-center text-sm font-semibold text-paper transition hover:bg-ink/90"
                >
                  {L.pricing.free.cta}
                </Link>
              </div>

              {/* Pro */}
              <div className="relative flex flex-col bg-white p-8">
                <span className="absolute right-6 top-8 rounded-full border border-ink/15 px-2.5 py-0.5 text-[11px] font-semibold text-ink-soft">
                  {L.pricing.pro.badge}
                </span>
                <span className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
                  {L.pricing.pro.name}
                </span>
                <div className="mt-3 font-display text-5xl font-extrabold">
                  {L.pricing.pro.price}
                  <span className="text-lg font-bold text-ink-soft">
                    {L.pricing.perMonth}
                  </span>
                </div>
                <ul className="mt-6 space-y-2.5 text-sm text-ink-soft">
                  {L.pricing.pro.features.map((feat) => (
                    <li key={feat}>{feat}</li>
                  ))}
                </ul>
                <Link
                  href="/sign-up"
                  className="mt-8 rounded-lg border border-ink px-5 py-3 text-center text-sm font-semibold text-ink transition hover:bg-ink hover:text-paper"
                >
                  {L.pricing.pro.cta}
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Closing CTA — the one dark moment */}
        <section className="bg-ink text-paper">
          <div className="mx-auto max-w-4xl px-6 py-24 text-center">
            <h2 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
              {L.closing.titleLine1}
              <br />
              {L.closing.titleLine2}
            </h2>
            <p className="mx-auto mt-5 max-w-md text-paper/60">
              {L.closing.subtitle}
            </p>
            <Link
              href="/generate"
              className="mt-10 inline-flex items-center gap-2 rounded-lg bg-paper px-8 py-4 text-sm font-bold text-ink transition hover:bg-white"
            >
              {L.closing.cta}
              <span aria-hidden>→</span>
            </Link>
          </div>
        </section>
      </main>

      <footer>
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 sm:flex-row">
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
      cls: "bg-ink/5 text-ink-soft",
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
      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white shadow-[0_24px_60px_-28px_rgba(26,23,18,0.35)]">
        <div className="flex items-center gap-2 border-b border-ink/10 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-ink/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-ink/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-ink/10" />
          <span className="ml-2 font-display text-sm font-bold text-ink">
            {preview.name}
          </span>
        </div>
        <div className="p-5">
          <p className="mb-2.5 text-xs font-medium uppercase tracking-wide text-ink-soft">
            {preview.thisWeek}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {board.map((col) => (
              <div key={col.label}>
                <span
                  className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-medium ${col.cls}`}
                >
                  {col.label}
                </span>
                {col.cards.map(([title, course]) => (
                  <div
                    key={title}
                    className="mt-2 rounded-lg border border-ink/10 bg-white p-2.5 shadow-sm"
                  >
                    <div className="text-[11px] font-medium leading-tight text-ink">
                      {title}
                    </div>
                    <span className="mt-1.5 inline-block text-[10px] text-ink-soft">
                      {course}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="mb-2.5 mt-5 text-xs font-medium uppercase tracking-wide text-ink-soft">
            {preview.coursesLabel}
          </p>
          <div className="divide-y divide-ink/10 overflow-hidden rounded-lg border border-ink/10">
            {courses.map(([c, code]) => (
              <div
                key={code}
                className="flex items-center justify-between bg-white px-3 py-2 text-[11px]"
              >
                <span className="text-ink">{c}</span>
                <span className="text-[10px] text-ink-soft">{code}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
