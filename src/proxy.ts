import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// The app + generator require a signed-in user; the landing and auth pages
// are public, and so are shared pages (/s/<token>, the link is the
// credential). Those still run through Clerk, so their "Save a copy" action
// knows who is signed in. Invite links (/r/<code>) are public too: the friend
// opening one has no account yet (the route sends a signed-in visitor on).
const isProtected = createRouteMatcher(["/app(.*)", "/generate(.*)"]);

/**
 * Where to send the visitor back to after signing in: the page they asked
 * for, at the address they used. Behind a reverse proxy (our own server, a
 * container) `req.url` carries the server's internal host, localhost:PORT,
 * so the path is put on the configured public address instead. Without one
 * (a preview deployment, tests) the request's own URL is used as before.
 */
export function returnBackUrl(
  req: { url: string; nextUrl: { pathname: string; search: string } },
  env: Record<string, string | undefined> = process.env,
): string {
  const base = (env.APP_URL ?? env.NEXT_PUBLIC_APP_URL)?.trim();
  if (!base) return req.url;
  try {
    return new URL(`${req.nextUrl.pathname}${req.nextUrl.search}`, base).toString();
  } catch {
    return req.url;
  }
}

/**
 * A signed-out visitor arriving at the generator WITH a prompt came from the
 * landing page's "describe your courses" form: almost always someone without
 * an account yet. They go to sign-up (which links to sign-in for the few who
 * have one) instead of a sign-in screen that reads as "this is not for you".
 */
export function isNewVisitorBuild(req: { nextUrl: { pathname: string; searchParams: URLSearchParams } }): boolean {
  const path = req.nextUrl.pathname.replace(/[/]+$/, "");
  return path === "/generate" && Boolean(req.nextUrl.searchParams.get("prompt")?.trim());
}

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) {
    const { userId, redirectToSignIn, redirectToSignUp } = await auth();
    // Explicitly redirect signed-out users to sign-in. (`auth.protect()` falls
    // back to a 404 on deployed domains instead of redirecting.)
    if (!userId) {
      const back = { returnBackUrl: returnBackUrl(req) };
      return isNewVisitorBuild(req) ? redirectToSignUp(back) : redirectToSignIn(back);
    }
  }
});

export const config = {
  // Skipped: files (anything with a dot), Next's own assets, the share
  // images (opengraph-image, twitter-image: public metadata routes, fetched by
  // link-preview crawlers, as the Next docs advise), and the email
  // unsubscribe link (/api/notifications/unsubscribe: mail apps post to it
  // signed out, its signed token is the credential, and it never asks who is
  // signed in). The security headers still apply there: they come from
  // next.config.ts, which runs before (and without) the proxy. The signed-in
  // areas never skip it, whatever a file there is called.
  matcher: [
    "/((?!.*\\..*|_next|api/notifications/unsubscribe(?:/|$)|(?:(?!app/|generate/).*/)?(?:opengraph|twitter)-image(?:-[0-9a-z]+)?$).*)",
    "/",
    "/(api(?!/notifications/unsubscribe(?:/|$))|trpc)(.*)",
  ],
};
