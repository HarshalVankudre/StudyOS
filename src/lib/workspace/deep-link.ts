/**
 * Deep links into the workspace editor (shared contract).
 *
 *   /app/<workspaceId>?page=<pageId>
 *   /app/<workspaceId>?page=<pageId>&block=<blockId>
 *   /app/<workspaceId>?page=<pageId>&db=<databaseId>&row=<rowId>
 *
 * `page` opens a page; `block` scrolls a block on it into view and highlights
 * it; `db` + `row` opens that row's detail sheet in a view of the database on
 * the page. The editor keeps `page` in the URL as the student moves between
 * pages, so reload and Back behave. Unknown ids fall back gracefully: a
 * missing page opens the page that shows the database (for a row link) or
 * the workspace's home page.
 *
 * Pure (no React, no browser APIs) so the planner, search and the editor
 * share one implementation.
 */
import type { Workspace } from "./types";

export interface WorkspaceLinkTarget {
  workspaceId: string;
  pageId?: string;
  blockId?: string;
  databaseId?: string;
  rowId?: string;
}

/** The URL for a target. A block wins over a row when both are given. */
export function workspaceHref(target: WorkspaceLinkTarget): string {
  const base = `/app/${encodeURIComponent(target.workspaceId)}`;
  const params = new URLSearchParams();
  if (target.pageId) params.set("page", target.pageId);
  if (target.blockId) {
    params.set("block", target.blockId);
  } else if (target.databaseId && target.rowId) {
    params.set("db", target.databaseId);
    params.set("row", target.rowId);
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** The raw deep-link parameters of a URL query (absent ones are omitted). */
export interface DeepLinkParams {
  page?: string;
  block?: string;
  db?: string;
  row?: string;
}

interface ParamSource {
  get(name: string): string | null;
}

const MAX_ID = 200;

function clean(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= MAX_ID ? trimmed : undefined;
}

export function readDeepLinkParams(source: ParamSource | null | undefined): DeepLinkParams {
  if (!source) return {};
  const out: DeepLinkParams = {};
  const page = clean(source.get("page"));
  const block = clean(source.get("block"));
  const db = clean(source.get("db"));
  const row = clean(source.get("row"));
  if (page) out.page = page;
  if (block) out.block = block;
  if (db && row) {
    out.db = db;
    out.row = row;
  }
  return out;
}

/** What the editor should show for a set of parameters. */
export interface ResolvedDeepLink {
  /** The page to open (always a page of the workspace, when it has any). */
  pageId: string | undefined;
  /** True when `page` named a page that exists. */
  pageFound: boolean;
  /** Something on that page to bring into view, if it exists there. */
  focus:
    | { kind: "block"; blockId: string }
    | { kind: "row"; databaseId: string; rowId: string }
    | null;
}

/** The first page that embeds a view of `databaseId` (home page first). */
export function pageForDatabase(workspace: Workspace, databaseId: string): string | undefined {
  const embeds = (pageId: string | undefined) =>
    workspace.pages.some(
      (p) =>
        p.id === pageId &&
        p.blocks.some((b) => b.type === "database_view" && b.databaseId === databaseId),
    );
  if (embeds(workspace.homePageId)) return workspace.homePageId;
  return workspace.pages.find((p) => embeds(p.id))?.id;
}

/** The page holding block `blockId`, if any. */
export function pageForBlock(workspace: Workspace, blockId: string): string | undefined {
  return workspace.pages.find((p) => p.blocks.some((b) => b.id === blockId))?.id;
}

export function defaultPageId(workspace: Workspace): string | undefined {
  const home = workspace.pages.find((p) => p.id === workspace.homePageId);
  return (home ?? workspace.pages[0])?.id;
}

/**
 * Resolve link parameters against a workspace. A stale page id (the page was
 * deleted, or the link came from an older copy) still finds the block's or
 * the database's current page when it can.
 */
export function resolveDeepLink(workspace: Workspace, params: DeepLinkParams): ResolvedDeepLink {
  const named = params.page ? workspace.pages.find((p) => p.id === params.page) : undefined;
  let pageId = named?.id;

  if (params.block) {
    const blockId = params.block;
    const holds = (id: string | undefined) =>
      workspace.pages.some((p) => p.id === id && p.blocks.some((b) => b.id === blockId));
    if (!holds(pageId)) pageId = pageForBlock(workspace, blockId) ?? pageId;
    if (holds(pageId)) {
      return { pageId, pageFound: Boolean(named), focus: { kind: "block", blockId } };
    }
  } else if (params.db && params.row) {
    const database = workspace.databases.find((d) => d.id === params.db);
    const rowExists = Boolean(database?.rows.some((r) => r.id === params.row));
    const shows = (id: string | undefined) =>
      workspace.pages.some(
        (p) =>
          p.id === id &&
          p.blocks.some((b) => b.type === "database_view" && b.databaseId === params.db),
      );
    if (!shows(pageId)) pageId = pageForDatabase(workspace, params.db) ?? pageId;
    if (rowExists && shows(pageId)) {
      return {
        pageId,
        pageFound: Boolean(named),
        focus: { kind: "row", databaseId: params.db, rowId: params.row },
      };
    }
  }

  return { pageId: pageId ?? defaultPageId(workspace), pageFound: Boolean(named), focus: null };
}
