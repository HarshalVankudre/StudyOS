import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// The app + generator require a signed-in user; the landing and auth pages are public.
const isProtected = createRouteMatcher(["/app(.*)", "/generate(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) {
    const { userId, redirectToSignIn } = await auth();
    // Explicitly redirect signed-out users to sign-in. (`auth.protect()` falls
    // back to a 404 on deployed domains instead of redirecting.)
    if (!userId) return redirectToSignIn({ returnBackUrl: req.url });
  }
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
