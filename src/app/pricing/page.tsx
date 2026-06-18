import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { isPro } from "@/lib/billing";
import { manageBillingAction, startCheckoutAction } from "@/app/app/billing-actions";

export const metadata: Metadata = {
  title: "Pricing · StudyOS",
  description:
    "Compare StudyOS Free and Pro. Start free and upgrade when you want the most capable model, unlimited generations, and priority support.",
};

type Cell = boolean | string;

const FREE_BULLETS = [
  "AI-generated study workspaces",
  "Full inline editing & autosave",
  "Databases — table, board & calendar",
  "AI agent chat in your workspace",
];

const PRO_BULLETS = [
  "Everything in Free",
  "Unlimited workspace generations",
  "The most capable, most detailed model",
  "Priority support & early access",
];

const COMPARISON: { feature: string; free: Cell; pro: Cell }[] = [
  { feature: "AI-generated workspaces", free: true, pro: true },
  { feature: "Guided onboarding questions", free: true, pro: true },
  { feature: "Full inline editing & autosave", free: true, pro: true },
  { feature: "Databases — table, board & calendar", free: true, pro: true },
  { feature: "Drag-and-drop editing", free: true, pro: true },
  { feature: "AI agent chat that edits your workspace", free: true, pro: true },
  { feature: "Generation model", free: "Standard", pro: "Most capable" },
  { feature: "Workspace generations", free: "Generous", pro: "Unlimited" },
  { feature: "Support", free: "Community", pro: "Priority" },
  { feature: "Early access to new features", free: false, pro: true },
];

const FAQ = [
  {
    q: "Is StudyOS really free to start?",
    a: "Yes. Create an account and generate, edit, and use your workspaces on the Free plan — no credit card required.",
  },
  {
    q: "What do I get with Pro?",
    a: "Unlimited generations, the most capable model for richer and more accurate workspaces, priority support, and early access to new features.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Anytime. Manage or cancel your subscription from the billing portal — you keep Pro until the end of the period.",
  },
  {
    q: "What happens to my workspaces if I downgrade?",
    a: "Nothing is deleted. Your workspaces stay exactly as they are and remain fully editable on Free.",
  },
];

