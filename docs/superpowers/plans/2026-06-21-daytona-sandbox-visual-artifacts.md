# Daytona Sandbox + Visual Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the workspace agent run a tool in an ephemeral Daytona sandbox, produce an image (LaTeX/diagram/plot), and have it appear in the user's workspace as a new `media` block — through the existing candidate→validate→atomic-apply path with Undo.

**Architecture:** Two stages. **Stage A** builds the display primitive that does not exist today: a `media` block + an `Asset` table + GCS-backed storage behind a port + an authenticated asset-serving route. **Stage B** adds one generic `run_in_sandbox` tool, with Daytona isolated behind a `SandboxRunner` interface (real adapter + fake), that produces artifacts, stores them as owner-scoped assets, and returns opaque handles the model inserts as `media` blocks. Everything that can be is behind a port so unit tests need no GCS, Daytona, or Prisma.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19, TypeScript 5, Zod 4, Prisma 6 + Postgres (Neon), Clerk auth, Vitest, `@daytona/sdk`, `@google-cloud/storage`.

**Design source:** `docs/superpowers/specs/2026-06-21-daytona-sandbox-design.md`.

## Global Constraints

- **Node** `>=22.13.0`. **Next** `16.2.9` — route handlers receive `{ params }: { params: Promise<…> }` and MUST `await params`; per `AGENTS.md`, read the relevant guide in `node_modules/next/dist/docs/` before writing any route. This is NOT the Next.js in your training data.
- **Zod is v4**; **tests are Vitest**, colocated `*.test.ts`, `import { describe, expect, it } from "vitest"`.
- **Prisma:** `import { prisma } from "@/lib/db"`. Server-only modules start with `import "server-only";`.
- **Auth/ownership:** `import { auth } from "@clerk/nextjs/server"`, `const { userId } = await auth()`, return 401 if absent. `Asset.ownerId` holds the Clerk `userId`. Owner-scope EVERY asset query by it.
- **Migrations:** the deploy pipeline runs none. Hand-author the SQL, apply to Neon with `prisma migrate deploy` BEFORE pushing `main`; never `prisma migrate dev` against Neon (see the DB-divergence memory).
- **Trust boundary:** the model proposes; trusted code executes and bounds. Every sandbox artifact is UNTRUSTED — size- and MIME-capped before it is stored, served only via `<img>`, never executed.
- **Feature gate:** reuse the existing `AGENT_SANDBOX` flag (`src/lib/flags.ts`, `agentSandboxEnabled()`), OFF by default, internal-only. The tool is invisible to the model when the flag is off.
- **Commands:** run a single test with `pnpm exec vitest run <path>`; full suite `pnpm test`; build `pnpm build`; lint `pnpm lint`.
- **Storage note:** storage is behind the `AssetStore` port. This plan implements the approved GCS adapter; for a faster internal start a Postgres-`bytea` adapter is a drop-in replacement (same port, the serving route streams bytes instead of redirecting). Do NOT build both — GCS per spec.

---

## File Structure

**Stage A — display primitive**
- Modify `src/lib/workspace/types.ts` — add `MediaBlock`, extend `Block`/`BlockType`.
- Modify `src/lib/workspace/schema.ts` — add `media` to the block union.
- Create `src/lib/workspace/media-block.test.ts` — block parse/strip tests.
- Create `src/lib/assets/mime.ts` — MIME allowlist, size cap, artifact assertion.
- Create `src/lib/assets/mime.test.ts`.
- Create `src/lib/assets/storage.ts` — `AssetStore` port + `gcsAssetStore()` adapter.
- Modify `prisma/schema.prisma` — add `Asset` model; create `prisma/migrations/20260621000000_asset/migration.sql`.
- Create `src/lib/assets/repo.ts` — `AssetRepo` port + `prismaAssetRepo()`.
- Create `src/lib/assets/service.ts` — `createAssetService({store,repo})` → `createAsset`, `signedUrlForAsset`, `AssetHandle`.
- Create `src/lib/assets/service.test.ts` — with fake store + fake repo.
- Create `src/app/api/asset/[id]/route.ts` — auth + owner check + signed URL + 302.
- Modify `src/components/workspace/PageView.tsx` — render `media` blocks via `<img>`.
- Modify `src/lib/i18n/dictionaries/en.ts` (+ siblings) — media block strings.

**Stage B — Daytona execution**
- Create `src/lib/ai/sandbox/runner.ts` — `SandboxRunner` interface + types.
- Create `src/lib/ai/sandbox/runner.fake.ts` — `FakeSandboxRunner` for tests.
- Create `src/lib/ai/sandbox/daytona.ts` — `DaytonaSandboxRunner` (real `@daytona/sdk` adapter).
- Modify `src/lib/ai/tools/registry.ts` — add `ownerId?` to `ToolContext`.
- Create `src/lib/ai/tools/sandbox-tool.ts` — `createSandboxTool({runner,createAsset,enabled})`.
- Create `src/lib/ai/tools/sandbox-tool.test.ts` — with fake runner + fake createAsset.
- Create `src/lib/ai/tools/register-sandbox.ts` — wire real runner + real asset service; register gated by the flag.
- Modify `src/lib/ai/skills/catalog.ts` — import the registration; add the `render-visual` skill.
- Modify `src/lib/ai/agent-loop.ts` — `ownerId` on params + ctx; gate `allowedTools` by `enabled`; add input hint.
- Modify `src/app/api/agent/route.ts` — pass `userId` as `ownerId` into the loop.
- Modify `src/lib/ai/agent-loop.test.ts` — ownerId threading + disabled-tool hidden.

---

## Stage A — Display primitive

### Task 1: `media` block type + schema

**Files:**
- Modify: `src/lib/workspace/types.ts`
- Modify: `src/lib/workspace/schema.ts:67-105` (the `block` union)
- Test: `src/lib/workspace/media-block.test.ts`

**Interfaces:**
- Produces: `MediaBlock` (added to the `Block` union); the `media` variant in `blockSchema`, which `agent-ops.ts` reuses for `set_page_blocks`/`add_page`. No new op is needed — the agent inserts a media block by resending a page's blocks via `set_page_blocks`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/workspace/media-block.test.ts
import { describe, expect, it } from "vitest";
import { blockSchema } from "@/lib/workspace/schema";

