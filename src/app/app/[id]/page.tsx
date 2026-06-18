import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkspaceEditor } from "@/components/workspace/WorkspaceEditor";
import { getWorkspace } from "@/lib/workspace/store";
import { getI18n } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/interpolate";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const ws = await getWorkspace(id);
  const { dict } = await getI18n();
  return {
    title: ws
      ? fmt(dict.meta.workspaceTitle, { name: ws.name })
      : dict.meta.brandFallback,
  };
}

export default async function WorkspacePage({ params }: Props) {
  const { id } = await params;
  const ws = await getWorkspace(id);
  if (!ws) notFound();
  return <WorkspaceEditor id={id} initialWorkspace={ws} />;
}
