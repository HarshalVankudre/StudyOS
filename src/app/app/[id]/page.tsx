import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkspaceEditor } from "@/components/workspace/WorkspaceEditor";
import { getWorkspace } from "@/lib/workspace/store";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const ws = await getWorkspace(id);
  return { title: ws ? `${ws.name} · StudyOS` : "StudyOS" };
}

export default async function WorkspacePage({ params }: Props) {
  const { id } = await params;
  const ws = await getWorkspace(id);
  if (!ws) notFound();
  return <WorkspaceEditor id={id} initialWorkspace={ws} />;
}
