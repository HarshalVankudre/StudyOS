import type { Metadata } from "next";
import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { HelpLayout } from "@/components/help/HelpLayout";
import { NoticeFlow } from "@/components/contract-notices/NoticeFlow";
import { NOTICE_PATHS, type NoticeKind } from "@/lib/contract-notices/config";
import { EMPTY_VALUES, type NoticeValues } from "@/lib/contract-notices/form";
import { contractOptions, type ContractOption } from "@/lib/contract-notices/store";
import { getI18n } from "@/lib/i18n/server";
import { operatorDetails } from "@/lib/legal/operator";
import { reportError } from "@/lib/ops/report-error";
import { supportEmail } from "@/lib/site";

/**
 * /withdraw and /cancel: the statutory online functions (lib/contract-notices).
 * Public on purpose (no sign-in), always rendered, even with billing off;
 * served by the app deployment, which has the database (lib/ops/site-split.ts).
 * Signed in, the name, email address and the sender's own contracts are
 * filled in; nothing here may fail the page: the form renders without them.
 */
export async function noticeMetadata(kind: NoticeKind): Promise<Metadata> {
  const { dict } = await getI18n();
  const K = kind === "withdrawal" ? dict.contractNotices.withdraw : dict.contractNotices.cancel;
  return {
    title: `${K.title} · StudyOS`,
    description: K.metaDescription,
    alternates: { canonical: NOTICE_PATHS[kind] },
    robots: { index: false },
  };
}

export async function NoticePage({ kind }: { kind: NoticeKind }) {
  const { dict, locale } = await getI18n();
  const M = dict.contractNotices;
  const K = kind === "withdrawal" ? M.withdraw : M.cancel;
  const { userId } = await auth();
  const contactEmail = operatorDetails()?.email ?? supportEmail();

  const values: NoticeValues = { ...EMPTY_VALUES, contract: kind === "cancellation" ? "pro" : "" };
  if (userId) {
    const user = await currentUser().catch(() => null);
    values.name = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
    values.email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? "";
  }
  let contracts: ContractOption[];
  try {
    contracts = await contractOptions(kind, userId, M, locale);
  } catch (error) {
    // The database is unreachable: the generic choices, which need none.
    reportError(error, { source: "contract-notice", route: NOTICE_PATHS[kind], userId });
    contracts = await contractOptions(kind, null, M, locale);
  }

  const [before, after = ""] = K.alsoEmail.split("{email}");
  return (
    <HelpLayout dict={dict} signedIn={Boolean(userId)}>
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{K.title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-soft">{K.intro}</p>
        <p className="mt-3 leading-relaxed text-ink-soft">
          {before}
          <a href={`mailto:${contactEmail}`} className="break-all font-semibold text-ink underline underline-offset-4">
            {contactEmail}
          </a>
          {after}{" "}
          <Link href="/terms" className="font-semibold text-ink underline underline-offset-4">
            {M.termsLink}
          </Link>
        </p>
        <div className="mt-8">
          <NoticeFlow
            kind={kind}
            messages={M}
            initialValues={values}
            contracts={contracts}
            contactEmail={contactEmail}
            signedIn={Boolean(userId)}
          />
        </div>
      </div>
    </HelpLayout>
  );
}
