import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// The app + generator require a signed-in user; the landing and auth pages are public.
const isProtected = createRouteMatcher(["/app(.*)", "/generate(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
