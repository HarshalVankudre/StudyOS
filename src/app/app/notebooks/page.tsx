import type { Metadata } from "next";
import { NotebookLibrary } from "@/components/notebooks/NotebookLibrary";
import { listWorkspaces } from "@/lib/workspace/store";
import { getI18n } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/interpolate";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: fmt(dict.meta.workspaceTitle, { name: dict.notebooks.metaTitle }) };
}

/** The notebook library. The list itself loads in the browser (GET /api/notebooks). */
export default async function NotebooksPage() {
  const workspaces = await listWorkspaces();
  return <NotebookLibrary courses={workspaces.map((w) => ({ id: w.id, name: w.name, icon: w.icon }))} />;
}
