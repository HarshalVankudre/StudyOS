import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { WorkspaceEditor } from "@/components/workspace/WorkspaceEditor";
import { getWorkspaceState } from "@/lib/workspace/store";
import { getCreditBalance } from "@/lib/credits";
import { messageQuote, studyKitPartQuote } from "@/lib/price-list";
import { isBillingConfigured } from "@/lib/stripe";
import { modelForPlan } from "@/lib/ai/plans";
import { getUserPlan } from "@/lib/billing";
import { getI18n } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/interpolate";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const state = await getWorkspaceState(id);
  const { dict } = await getI18n();
  return {
    title: state
      ? fmt(dict.meta.workspaceTitle, { name: state.workspace.name })
      : dict.meta.brandFallback,
  };
}

export default async function WorkspacePage({ params }: Props) {
  const { id } = await params;
  // Tolerant load: an imperfect stored document is repaired piece by piece,
  // so this is only null when the workspace is missing, trashed or not ours.
  const state = await getWorkspaceState(id);
  if (!state) notFound();
  const { userId } = await auth();
  const credits = userId ? await getCreditBalance(userId) : 0;
  // The study kit's and the assistant's costs are shown before a run, in the
  // browser, which cannot read the configured model: price them here for the
  // student's plan.
  const plan = await getUserPlan().catch(() => "free" as const);
  const model = modelForPlan(plan);
  return (
    <WorkspaceEditor
      id={id}
      initialWorkspace={state.workspace}
      initialVersion={state.version}
      initialCredits={credits}
      kitPartQuote={studyKitPartQuote(model)}
      agentQuote={messageQuote(model, plan)}
      billing={isBillingConfigured()}
    />
  );
}
