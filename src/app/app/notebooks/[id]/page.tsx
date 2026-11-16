import type { Metadata, Viewport } from "next";
import { NotebookEditor } from "@/components/notebooks/NotebookEditor";
import { listWorkspaces } from "@/lib/workspace/store";
import { getI18n } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/interpolate";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: fmt(dict.meta.workspaceTitle, { name: dict.notebooks.metaTitle }) };
}

/**
 * The writing surface pans and zooms itself; the browser must not zoom the
 * page (a pinch would scale the toolbar too), and on iPad the canvas runs
 * edge to edge under the home indicator (safe-area insets pad the chrome).
 */
export const viewport: Viewport = {
  themeColor: "#0b0b0a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

/**
 * One notebook. The notebook loads in the browser (local copy first, then
 * the server's: see components/notebooks/sync), so it opens fast and keeps
 * working when the connection drops while it is open. (Opening it with no
 * connection at all is not possible: the service worker caches no pages.)
 * `?page=<pageId>` (search results) scrolls to that page.
 */
export default async function NotebookPage({ params, searchParams }: Props) {
  const [{ id }, sp, workspaces] = await Promise.all([params, searchParams, listWorkspaces()]);
  return (
    <NotebookEditor
      notebookId={id}
      initialPageId={typeof sp.page === "string" ? sp.page : null}
      courses={workspaces.map((w) => ({ id: w.id, name: w.name, icon: w.icon }))}
    />
  );
}
