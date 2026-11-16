/**
 * Rehype plugin for Markdown on a shared page (/s/<token>), run after the
 * app's own image restriction (lib/markdown-images.ts). A shared page is
 * written by one person and read by anyone, signed in or not, so:
 *
 *  - images: an uploaded image (/api/asset/<id>, owner-only) is loaded from
 *    the share's own asset route instead, which serves only the images this
 *    page uses; inline data: images stay; every other image (any other
 *    same-origin path the visitor's browser would request with their
 *    cookies) is replaced by its alt text;
 *  - links: a link inside StudyOS (a relative path; an /app or /api path on
 *    one of StudyOS's own origins, which the page passes in; anything not
 *    http(s)) becomes plain text, so other pages of the workspace are never
 *    linked; web links stay, other sites' /app and /api pages included,
 *    opening in a new tab without a referrer and marked as user content
 *    (nofollow ugc); in-page anchors (#...) stay. (A deep link with a
 *    workspace id is already "…" on any host: public-view.ts scrubPrivate.)
 *
 * Pure and deterministic, like rehypeRestrictImages: the origins come from
 * the server (lib/site.ts ownOrigins), so server and browser renders agree.
 */
import { shareAssetPath } from "./config";

// Minimal hast shapes (the hast types are not a direct dependency).
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export interface ShareScopeOptions {
  token: string;
  /** StudyOS's own origins ("https://studyos.app"): their /app and /api links become text. */
  origins?: readonly string[];
}

const ASSET_PATH = /^\/api\/asset\/([A-Za-z0-9_-]{1,128})$/;
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+[;,]/i;

/** The URL a shared page loads for an image `src`, or null when it must not load. */
export function shareImageSrc(raw: unknown, token: string): string | null {
  if (typeof raw !== "string") return null;
  const src = raw.trim();
  if (DATA_IMAGE.test(src)) return src;
  const asset = ASSET_PATH.exec(src);
  return asset ? shareAssetPath(token, asset[1]) : null;
}

const APP_PATH = /^\/(?:app|api)(?:\/|$)/i;

/**
 * "keep" a web link, "anchor" an in-page link, or "text" for a link into
 * StudyOS (relative, or an /app or /api path on one of `origins`) and
 * anything that is not http(s).
 */
export function shareLinkKind(raw: unknown, origins: readonly string[] = []): "keep" | "anchor" | "text" {
  if (typeof raw !== "string") return "text";
  const href = raw.trim();
  if (/^#[^\s]*$/.test(href)) return "anchor";
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    // Relative paths ("/app/...", "?page=...", "notes.md") have no protocol:
    // they point into StudyOS, at pages of the workspace.
    return "text";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "text";
  // A link to the app on its own host is a link to another page of the workspace.
  if (APP_PATH.test(url.pathname) && origins.includes(url.origin)) return "text";
  return "keep";
}

function scope(node: HastNode, token: string, origins: readonly string[]): void {
  const children = node.children;
  if (!children) return;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child.type !== "element") continue;
    const props = (child.properties ??= {});
    if (child.tagName === "img") {
      const safe = shareImageSrc(props.src, token);
      if (safe) {
        props.src = safe;
      } else {
        const alt = typeof props.alt === "string" ? props.alt : "";
        children[i] = { type: "text", value: alt };
      }
      continue;
    }
    if (child.tagName === "a") {
      const kind = shareLinkKind(props.href, origins);
      if (kind === "text") {
        // The link's text stays where it was, without the link.
        const inner = child.children ?? [];
        children.splice(i, 1, ...inner);
        i -= 1;
        continue;
      }
      if (kind === "keep") {
        props.rel = ["nofollow", "ugc", "noopener", "noreferrer"];
        props.target = "_blank";
      }
    } else if ("src" in props) {
      const safe = shareImageSrc(props.src, token);
      if (safe) props.src = safe;
      else delete props.src;
    }
    scope(child, token, origins);
  }
}

/** Rehype plugin: scope images and links of shared-page Markdown (see the header). */
export function rehypeShareScope(options: ShareScopeOptions) {
  const origins = (options.origins ?? []).map((origin) => origin.toLowerCase());
  return (tree: HastNode) => {
    scope(tree, options.token, origins);
  };
}