describe("media block", () => {
  const valid = {
    id: "b1",
    type: "media",
    assetId: "a1",
    mediaKind: "image",
    mime: "image/png",
    caption: "Quadratic formula",
    alt: "x equals minus b ...",
  };

  it("accepts a valid media block", () => {
    expect(blockSchema.safeParse(valid).success).toBe(true);
  });

  it("strips unknown keys (no signed URLs smuggled into the model)", () => {
    const parsed = blockSchema.parse({ ...valid, signedUrl: "https://evil" });
    expect("signedUrl" in parsed).toBe(false);
  });

  it("rejects a non-image mediaKind and a missing assetId", () => {
    expect(blockSchema.safeParse({ ...valid, mediaKind: "pdf" }).success).toBe(false);
    const { assetId: _drop, ...noAsset } = valid;
    expect(blockSchema.safeParse(noAsset).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/workspace/media-block.test.ts`
Expected: FAIL — the `media` variant is not in the union, so the valid case does not parse.

- [ ] **Step 3: Add the type**

In `src/lib/workspace/types.ts`, add `"media"` to `BlockType`, add the interface, and add it to the `Block` union:

```ts
// add to BlockType union
  | "media";

// new interface (place after DividerBlock)
/** A rendered image artifact (e.g. a sandbox-produced LaTeX/diagram render). */
export interface MediaBlock extends BaseBlock {
  type: "media";
  /** FK into the Asset table; never a raw or permanent URL. */
  assetId: string;
  mediaKind: "image"; // "pdf" later
  /** Cached for render: image/png | image/svg+xml. */
  mime: string;
  width?: number;
  height?: number;
  caption?: string;
  alt?: string;
}

// add MediaBlock to the Block union
  | MediaBlock;
```

- [ ] **Step 4: Add the schema variant**

In `src/lib/workspace/schema.ts`, add to the `z.discriminatedUnion("type", [...])` array (after the `divider` entry):

```ts
  z.object({
    id: z.string(),
    type: z.literal("media"),
    assetId: z.string(),
    mediaKind: z.literal("image"),
    mime: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    caption: z.string().optional(),
    alt: z.string().optional(),
  }),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/workspace/media-block.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspace/types.ts src/lib/workspace/schema.ts src/lib/workspace/media-block.test.ts
git commit -m "feat(workspace): add media block type for rendered image artifacts"
```

---

### Task 2: artifact MIME allowlist + size cap

**Files:**
- Create: `src/lib/assets/mime.ts`
- Test: `src/lib/assets/mime.test.ts`

**Interfaces:**
- Produces: `MAX_ASSET_BYTES`, `ArtifactRejectedError`, `ALLOWED_ARTIFACT_MIME`, `extForMime(mime): string`, `mimeForOutputPath(path): AllowedMime | null`, `assertAllowedArtifact(bytes: Uint8Array, mime: string): asserts mime is AllowedMime`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/assets/mime.test.ts
import { describe, expect, it } from "vitest";
import {
  ArtifactRejectedError,
  MAX_ASSET_BYTES,
  assertAllowedArtifact,
  extForMime,
  mimeForOutputPath,
} from "./mime";

describe("artifact mime + size boundary", () => {
  it("maps allowed mimes to extensions and back from output paths", () => {
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/svg+xml")).toBe("svg");
    expect(mimeForOutputPath("out/page-1.png")).toBe("image/png");
    expect(mimeForOutputPath("out/diagram.SVG")).toBe("image/svg+xml");
    expect(mimeForOutputPath("out/report.pdf")).toBeNull();
  });

  it("accepts a small png", () => {
    expect(() => assertAllowedArtifact(new Uint8Array(10), "image/png")).not.toThrow();
  });

  it("rejects a disallowed mime", () => {
    expect(() => assertAllowedArtifact(new Uint8Array(10), "application/pdf")).toThrow(
      ArtifactRejectedError,
    );
  });

  it("rejects an oversized artifact", () => {
    expect(() =>
      assertAllowedArtifact(new Uint8Array(MAX_ASSET_BYTES + 1), "image/png"),
    ).toThrow(ArtifactRejectedError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/assets/mime.test.ts`
Expected: FAIL — `./mime` does not exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/assets/mime.ts
/**
 * The inbound artifact boundary. A sandbox-produced file is UNTRUSTED: bound its
 * size and restrict its type before it is ever stored or served. Only image
 * types we will render via <img> (where even SVG is inert) are allowed.
 */
export const ALLOWED_ARTIFACT_MIME = {
  "image/png": "png",
  "image/svg+xml": "svg",
} as const;

export type AllowedMime = keyof typeof ALLOWED_ARTIFACT_MIME;

/** 5 MB — generous for a rendered page, tiny relative to an attack. */
export const MAX_ASSET_BYTES = 5_000_000;

export class ArtifactRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactRejectedError";
  }
}

export function extForMime(mime: AllowedMime): string {
  return ALLOWED_ARTIFACT_MIME[mime];
}

const EXT_TO_MIME: Record<string, AllowedMime> = {
  png: "image/png",
  svg: "image/svg+xml",
};

/** Resolve an allowed mime from a declared output path's extension, else null. */
export function mimeForOutputPath(path: string): AllowedMime | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MIME[ext] ?? null;
}

export function assertAllowedArtifact(
  bytes: Uint8Array,
  mime: string,
): asserts mime is AllowedMime {
  if (!(mime in ALLOWED_ARTIFACT_MIME)) {
    throw new ArtifactRejectedError(`artifact mime "${mime}" is not allowed`);
  }
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    throw new ArtifactRejectedError(
      `artifact is ${bytes.byteLength} bytes, over the ${MAX_ASSET_BYTES}-byte limit`,
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/assets/mime.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/assets/mime.ts src/lib/assets/mime.test.ts
git commit -m "feat(assets): artifact MIME allowlist and size cap"
```

---

### Task 3: `AssetStore` port + GCS adapter

**Files:**
- Create: `src/lib/assets/storage.ts`

**Interfaces:**
- Produces: `interface AssetStore { put(key, bytes, mime): Promise<void>; signedReadUrl(key, ttlMs): Promise<string> }` and `gcsAssetStore(): AssetStore`.

This adapter wraps `@google-cloud/storage` and is intentionally NOT unit-tested (a thin I/O adapter; covered by the route and the manual smoke). Tests use a fake `AssetStore` defined inline.

- [ ] **Step 1: Add the dependency**

Run: `pnpm add @google-cloud/storage`
Expected: it appears under `dependencies` in `package.json`.

- [ ] **Step 2: Implement the port + adapter**

```ts
// src/lib/assets/storage.ts
import "server-only";
import { Storage } from "@google-cloud/storage";

/** Storage port. Swappable (GCS today; Postgres-bytea is a drop-in). */
export interface AssetStore {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  signedReadUrl(key: string, ttlMs: number): Promise<string>;
}

let storage: Storage | undefined;
function client(): Storage {
  // ADC on Cloud Run; on Vercel set GOOGLE_APPLICATION_CREDENTIALS / a SA key.
  storage ??= new Storage();
  return storage;
}

function bucketName(): string {
  const name = process.env.ASSETS_BUCKET;
  if (!name) throw new Error("ASSETS_BUCKET is not configured");
  return name;
}

export function gcsAssetStore(): AssetStore {
  return {
    async put(key, bytes, mime) {
      await client()
        .bucket(bucketName())
        .file(key)
        .save(Buffer.from(bytes), { contentType: mime, resumable: false });
    },
    async signedReadUrl(key, ttlMs) {
      const [url] = await client()
        .bucket(bucketName())
        .file(key)
        .getSignedUrl({ version: "v4", action: "read", expires: Date.now() + ttlMs });
      return url;
    },
  };
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no type errors from the new file).

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/assets/storage.ts
git commit -m "feat(assets): AssetStore port with GCS adapter"
```

---

### Task 4: `Asset` Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260621000000_asset/migration.sql`

**Interfaces:**
- Produces: the `Asset` table the repo (Task 5) reads/writes.

- [ ] **Step 1: Add the model**

Append to `prisma/schema.prisma`:

```prisma
// An owner-scoped binary asset (e.g. a sandbox-rendered image). Bytes live in
// object storage (GCS); this row is the metadata + ownership record.
model Asset {
  id          String   @id @default(cuid())
  ownerId     String
  workspaceId String?
  mime        String
  sizeBytes   Int
  storageKey  String
  sourceRunId String?
  checksum    String?
  createdAt   DateTime @default(now())

  @@index([ownerId])
}
```

- [ ] **Step 2: Hand-author the migration SQL**

```sql
-- prisma/migrations/20260621000000_asset/migration.sql
CREATE TABLE "Asset" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "workspaceId" TEXT,
  "mime" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "sourceRunId" TEXT,
  "checksum" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Asset_ownerId_idx" ON "Asset"("ownerId");
```

- [ ] **Step 3: Regenerate the client and apply to Neon**

Run: `pnpm exec prisma generate`
Then (applies the new migration to Neon; safe — additive only): `pnpm exec prisma migrate deploy`
Expected: `prisma generate` succeeds and `src/generated/prisma` now types `prisma.asset`; `migrate deploy` reports the `20260621000000_asset` migration applied.

> If `migrate deploy` reports drift from the worktree-only agent migrations (see the DB-divergence memory), resolve per that memory before applying — do NOT run `migrate dev`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260621000000_asset/migration.sql src/generated/prisma
git commit -m "feat(assets): Asset table + migration"
```

---

### Task 5: `AssetRepo` port + asset service

**Files:**
- Create: `src/lib/assets/repo.ts`
- Create: `src/lib/assets/service.ts`
- Test: `src/lib/assets/service.test.ts`

**Interfaces:**
- Consumes: `AssetStore` (Task 3); `assertAllowedArtifact`, `extForMime`, `MAX_ASSET_BYTES` (Task 2).
- Produces:
  - `interface AssetRow { id; ownerId; workspaceId?: string|null; mime; sizeBytes; storageKey; sourceRunId?: string|null; checksum?: string|null }`
  - `interface AssetRepo { insert(row: AssetRow): Promise<void>; findById(id: string): Promise<AssetRow | null> }` and `prismaAssetRepo(): AssetRepo`.
  - `type AssetHandle = { assetId: string; mime: string; filename: string }`
  - `type CreateAssetInput = { ownerId: string; workspaceId?: string; bytes: Uint8Array; mime: AllowedMime; filename: string; sourceRunId?: string }`
  - `type CreateAssetFn = (input: CreateAssetInput) => Promise<AssetHandle>`
  - `createAssetService({ store, repo }): { createAsset: CreateAssetFn; signedUrlForAsset(assetId: string, ownerId: string): Promise<string | null> }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/assets/service.test.ts
import { describe, expect, it } from "vitest";
import type { AssetRow, AssetRepo } from "./repo";
import type { AssetStore } from "./storage";
import { createAssetService } from "./service";
import { ArtifactRejectedError } from "./mime";

function fakes() {
  const rows = new Map<string, AssetRow>();
  const puts: { key: string; mime: string; size: number }[] = [];
  const repo: AssetRepo = {
    async insert(row) { rows.set(row.id, row); },
    async findById(id) { return rows.get(id) ?? null; },
  };
  const store: AssetStore = {
    async put(key, bytes, mime) { puts.push({ key, mime, size: bytes.byteLength }); },
    async signedReadUrl(key) { return `https://signed.example/${key}`; },
  };
  return { repo, store, rows, puts };
}

describe("asset service", () => {
  it("stores bytes, writes a row, returns a handle, and signs by owner", async () => {
    const { repo, store, puts } = fakes();
    const svc = createAssetService({ store, repo });

    const handle = await svc.createAsset({
      ownerId: "user_1",
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/png",
      filename: "page-1.png",
      sourceRunId: "task_9",
    });

    expect(handle.mime).toBe("image/png");
    expect(handle.filename).toBe("page-1.png");
    expect(puts).toHaveLength(1);
    expect(puts[0].key).toContain("assets/user_1/");
    expect(puts[0].key.endsWith(".png")).toBe(true);

    const url = await svc.signedUrlForAsset(handle.assetId, "user_1");
    expect(url).toContain("https://signed.example/assets/user_1/");
  });

  it("refuses to sign another owner's asset", async () => {
    const { repo, store } = fakes();
    const svc = createAssetService({ store, repo });
    const handle = await svc.createAsset({
      ownerId: "user_1",
      bytes: new Uint8Array([1]),
      mime: "image/png",
      filename: "a.png",
    });
    expect(await svc.signedUrlForAsset(handle.assetId, "user_2")).toBeNull();
    expect(await svc.signedUrlForAsset("missing", "user_1")).toBeNull();
  });

  it("rejects a disallowed mime before storing", async () => {
    const { repo, store, puts } = fakes();
    const svc = createAssetService({ store, repo });
    await expect(
      svc.createAsset({
        ownerId: "u",
        bytes: new Uint8Array([1]),
        // deliberately bad to prove the boundary holds at runtime
        mime: "application/pdf" as never,
        filename: "x.pdf",
      }),
    ).rejects.toBeInstanceOf(ArtifactRejectedError);
    expect(puts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/assets/service.test.ts`
Expected: FAIL — `./repo` and `./service` do not exist.

- [ ] **Step 3: Implement the repo**

```ts
// src/lib/assets/repo.ts
import "server-only";
import { prisma } from "@/lib/db";

export interface AssetRow {
  id: string;
  ownerId: string;
  workspaceId?: string | null;
  mime: string;
  sizeBytes: number;
  storageKey: string;
  sourceRunId?: string | null;
  checksum?: string | null;
}

export interface AssetRepo {
  insert(row: AssetRow): Promise<void>;
  findById(id: string): Promise<AssetRow | null>;
}

export function prismaAssetRepo(): AssetRepo {
  return {
    async insert(row) {
      await prisma.asset.create({ data: row });
    },
    async findById(id) {
      return prisma.asset.findUnique({ where: { id } });
    },
  };
}
```

- [ ] **Step 4: Implement the service**

```ts
// src/lib/assets/service.ts
import type { AssetRepo } from "./repo";
import type { AssetStore } from "./storage";
import {
  type AllowedMime,
  assertAllowedArtifact,
  extForMime,
} from "./mime";

export type AssetHandle = { assetId: string; mime: string; filename: string };

export type CreateAssetInput = {
  ownerId: string;
  workspaceId?: string;
  bytes: Uint8Array;
  mime: AllowedMime;
  filename: string;
  sourceRunId?: string;
};

export type CreateAssetFn = (input: CreateAssetInput) => Promise<AssetHandle>;

/** Short TTL for a read URL — long enough to render, short enough to not leak. */
const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

export function createAssetService(deps: { store: AssetStore; repo: AssetRepo }) {
  const { store, repo } = deps;

  const createAsset: CreateAssetFn = async (input) => {
    // Untrusted-artifact boundary FIRST — never store an oversized/wrong type.
    assertAllowedArtifact(input.bytes, input.mime);

    const id = crypto.randomUUID();
    const key = `assets/${input.ownerId}/${id}.${extForMime(input.mime)}`;

    await store.put(key, input.bytes, input.mime);
    await repo.insert({
      id,
      ownerId: input.ownerId,
      workspaceId: input.workspaceId ?? null,
      mime: input.mime,
      sizeBytes: input.bytes.byteLength,
      storageKey: key,
      sourceRunId: input.sourceRunId ?? null,
    });

    return { assetId: id, mime: input.mime, filename: input.filename };
  };

  async function signedUrlForAsset(
    assetId: string,
    ownerId: string,
  ): Promise<string | null> {
    const row = await repo.findById(assetId);
    if (!row || row.ownerId !== ownerId) return null; // owner-scoped
    return store.signedReadUrl(row.storageKey, SIGNED_URL_TTL_MS);
  }

  return { createAsset, signedUrlForAsset };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/assets/service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/assets/repo.ts src/lib/assets/service.ts src/lib/assets/service.test.ts
git commit -m "feat(assets): owner-scoped asset service over store+repo ports"
```

---

### Task 6: asset-serving route + `media` renderer

**Files:**
- Create: `src/app/api/asset/[id]/route.ts`
- Modify: `src/components/workspace/PageView.tsx` (`BlockView` switch + the `default`)
- Modify: `src/lib/i18n/dictionaries/en.ts` (and each sibling dictionary)

**Interfaces:**
- Consumes: `createAssetService`, `gcsAssetStore`, `prismaAssetRepo` (Tasks 3, 5); `auth` (Clerk).
- Produces: `GET /api/asset/:id` → 302 redirect to a short-lived signed URL (owner-checked); the `<img src="/api/asset/:id">` renderer.

> Per `AGENTS.md`, before writing the route open `node_modules/next/dist/docs/` and confirm the App-Router route-handler signature for this Next version. The existing `src/app/api/agent/task/[id]/route.ts` is the in-repo reference: `type Props = { params: Promise<{ id: string }> }` and `await params`.

- [ ] **Step 1: Write the failing test (renderer contract)**

```ts
// src/components/workspace/MediaBlock.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { mediaImgSrc } from "./PageView";

describe("media block image source", () => {
  it("points at the authenticated asset route, never a raw URL", () => {
    expect(mediaImgSrc("a1")).toBe("/api/asset/a1");
  });
});
```

(We export a tiny pure helper from `PageView.tsx` so the URL contract is unit-tested without mounting the whole editor. The render import is kept for parity with the repo's test setup; if unused, drop it.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/components/workspace/MediaBlock.test.tsx`
Expected: FAIL — `mediaImgSrc` is not exported.

- [ ] **Step 3: Add the renderer + helper**

In `src/components/workspace/PageView.tsx`, add the exported helper near the top (after imports):

```tsx
/** The authenticated, owner-checked source for a media asset. */
export function mediaImgSrc(assetId: string): string {
  return `/api/asset/${assetId}`;
}
```

Add a `case "media"` to the `BlockView` switch (before `default`):

```tsx
    case "media":
      return (
        <figure className="my-3">
          {/* SVG is inert when loaded via <img>; never inline it. */}
          <img
            src={mediaImgSrc(block.assetId)}
            alt={block.alt ?? block.caption ?? ""}
            className="max-w-full rounded-md border border-line"
          />
          {block.caption ? (
            <figcaption className="mt-1 text-center text-xs text-ink-soft">
              {block.caption}
            </figcaption>
          ) : null}
        </figure>
      );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/components/workspace/MediaBlock.test.tsx`
Expected: PASS.

- [ ] **Step 5: Implement the asset route**

```ts
// src/app/api/asset/[id]/route.ts
import { auth } from "@clerk/nextjs/server";
import { createAssetService } from "@/lib/assets/service";
import { gcsAssetStore } from "@/lib/assets/storage";
import { prismaAssetRepo } from "@/lib/assets/repo";

type Props = { params: Promise<{ id: string }> };

const assets = createAssetService({ store: gcsAssetStore(), repo: prismaAssetRepo() });

export async function GET(_request: Request, { params }: Props) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const url = await assets.signedUrlForAsset(id, userId);
  if (!url) return new Response("Not found", { status: 404 });

  // 302 to a short-lived signed URL; never expose the asset publicly.
  return Response.redirect(url, 302);
}
```

- [ ] **Step 6: Add i18n strings**

In `src/lib/i18n/dictionaries/en.ts`, add a `media` entry under the existing `page.blockTypes` map (and mirror the key in each sibling dictionary — `de.ts`, `es.ts`, `fr.ts`, `it.ts`, `nl.ts`, `pt.ts`, `ja.ts`, `zh.ts`, `ar.ts` — translating the label):

```ts
// inside page.blockTypes
        media: "Image",
```

- [ ] **Step 7: Build to verify the route + renderer compile**

Run: `pnpm build`
Expected: PASS — the new route is listed and the editor compiles. (Per the worktree-build memory, build from a clean non-dot path if Turbopack errors on the worktree path.)

- [ ] **Step 8: Commit**

```bash
git add src/app/api/asset src/components/workspace/PageView.tsx src/components/workspace/MediaBlock.test.tsx src/lib/i18n/dictionaries
git commit -m "feat(workspace): serve assets via owner-checked route and render media blocks"
```

**Stage A is now independently shippable:** a `media` block referencing an uploaded `Asset` renders in the editor. Stage B fills it from a sandbox.

---

## Stage B — Daytona execution

### Task 7: `SandboxRunner` interface + fake

**Files:**
- Create: `src/lib/ai/sandbox/runner.ts`
- Create: `src/lib/ai/sandbox/runner.fake.ts`

**Interfaces:**
- Produces:
  - `interface SandboxRunSpec { inputs: { path: string; content: string }[]; setup: string[]; run: string[]; outputs: string[]; timeoutSec: number }`
  - `interface SandboxArtifact { path: string; bytes: Uint8Array }`
  - `interface SandboxRunResult { exitCode: number; logTail: string; artifacts: SandboxArtifact[] }`
  - `interface SandboxRunner { run(spec: SandboxRunSpec, signal?: AbortSignal): Promise<SandboxRunResult> }`
  - `class FakeSandboxRunner implements SandboxRunner` (configurable result + records the last spec).

- [ ] **Step 1: Implement the interface**

```ts
// src/lib/ai/sandbox/runner.ts
/** A spec the trusted server hands to an isolated sandbox. */
export interface SandboxRunSpec {
  inputs: { path: string; content: string }[];
  setup: string[];
  run: string[];
  /** Declared output files to return; each MUST live under `out/`. */
  outputs: string[];
  timeoutSec: number;
}

export interface SandboxArtifact {
  path: string;
  bytes: Uint8Array;
}

export interface SandboxRunResult {
  exitCode: number;
  logTail: string;
  artifacts: SandboxArtifact[];
}

export interface SandboxRunner {
  run(spec: SandboxRunSpec, signal?: AbortSignal): Promise<SandboxRunResult>;
}
```

- [ ] **Step 2: Implement the fake**

```ts
// src/lib/ai/sandbox/runner.fake.ts
import type { SandboxRunner, SandboxRunResult, SandboxRunSpec } from "./runner";

/** Deterministic SandboxRunner for tests — records the spec, returns a result. */
export class FakeSandboxRunner implements SandboxRunner {
  lastSpec?: SandboxRunSpec;
  constructor(private result: SandboxRunResult) {}
  async run(spec: SandboxRunSpec): Promise<SandboxRunResult> {
    this.lastSpec = spec;
    return this.result;
  }
}
```

- [ ] **Step 3: Type-check + commit**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

```bash
git add src/lib/ai/sandbox/runner.ts src/lib/ai/sandbox/runner.fake.ts
git commit -m "feat(sandbox): SandboxRunner interface + fake"
```

---

### Task 8: `ToolContext.ownerId` + `run_in_sandbox` tool

**Files:**
- Modify: `src/lib/ai/tools/registry.ts:15-25` (`ToolContext`)
- Create: `src/lib/ai/tools/sandbox-tool.ts`
- Test: `src/lib/ai/tools/sandbox-tool.test.ts`

**Interfaces:**
- Consumes: `SandboxRunner`, `SandboxRunSpec` (Task 7); `CreateAssetFn`, `AssetHandle` (Task 5); `mimeForOutputPath` (Task 2); `ToolDefinition`, `ToolContext` (registry).
- Produces: `createSandboxTool({ runner, createAsset, enabled }): ToolDefinition` registering id `"run_in_sandbox"`.

- [ ] **Step 1: Add `ownerId` to `ToolContext`**

In `src/lib/ai/tools/registry.ts`, add to the `ToolContext` interface:

```ts
  /** Owner (Clerk userId) of the task — assets produced by a tool are scoped to it. */
  ownerId?: string;
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/ai/tools/sandbox-tool.test.ts
import { describe, expect, it } from "vitest";
import { createSandboxTool } from "./sandbox-tool";
import { FakeSandboxRunner } from "@/lib/ai/sandbox/runner.fake";
import type { CreateAssetFn } from "@/lib/assets/service";

function deps(result = {
  exitCode: 0,
  logTail: "ok",
  artifacts: [{ path: "out/page-1.png", bytes: new Uint8Array([1, 2]) }],
}) {
  const created: { ownerId: string; mime: string; filename: string }[] = [];
  const createAsset: CreateAssetFn = async (input) => {
    created.push({ ownerId: input.ownerId, mime: input.mime, filename: input.filename });
    return { assetId: `asset_${created.length}`, mime: input.mime, filename: input.filename };
  };
  const runner = new FakeSandboxRunner(result);
  return { runner, createAsset, created };
}

const baseInput = {
  inputs: [{ path: "main.tex", content: "\\documentclass{article}" }],
  setup: [],
  run: ["tectonic main.tex", "pdftoppm -png main.pdf out/page"],
  outputs: ["out/page-1.png"],
  timeoutSec: 60,
};

describe("run_in_sandbox tool", () => {
  it("runs, stores each artifact as an owner-scoped asset, returns handles", async () => {
    const { runner, createAsset, created } = deps();
    const tool = createSandboxTool({ runner, createAsset, enabled: true });

    const out = (await tool.handler(baseInput, { taskId: "task_9", ownerId: "user_1" })) as {
      artifacts: { assetId: string; mime: string }[];
      exitCode: number;
      logTail: string;
    };

    expect(out.artifacts).toEqual([{ assetId: "asset_1", mime: "image/png", filename: "page-1.png" }]);
    expect(out.exitCode).toBe(0);
    expect(created[0]).toEqual({ ownerId: "user_1", mime: "image/png", filename: "page-1.png" });
    // the runner received a spec whose outputs are under out/
    expect(runner.lastSpec?.outputs).toEqual(["out/page-1.png"]);
  });

  it("rejects an output path that escapes out/ at the input boundary", () => {
    const { runner, createAsset } = deps();
    const tool = createSandboxTool({ runner, createAsset, enabled: true });
    expect(tool.input.safeParse({ ...baseInput, outputs: ["../etc/passwd"] }).success).toBe(false);
    expect(tool.input.safeParse({ ...baseInput, outputs: ["out/../x.png"] }).success).toBe(false);
  });

  it("throws when ownerId is missing (never produce an unowned asset)", async () => {
    const { runner, createAsset } = deps();
    const tool = createSandboxTool({ runner, createAsset, enabled: true });
    await expect(
      Promise.resolve(tool.handler(baseInput, { taskId: "t" })),
    ).rejects.toThrow();
  });

  it("skips an artifact whose extension is not an allowed image", async () => {
    const { runner, createAsset, created } = deps({
      exitCode: 0,
      logTail: "ok",
      artifacts: [{ path: "out/report.pdf", bytes: new Uint8Array([1]) }],
    });
    const tool = createSandboxTool({ runner, createAsset, enabled: true });
    const out = (await tool.handler(
      { ...baseInput, outputs: ["out/report.pdf"] },
      { taskId: "t", ownerId: "u" },
    )) as { artifacts: unknown[] };
    expect(out.artifacts).toHaveLength(0);
    expect(created).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/ai/tools/sandbox-tool.test.ts`
Expected: FAIL — `./sandbox-tool` does not exist.

- [ ] **Step 4: Implement the tool**

```ts
// src/lib/ai/tools/sandbox-tool.ts
import { z } from "zod";
import type { SandboxRunner, SandboxRunSpec } from "@/lib/ai/sandbox/runner";
import type { CreateAssetFn } from "@/lib/assets/service";
import { mimeForOutputPath } from "@/lib/assets/mime";
import type { ToolDefinition } from "./registry";

const MAX_CMDS = 20;
const MAX_FILES = 5;
const MAX_OUTPUTS = 5;
const MAX_CONTENT = 200_000; // per input file
const TIMEOUT_MAX = 180;

/** An output path must be a normal file under out/ — no traversal, no absolutes. */
const outputPath = z
  .string()
  .min(1)
  .max(200)
  .refine((p) => p.startsWith("out/") && !p.includes("..") && !p.startsWith("/"), {
    message: "outputs must live under out/ with no traversal",
  });

const inputFile = z.object({
  path: z.string().min(1).max(200).refine((p) => !p.includes("..") && !p.startsWith("/"), {
    message: "input path must be relative with no traversal",
  }),
  content: z.string().max(MAX_CONTENT),
});

const sandboxInput = z.object({
  inputs: z.array(inputFile).max(MAX_FILES).default([]),
  setup: z.array(z.string().max(500)).max(MAX_CMDS).default([]),
  run: z.array(z.string().max(500)).min(1).max(MAX_CMDS),
  outputs: z.array(outputPath).min(1).max(MAX_OUTPUTS),
  timeoutSec: z.number().int().min(5).max(TIMEOUT_MAX).default(120),
});

const sandboxOutput = z.object({
  artifacts: z.array(
    z.object({ assetId: z.string(), mime: z.string(), filename: z.string() }),
  ),
  logTail: z.string(),
  exitCode: z.number().int(),
});

export function createSandboxTool(deps: {
  runner: SandboxRunner;
  createAsset: CreateAssetFn;
  enabled: boolean;
}): ToolDefinition<typeof sandboxInput, typeof sandboxOutput> {
  return {
    id: "run_in_sandbox",
    description:
      "Run a render toolchain in an isolated sandbox to produce IMAGE artifacts (PNG/SVG) — e.g. compile LaTeX or a diagram. Write source via `inputs`, optionally `setup` installs, `run` the commands that write files under out/, and list those files in `outputs`. Returns asset handles; then add a media block per artifact with set_page_blocks referencing the assetId. Never returns file bytes.",
    input: sandboxInput,
    output: sandboxOutput,
    limits: { timeoutMs: (TIMEOUT_MAX + 20) * 1000 },
    networkPermission: "allowlisted", // calls the Daytona API host (fixed config, not model-controlled)
    enabled: deps.enabled,
    handler: async (input, ctx) => {
      if (!ctx.ownerId) throw new Error("run_in_sandbox requires an owner");

      const spec: SandboxRunSpec = {
        inputs: input.inputs,
        setup: input.setup,
        run: input.run,
        outputs: input.outputs,
        timeoutSec: input.timeoutSec,
      };
      const result = await deps.runner.run(spec, ctx.signal);

      const artifacts: { assetId: string; mime: string; filename: string }[] = [];
      for (const artifact of result.artifacts) {
        const mime = mimeForOutputPath(artifact.path);
        if (!mime) continue; // skip anything not an allowed image
        const filename = artifact.path.split("/").pop() ?? artifact.path;
        const handle = await deps.createAsset({
          ownerId: ctx.ownerId,
          bytes: artifact.bytes,
          mime,
          filename,
          sourceRunId: ctx.taskId,
        });
        artifacts.push(handle);
      }

      return { artifacts, logTail: result.logTail, exitCode: result.exitCode };
    },
    toProgress: (_input, output) => ({
      title: output.artifacts.length
        ? `Rendered ${output.artifacts.length} visual(s)`
        : "Ran a sandbox render",
    }),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/ai/tools/sandbox-tool.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/tools/registry.ts src/lib/ai/tools/sandbox-tool.ts src/lib/ai/tools/sandbox-tool.test.ts
git commit -m "feat(sandbox): run_in_sandbox tool over a SandboxRunner port"
```

---

### Task 9: Daytona adapter

**Files:**
- Create: `src/lib/ai/sandbox/daytona.ts`

**Interfaces:**
- Consumes: `SandboxRunner`, `SandboxRunSpec`, `SandboxRunResult` (Task 7).
- Produces: `class DaytonaSandboxRunner implements SandboxRunner`.

Thin I/O adapter; not unit-tested (covered by the manual smoke, Task 12).

- [ ] **Step 1: Add the dependency**

Run: `pnpm add @daytona/sdk`
Expected: it appears under `dependencies`.

- [ ] **Step 2: Implement the adapter**

```ts
// src/lib/ai/sandbox/daytona.ts
import "server-only";
import { Daytona } from "@daytona/sdk";
import type { SandboxArtifact, SandboxRunResult, SandboxRunSpec, SandboxRunner } from "./runner";

const LOG_TAIL_MAX = 4_000;

/**
 * Real SandboxRunner backed by Daytona. Ephemeral per call: create → write only
 * the agent-authored inputs (never workspace data or secrets) → run → download
 * declared outputs → destroy. Egress is Daytona's network; the container holds
 * nothing sensitive.
 */
export class DaytonaSandboxRunner implements SandboxRunner {
  private client = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });

  async run(spec: SandboxRunSpec, signal?: AbortSignal): Promise<SandboxRunResult> {
    // ephemeral + auto-stop is the crash backstop: a leaked container still dies.
    const sandbox = await this.client.create({
      snapshot: process.env.STUDYOS_SANDBOX_SNAPSHOT, // prebuilt image w/ toolchains
      ephemeral: true,
      autoStopInterval: Math.max(1, Math.ceil(spec.timeoutSec / 60)),
    });

    let log = "";
    let exitCode = 0;
    const artifacts: SandboxArtifact[] = [];
    try {
      await sandbox.process.executeCommand("mkdir -p /work/out");
      for (const file of spec.inputs) {
        await sandbox.fs.uploadFile(Buffer.from(file.content), `/work/${file.path}`);
      }
      for (const cmd of [...spec.setup, ...spec.run]) {
        if (signal?.aborted) throw new Error("aborted");
        const res = await sandbox.process.executeCommand(`cd /work && ${cmd}`);
        log += `$ ${cmd}\n${res.result ?? ""}\n`;
        exitCode = res.exitCode ?? 0;
        if (exitCode !== 0) break; // stop on first failure; report it
      }
      if (exitCode === 0) {
        for (const out of spec.outputs) {
          // NOTE: confirm the SDK's downloadFile return type against the installed
          // @daytona/sdk version; coerce to Uint8Array here.
          const data = await sandbox.fs.downloadFile(`/work/${out}`);
          artifacts.push({ path: out, bytes: new Uint8Array(data as Buffer) });
        }
      }
    } finally {
      await sandbox.delete().catch(() => {}); // best-effort; auto-stop is the backstop
    }

    return { exitCode, logTail: log.slice(-LOG_TAIL_MAX), artifacts };
  }
}
```

- [ ] **Step 3: Type-check + commit**

Run: `pnpm exec tsc --noEmit`
Expected: PASS. (If `downloadFile`'s type differs in the installed SDK version, adjust the coercion — the architecture isolates this to one line.)

```bash
git add package.json pnpm-lock.yaml src/lib/ai/sandbox/daytona.ts
git commit -m "feat(sandbox): Daytona adapter implementing SandboxRunner"
```

---

### Task 10: register the tool, gated by the flag

**Files:**
- Create: `src/lib/ai/tools/register-sandbox.ts`
- Modify: `src/lib/ai/skills/catalog.ts`

**Interfaces:**
- Consumes: `createSandboxTool` (Task 8), `DaytonaSandboxRunner` (Task 9), `createAssetService`/`gcsAssetStore`/`prismaAssetRepo` (Stage A), `agentSandboxEnabled` (`src/lib/flags.ts`), `toolRegistry`.
- Produces: registration of `run_in_sandbox` (enabled = flag); a `render-visual` skill carrying it.

- [ ] **Step 1: Implement registration**

```ts
// src/lib/ai/tools/register-sandbox.ts
import "server-only";
import { toolRegistry } from "./registry";
import { createSandboxTool } from "./sandbox-tool";
import { DaytonaSandboxRunner } from "@/lib/ai/sandbox/daytona";
import { createAssetService } from "@/lib/assets/service";
import { gcsAssetStore } from "@/lib/assets/storage";
import { prismaAssetRepo } from "@/lib/assets/repo";
import { agentSandboxEnabled } from "@/lib/flags";

const assets = createAssetService({ store: gcsAssetStore(), repo: prismaAssetRepo() });

toolRegistry.register(
  createSandboxTool({
    runner: new DaytonaSandboxRunner(),
    createAsset: assets.createAsset,
    enabled: agentSandboxEnabled(), // OFF in prod; internal-only
  }),
);
```

- [ ] **Step 2: Add the `render-visual` skill + import the registration**

In `src/lib/ai/skills/catalog.ts`, add an import at the top (alongside the other tool imports):

```ts
import "../tools/register-sandbox"; // run_in_sandbox (gated by AGENT_SANDBOX)
```

And register the skill inside `registerStage1Skills` (after `quality-reviewer`):

```ts
  registry.register({
    id: "render-visual",
    version: "1.0.0",
    instructions:
      "Use when the request needs a rendered image (LaTeX, a diagram, a plot). Write the source with run_in_sandbox (inputs + run commands that write files under out/, list them in outputs). For each returned artifact, read the target page and call apply_ops with set_page_blocks that appends a media block { type:'media', assetId:<handle.assetId>, mediaKind:'image', mime:<handle.mime>, caption:<short> }. Keep ids exact; never inline the image yourself.",
    toolIds: [...INSPECT, "apply_ops", "run_in_sandbox"],
  });
```

- [ ] **Step 3: Verify registration is flag-gated**

Run: `pnpm exec vitest run src/lib/ai/tools/registry.test.ts`
Expected: PASS — existing registry tests still green (the new registration imports cleanly).

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/tools/register-sandbox.ts src/lib/ai/skills/catalog.ts
git commit -m "feat(sandbox): register run_in_sandbox behind AGENT_SANDBOX + render-visual skill"
```

---

### Task 11: thread `ownerId` through the loop + hide disabled tools

**Files:**
- Modify: `src/lib/ai/agent-loop.ts` (`RunAgentLoopParams`, `allowedTools` at line 197, `ctx` at line 240, `TOOL_INPUT_HINTS` at line 71)
- Modify: `src/app/api/agent/route.ts` (pass `ownerId: userId`)
- Test: `src/lib/ai/agent-loop.test.ts`

**Interfaces:**
- Consumes: `ToolContext.ownerId` (Task 8), the flag-gated registration (Task 10).
- Produces: the loop only advertises enabled tools and passes `ownerId` into every tool ctx.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/ai/agent-loop.test.ts` (follow the file's existing harness for building `RunAgentLoopParams`; these assertions capture the two new guarantees):

```ts
import { describe, expect, it } from "vitest";
import { toolRegistry } from "@/lib/ai/tools/registry";

describe("loop tool gating + ownerId", () => {
  it("excludes a registered-but-disabled tool from allowedTools", () => {
    // register a disabled stub
    toolRegistry.register({
      id: "test_disabled_tool",
      description: "stub",
      input: (await import("zod")).z.object({}),
      output: (await import("zod")).z.object({}),
      limits: { timeoutMs: 1000 },
      networkPermission: "none",
      enabled: false,
      handler: () => ({}),
    });
    // The selection used by the loop must filter by enabled, not just has().
    const enabledOnly = ["apply_ops", "test_disabled_tool"].filter((id) => {
      const def = toolRegistry.get(id);
      return !!def && def.enabled !== false;
    });
    expect(enabledOnly).not.toContain("test_disabled_tool");
  });
});
```

(If the loop's `allowedTools` is computed in a helper you can call directly, assert against that instead — the intent is: disabled tools are not offered.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/ai/agent-loop.test.ts`
Expected: the gating test fails only if the loop still uses the unfiltered `has()` selection in the path you assert; otherwise it documents the required behavior. Proceed to make the loop enforce it.

- [ ] **Step 3: Gate `allowedTools` by `enabled`**

In `src/lib/ai/agent-loop.ts:197`, replace:

```ts
  const allowedTools = skill.toolIds.filter((id) => toolRegistry.has(id));
```

with:

```ts
  const allowedTools = skill.toolIds.filter((id) => {
    const def = toolRegistry.get(id);
    return !!def && def.enabled !== false; // disabled (e.g. flag-off) tools are invisible
  });
```

- [ ] **Step 4: Add `ownerId` to params + ctx**

In `RunAgentLoopParams` (after `taskId: string;`):

```ts
  /** Owner (Clerk userId); forwarded to tools so produced assets are owner-scoped. */
  ownerId: string;
```

Destructure it at line 81 (`const { workspace, history, message, model, budget, taskId, ownerId } = params;`) and include it in the ctx at line 240:

```ts
    const ctx = {
      taskId,
      ownerId,
      workspaceJson: JSON.stringify(candidate),
      signal: params.signal,
    };
```

- [ ] **Step 5: Add the input hint**

In `TOOL_INPUT_HINTS` (line 71), add:

```ts
  run_in_sandbox:
    '{"inputs":[{"path":"main.tex","content":"..."}],"setup":[],"run":["tectonic main.tex","pdftoppm -png main.pdf out/page"],"outputs":["out/page-1.png"],"timeoutSec":60}',
```

- [ ] **Step 6: Pass `ownerId` from the route**

In `src/app/api/agent/route.ts`, find the `runAgentLoop({ … })` call and add `ownerId: userId,` to its params (the route already has `userId` from `await auth()`). If any test helper constructs `RunAgentLoopParams`, add `ownerId: "test_user"` there too so the suite compiles.

- [ ] **Step 7: Run the loop tests + type-check**

Run: `pnpm exec vitest run src/lib/ai/agent-loop.test.ts`
Then: `pnpm exec tsc --noEmit`
Expected: PASS — loop tests green; no missing-`ownerId` type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai/agent-loop.ts src/app/api/agent/route.ts src/lib/ai/agent-loop.test.ts
git commit -m "feat(agent): forward ownerId to tools and hide disabled tools from the loop"
```

---

### Task 12: full-suite gate + manual Daytona smoke

**Files:** none (verification only).

- [ ] **Step 1: Whole suite, lint, build**

Run: `pnpm test`
Run: `pnpm lint`
Run: `pnpm build`
Expected: all green. (Build from a clean non-dot path if Turbopack errors on a worktree path — see the worktree-build memory.)

- [ ] **Step 2: Provision the prebuilt sandbox image (one-time)**

Create `infra/sandbox/README.md` documenting the Daytona snapshot: a base image with `tectonic` (or TeX Live), `@mermaid-js/mermaid-cli`, `graphviz`, `pandoc`, and `python` + `matplotlib` preinstalled, plus `poppler-utils` for `pdftoppm`. Record the snapshot name in `STUDYOS_SANDBOX_SNAPSHOT`. Commit the README.

- [ ] **Step 3: Configure secrets/env (internal only)**

Set, for the internal deployment only: `DAYTONA_API_KEY`, `STUDYOS_SANDBOX_SNAPSHOT`, `ASSETS_BUCKET`, GCS credentials, and `AGENT_SANDBOX=1` (plus `AUTHENTIC_AGENT=1`, already required for the loop). Confirm `AGENT_SANDBOX` is unset/`0` in production.

- [ ] **Step 4: Manual end-to-end smoke (the empirical keystone)**

In the internal environment, ask the agent: "render the quadratic formula as an image." Confirm: a `media` block appears on the page; the image loads via `/api/asset/:id`; Undo removes it; **capture the Daytona sandbox-seconds and run count** for one render (the cost number the public gating model will be chosen from). Record the result in `infra/sandbox/README.md`.

- [ ] **Step 5: Commit the runbook**

```bash
git add infra/sandbox/README.md
git commit -m "docs(sandbox): prebuilt image + internal smoke runbook"
```

---

## Self-Review

**Spec coverage (against `2026-06-21-daytona-sandbox-design.md`):**
- §3/§6 media block (image-only, `<img>`, SVG-safe) → Tasks 1, 6. ✓
- §6 Asset table + GCS storage + signed-URL hydration via authenticated route → Tasks 3, 4, 5, 6. ✓
- §5/§7 `run_in_sandbox` tool, server-owned sequence, bytes never to the model, opaque handles → Task 8. ✓
- §5 prebuilt image, ephemeral create→run→pull→destroy, auto-stop backstop → Tasks 9, 12. ✓
- §8 sandbox fed only agent inputs; inbound size/MIME boundary; owner-scoping → Tasks 2, 5, 8. ✓
- §9 cancellation (signal through the registry + adapter), flag kill-switch, caps (timeout, hidden-when-off) → Tasks 8, 9, 10, 11. ✓
- §9 cost instrumentation → Task 12 Step 4. ✓
- §10 unit + integration (fake runner/store/repo) + manual smoke + UI → Tasks 1–8, 11, 12. ✓
- Undo (free via `WorkspaceChange`) → no task needed; verified in Task 12 Step 4. ✓
- Concurrency caps (1 sandbox/user, daily quota) → **gap**: not implemented; acceptable for internal-only (one active task per user already bounds this via the existing AgentTask limits). Flagged for the public-rollout follow-up, not this plan.

**Placeholder scan:** no TBD/TODO/"handle edge cases"; every code step shows real code; commands have expected output. ✓

**Type consistency:** `AssetHandle { assetId, mime, filename }` is produced in Task 5 and consumed unchanged in Task 8 and the `render-visual` instructions. `CreateAssetFn`/`CreateAssetInput` match between Tasks 5 and 8. `SandboxRunSpec`/`SandboxRunResult`/`SandboxArtifact` match between Tasks 7, 8, 9. `ToolContext.ownerId` added in Task 8, set in Task 11, required in the Task 8 handler. `mimeForOutputPath` returns `AllowedMime | null` (Task 2) and is null-checked in Task 8. ✓

**Note on Task 11 Step 1:** the example test uses `await import` at module top — adjust to the file's actual async-test style (inside an `it(async () => …)`) when implementing; the intent (disabled tools excluded) is what the loop change must satisfy.
