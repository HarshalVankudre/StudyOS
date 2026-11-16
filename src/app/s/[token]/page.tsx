import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { after } from "next/server";
import { cache, type ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import { BrandMark } from "@/components/BrandMark";
import { PublicBlocks } from "@/components/share/PublicBlocks";
import { ReportShareButton } from "@/components/share/ReportShareButton";
import { SaveCopyCard } from "@/components/share/SaveCopyCard";
import { getI18n } from "@/lib/i18n/server";
import { clientRateLimitKey } from "@/lib/ops/client-ip";
import { reportError } from "@/lib/ops/report-error";
import { loadPublicShare, type PublicShare } from "@/lib/share/public-share";
import { recordShareView } from "@/lib/share/store";
import { allowSharePageView } from "@/lib/share/throttle";
import { ownOrigins } from "@/lib/site";

/**
 * A shared page (/s/<token>): one page of a student's workspace, read-only,
 * for anyone with the link (no sign-in). The link is checked on every
 * request, so turning sharing off, trashing the workspace or deleting the
 * page makes it a plain 404 at once; the computed view is reused only while
 * the workspace is unchanged (lib/share/public-share.ts). What a visitor may
 * see is decided in lib/share/public-view.ts. Throttled per address
 * (lib/share/throttle.ts): past the limit a short "too many requests" page.
 * Never indexed: student content is not for search engines.
 */
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ save?: string | string[] }>;
};

const ROBOTS: Metadata["robots"] = { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } };

type Loaded = { status: "ok"; shared: PublicShare } | { status: "throttled" } | { status: "not_found" };

// generateMetadata and the page share one throttle count and one load per request.
const load = cache(async (token: string): Promise<Loaded> => {
  if (!allowSharePageView(clientRateLimitKey(await headers()))) return { status: "throttled" };
  const shared = await loadPublicShare(token);
  return shared ? { status: "ok", shared } : { status: "not_found" };
});

/** The origin this request came in on (its links into the app are StudyOS's own too). */
function requestOrigin(h: Headers): string | null {
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0].trim();
  try {
    return new URL(`${proto}://${host.split(",")[0].trim()}`).origin;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const loaded = await load(token);
  if (loaded.status === "not_found") notFound();
  const { dict } = await getI18n();
  if (loaded.status === "throttled") {
    return { title: { absolute: `${dict.share.tooMany.title} · StudyOS` }, robots: ROBOTS };
  }
  const name = loaded.shared.view.title.trim() || dict.editor.untitled;
  const title = `${name} · StudyOS`;
  const description = dict.share.metaDescription;
  return {
    title: { absolute: title },
    description,
    robots: ROBOTS,
    openGraph: { title, description, type: "article", siteName: "StudyOS" },
    twitter: { card: "summary", title, description },
  };
}

export default async function SharedPage({ params, searchParams }: Props) {
  const { token } = await params;
  const loaded = await load(token);
  if (loaded.status === "not_found") notFound();

  const [{ userId }, { dict }, requestHeaders, query] = await Promise.all([
    auth(),
    getI18n(),
    headers(),
    searchParams,
  ]);
  const S = dict.share;
  const labels = { madeWith: S.madeWith, terms: dict.legal.terms, privacy: dict.legal.privacy };

  if (loaded.status === "throttled") {
    return (
      <SharedFrame labels={labels}>
        <main id="main-content" className="mx-auto w-full max-w-3xl flex-1 px-4 pb-12 pt-12 sm:px-6 sm:pt-16">
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink">{S.tooMany.title}</h1>
          <p className="mt-3 max-w-prose text-base text-ink-soft">{S.tooMany.body}</p>
        </main>
      </SharedFrame>
    );
  }

  const { shared } = loaded;
  const { view } = shared;

  // A hint for the sharer, after the page is sent; their own visits do not count.
  if (userId !== shared.share.userId) {
    const visitor = clientRateLimitKey(requestHeaders);
    after(() =>
      recordShareView(shared.share.id, visitor).catch((error) => reportError(error, { source: "share-view" })),
    );
  }

  const origins = [...new Set([...ownOrigins(), requestOrigin(requestHeaders)].filter((o): o is string => !!o))];
  const returning = query.save === "1";

  return (
    <SharedFrame labels={labels} report={<ReportShareButton token={shared.share.token} />}>
      <main id="main-content" className="mx-auto w-full max-w-3xl flex-1 px-4 pb-12 pt-8 sm:px-6 sm:pt-12">
        <article>
          <p className="text-xs text-ink-faint">{S.sharedNote}</p>
          <h1 dir="auto" className="mt-2 flex items-start gap-3 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            {view.icon && <span aria-hidden>{view.icon}</span>}
            <span className="min-w-0 break-words">{view.title.trim() || dict.editor.untitled}</span>
          </h1>
          <PublicBlocks blocks={view.blocks} token={shared.share.token} origins={origins} />
        </article>

        <div className="mt-12 flex flex-col gap-4">
          <SaveCopyCard token={shared.share.token} signedIn={Boolean(userId)} returning={returning} />
          {!userId && (
            <section className="rounded-3xl border border-line bg-cloud/70 p-5 sm:p-6">
              <h2 className="font-display text-xl font-bold text-ink">{S.cta.title}</h2>
              <p className="mt-1 text-sm text-ink-soft">{S.cta.body}</p>
              <Link
                href="/sign-up"
                className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ink px-6 text-sm font-semibold text-paper transition hover:bg-ink/90"
              >
                {S.cta.button}
                <span aria-hidden className="rtl:-scale-x-100">→</span>
              </Link>
            </section>
          )}
        </div>
      </main>
    </SharedFrame>
  );
}

/** The shared page's header and footer around its content. */
function SharedFrame({
  labels,
  report,
  children,
}: {
  labels: { madeWith: string; terms: string; privacy: string };
  report?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink antialiased">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex min-h-10 items-center gap-1.5 font-display text-lg font-extrabold tracking-tight">
            <BrandMark />
            StudyOS
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line-strong bg-card px-4 text-sm font-semibold text-ink transition hover:bg-hover"
          >
            {labels.madeWith}
            <span aria-hidden className="rtl:-scale-x-100">→</span>
          </Link>
        </div>
      </header>

      {children}

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-ink-faint sm:px-6">
          {report ?? <span />}
          <nav className="flex flex-wrap items-center gap-4">
            <Link href="/terms" className="transition hover:text-ink">
              {labels.terms}
            </Link>
            <Link href="/privacy" className="transition hover:text-ink">
              {labels.privacy}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