export default async function PricingPage() {
  const { userId } = await auth();
  const signedIn = Boolean(userId);
  const pro = signedIn ? await isPro() : false;

  return (
    <div className="min-h-screen bg-paper text-ink antialiased">
      {/* Nav */}
      <header className="border-b border-ink/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 font-display text-lg font-extrabold tracking-tight"
          >
            StudyOS
            <span className="mb-2 h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
          </Link>
          <div className="flex items-center gap-3">
            {signedIn ? (
              <>
                <Link
                  href="/app"
                  className="text-sm text-ink-soft transition hover:text-ink"
                >
                  Open app
                </Link>
                <UserButton />
              </>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className="text-sm text-ink-soft transition hover:text-ink"
                >
                  Sign in
                </Link>
                <Link
                  href="/sign-up"
                  className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper shadow-sm transition hover:bg-ink/90"
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
        {/* Heading */}
        <div className="text-center">
          <p className="flex items-center justify-center gap-2 text-sm font-medium text-ink-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
            Simple, student-friendly pricing
          </p>
          <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
            Start free. Upgrade when you&rsquo;re ready.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-ink-soft">
            Everything you need to organize your semester is free. Pro adds the
            most capable model, unlimited generations, and priority support.
          </p>
        </div>

        {/* Plan cards */}
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {/* Free */}
          <div className="flex flex-col rounded-2xl border border-ink/10 bg-white/60 p-8">
            <span className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Free
            </span>
            <div className="mt-3 font-display text-5xl font-extrabold">$0</div>
            <p className="mt-1 text-sm text-ink-soft">Everything to get organized.</p>
            <ul className="mt-6 space-y-3 text-sm">
              {FREE_BULLETS.map((b) => (
                <Feature key={b}>{b}</Feature>
              ))}
            </ul>
            <div className="mt-8">
              {signedIn ? (
                <Link
                  href="/app"
                  className="block rounded-lg border border-ink/15 bg-white px-5 py-3 text-center text-sm font-semibold text-ink transition hover:border-ink/40"
                >
                  Open your workspaces
                </Link>
              ) : (
                <Link
                  href="/sign-up"
                  className="block rounded-lg bg-ink px-5 py-3 text-center text-sm font-semibold text-paper transition hover:bg-ink/90"
                >
                  Get started free
                </Link>
              )}
            </div>
          </div>

          {/* Pro */}
          <div className="relative flex flex-col rounded-2xl border-2 border-ink bg-white p-8 shadow-[0_24px_60px_-30px_rgba(26,23,18,0.45)]">
            <span className="absolute right-6 top-8 rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink">
              Most popular
            </span>
            <span className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Pro
            </span>
            <div className="mt-3 font-display text-5xl font-extrabold">
              $5
              <span className="text-lg font-bold text-ink-soft">/mo</span>
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              Billed monthly · cancel anytime.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {PRO_BULLETS.map((b) => (
                <Feature key={b} strong>
                  {b}
                </Feature>
              ))}
            </ul>
            <div className="mt-8">
              {pro ? (
                <div className="space-y-3">
                  <div className="rounded-lg bg-lime/15 px-4 py-3 text-center text-sm font-semibold text-ink ring-1 ring-inset ring-lime-deep/30">
                    ✦ Your current plan
                  </div>
                  <form action={manageBillingAction}>
                    <button
                      type="submit"
                      className="w-full rounded-lg border border-ink/15 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:border-ink/40"
                    >
                      Manage billing
                    </button>
                  </form>
                </div>
              ) : signedIn ? (
                <form action={startCheckoutAction}>
                  <button
                    type="submit"
                    className="w-full rounded-lg bg-ink px-5 py-3 text-sm font-semibold text-paper transition hover:bg-ink/90"
                  >
                    Upgrade to Pro
                  </button>
                </form>
              ) : (
                <Link
                  href="/sign-up"
                  className="block rounded-lg bg-ink px-5 py-3 text-center text-sm font-semibold text-paper transition hover:bg-ink/90"
                >
                  Get started with Pro
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Comparison table */}
        <section className="mt-20">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Compare plans
          </h2>
          <div className="mx-auto mt-8 max-w-3xl overflow-hidden rounded-2xl border border-ink/10 bg-white/60">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink/10 bg-white/60 text-left">
                  <th className="px-5 py-4 font-display text-base font-bold">
                    Features
                  </th>
                  <th className="w-28 px-3 py-4 text-center font-semibold text-ink-soft">
                    Free
                  </th>
                  <th className="w-28 px-3 py-4 text-center font-semibold text-ink">
                    Pro
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr
                    key={row.feature}
                    className={i % 2 === 1 ? "bg-white/40" : ""}
                  >
                    <td className="px-5 py-3.5 text-ink">{row.feature}</td>
                    <td className="px-3 py-3.5 text-center">
                      <Mark value={row.free} />
                    </td>
                    <td className="bg-lime/[0.06] px-3 py-3.5 text-center font-medium">
                      <Mark value={row.pro} strong />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* FAQ */}
        <section className="mt-20">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Questions
          </h2>
          <div className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
            {FAQ.map((item) => (
              <div
                key={item.q}
                className="rounded-xl border border-ink/10 bg-white/60 p-5"
              >
                <h3 className="font-display text-base font-bold text-ink">
                  {item.q}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="mt-20 rounded-2xl bg-ink px-6 py-14 text-center text-paper">
          <h2 className="font-display text-3xl font-extrabold tracking-tight">
            Your first workspace is one sentence away.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-paper/60">
            Try StudyOS free — upgrade only if you want more.
          </p>
          <Link
            href={signedIn ? "/generate" : "/sign-up"}
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-paper px-8 py-3.5 text-sm font-bold text-ink transition hover:bg-white"
          >
            {signedIn ? "Generate a workspace" : "Get started free"}
            <span aria-hidden>→</span>
          </Link>
        </section>
      </main>

      <footer>
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-8 sm:flex-row">
          <Link
            href="/"
            className="flex items-center gap-1.5 font-display font-bold text-ink"
          >
            StudyOS
            <span className="mb-2 h-1 w-1 rounded-full bg-lime" aria-hidden />
          </Link>
          <span className="text-sm text-ink-soft">
            The study workspace for students · © 2026
          </span>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  children,
  strong,
}: {
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] ${
          strong ? "bg-lime text-ink" : "bg-ink/10 text-ink"
        }`}
        aria-hidden
      >
        ✓
      </span>
      <span className="text-ink-soft">{children}</span>
    </li>
  );
}

function Mark({ value, strong }: { value: Cell; strong?: boolean }) {
  if (typeof value === "string") {
    return <span className={strong ? "text-ink" : "text-ink-soft"}>{value}</span>;
  }
  if (value) {
    return (
      <span
        className={`inline-grid h-5 w-5 place-items-center rounded-full text-xs ${
          strong ? "bg-lime text-ink" : "bg-ink/10 text-ink"
        }`}
        aria-label="Included"
      >
        ✓
      </span>
    );
  }
  return (
    <span className="text-ink-soft/40" aria-label="Not included">
      —
    </span>
  );
}
