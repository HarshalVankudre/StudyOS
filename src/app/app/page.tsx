import type { Metadata } from "next";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { grantProFromSession, isPro } from "@/lib/billing";
import { listWorkspaces } from "@/lib/workspace/store";
import { loadDemoAction } from "./actions";
import { manageBillingAction } from "./billing-actions";

export const metadata: Metadata = { title: "Your workspaces · StudyOS" };

export default async function AppHome({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; upgraded?: string }>;
}) {
  const sp = await searchParams;
  if (sp.session_id) await grantProFromSession(sp.session_id);

  const [pro, workspaces] = await Promise.all([isPro(), listWorkspaces()]);

  return (
    <main className="min-h-screen bg-paper text-ink antialiased">
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
            {pro ? (
              <>
                <span className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-paper">
                  Pro
                </span>
                <form action={manageBillingAction}>
                  <button
                    type="submit"
                    className="text-sm text-ink-soft transition hover:text-ink"
                  >
                    Manage
                  </button>
                </form>
              </>
            ) : (
              <Link
                href="/pricing"
                className="rounded-lg border border-ink/15 px-3.5 py-1.5 text-sm font-semibold text-ink transition hover:border-ink/40 hover:bg-white"
              >
                Upgrade to Pro
              </Link>
            )}
            <Link
              href="/generate"
              className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper shadow-sm transition hover:bg-ink/90"
            >
              Generate
            </Link>
            <UserButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-12">
        {sp.upgraded === "1" && pro && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-ink/15 bg-lime/10 px-4 py-3 text-sm font-medium text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />
            You&rsquo;re on Pro — your workspaces now use the smarter model.
          </div>
        )}

        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              Your workspaces
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              Everything StudyOS has built for you.
            </p>
          </div>
          <span className="hidden text-sm text-ink-soft sm:block">
            {workspaces.length} total
          </span>
        </div>

        {workspaces.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink/20 bg-white/50 p-12 text-center">
            <p className="text-lg font-medium text-ink">No workspaces yet</p>
            <p className="mt-1 text-sm text-ink-soft">
              Generate one, or load the demo to look around.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/generate"
                className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-paper shadow-sm transition hover:bg-ink/90"
              >
                Generate a workspace
              </Link>
              <form action={loadDemoAction}>
                <button
                  type="submit"
                  className="rounded-lg border border-ink/15 bg-white px-5 py-2.5 text-sm font-medium text-ink transition hover:border-ink/40"
                >
                  Load demo
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((w) => (
              <Link
                key={w.id}
                href={`/app/${w.id}`}
                className="group rounded-xl border border-ink/10 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-ink/25 hover:shadow-[0_16px_40px_-24px_rgba(26,23,18,0.4)]"
              >
                <div className="mb-3 text-3xl">{w.icon ?? "📄"}</div>
                <div className="font-display font-bold text-ink">{w.name}</div>
                <div className="mt-1 text-xs text-ink-soft">
                  updated {new Date(w.updatedAt).toLocaleDateString()}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
