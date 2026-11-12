// src/lib/ai/tools/register-sandbox.ts
import "server-only";
import { toolRegistry } from "./registry";
import { createSandboxTool } from "./sandbox-tool";
import { sandboxRunQuota } from "./sandbox-quota";
import { DaytonaSandboxRunner } from "@/lib/ai/sandbox/daytona";
import { createAssetService } from "@/lib/assets/service";
import { gcsAssetStore } from "@/lib/assets/storage";
import { prismaAssetRepo } from "@/lib/assets/repo";
import { agentSandboxEnabled } from "@/lib/flags";
import { remoteAssetImagesAvailable } from "@/lib/ops/env";

// All imports are static (ES2017 target forbids top-level await).
// Construction of the Daytona client and asset service is guarded behind the
// flag so that when AGENT_SANDBOX is off (the default; the public deployment
// turns it on, see infra/sandbox/README.md) no
// Daytona client is instantiated and the tool is not registered. It also stays
// off when the build cannot show its images (ASSETS_BUCKET missing or not the
// bucket the image CSP was built for, see lib/ops/env.ts).
if (agentSandboxEnabled() && remoteAssetImagesAvailable()) {
  const assets = createAssetService({ store: gcsAssetStore(), repo: prismaAssetRepo() });
  toolRegistry.register(
    createSandboxTool({
      runner: new DaytonaSandboxRunner(),
      createAsset: assets.createAsset,
      enabled: true,
      // Credits reserved before each run, a daily quota (sandbox-quota.ts).
      quota: sandboxRunQuota(),
    }),
  );
}
