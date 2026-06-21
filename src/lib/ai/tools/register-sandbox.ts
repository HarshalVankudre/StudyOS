// src/lib/ai/tools/register-sandbox.ts
import "server-only";
import { toolRegistry } from "./registry";
import { createSandboxTool } from "./sandbox-tool";
import { DaytonaSandboxRunner } from "@/lib/ai/sandbox/daytona";
import { createAssetService } from "@/lib/assets/service";
import { gcsAssetStore } from "@/lib/assets/storage";
import { prismaAssetRepo } from "@/lib/assets/repo";
import { agentSandboxEnabled } from "@/lib/flags";

// All imports are static (ES2017 target forbids top-level await).
// Construction of the Daytona client and asset service is guarded behind the
// flag so that when AGENT_SANDBOX is off (the default, including prod) no
// Daytona client is instantiated and the tool is not registered.
if (agentSandboxEnabled()) {
  const assets = createAssetService({ store: gcsAssetStore(), repo: prismaAssetRepo() });
  toolRegistry.register(
    createSandboxTool({
      runner: new DaytonaSandboxRunner(),
      createAsset: assets.createAsset,
      enabled: true,
    }),
  );
}
