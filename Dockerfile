# StudyOS — Cloud Run image (Next.js standalone output + Prisma)
# syntax=docker/dockerfile:1

FROM node:22-slim AS base
# openssl is required by the Prisma query engine at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Exact pnpm version (same pin as cloudbuild.yaml and .github/workflows/ci.yml).
RUN npm install -g pnpm@10.34.9
WORKDIR /app

# ---- dependencies (cached layer) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
# postinstall runs `prisma generate`, which needs the schema present.
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so they
# must be present here (not just at runtime). They are publishable/public keys.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL
ARG NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL
ARG NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
# Not a secret: next.config.ts scopes the CSP img-src to this bucket's path
# (headers are fixed at build time). Without it img-src allows the whole
# storage.googleapis.com host.
ARG ASSETS_BUCKET
ENV ASSETS_BUCKET=$ASSETS_BUCKET
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL \
    NEXT_PUBLIC_CLERK_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_URL \
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL \
    NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    NEXT_TELEMETRY_DISABLED=1
# `build` = prisma generate && next build (emits .next/standalone), then
# bundles the startup configuration check to .next/standalone/check-env.cjs.
RUN pnpm run build

# ---- runtime ----
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
# Standalone server + the static assets it does not bundle by default.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 8080
# Check the configuration BEFORE the server opens its port: with a required
# variable missing, check-env.cjs exits 1 and the server never listens, so the
# revision fails its startup probe instead of passing a TCP probe and then
# dying (src/instrumentation.ts runs only after "Ready"). `exec` makes node
# the main process so it receives Cloud Run's SIGTERM directly.
CMD ["sh", "-c", "node check-env.cjs && exec node server.js"]
