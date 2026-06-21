/**
 * Built-in trusted tools. These run in the main server (no untrusted code),
 * operating only on the sanitized workspace snapshot. OS-level tools that need a
 * real shell/filesystem/network are registered as disabled stubs until the
 * isolated sandbox (Increment B) provides their execution backend.
 */
import "server-only";

import { z } from "zod";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import { applyAgentOps, agentOpsSchema } from "@/lib/ai/agent-ops";
import { controlledFetch } from "@/lib/net/controlled-fetch";
import { type ToolRegistry, toolRegistry } from "./registry";

/** Allowlisted hosts for controlled web reading; empty (deny-all) by default. */
function fetchAllowlist(): string[] {
  return (process.env.AGENT_FETCH_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseSnapshot(json?: string) {
  if (!json) throw new Error("no workspace snapshot");
  const parsed = safeParseWorkspace(JSON.parse(json));
  if (!parsed.success) throw new Error("invalid workspace snapshot");
  return parsed.data;
}

/** OS-level tools whose execution backend arrives with the isolated sandbox. */
export const STUB_TOOL_IDS = [
  "shell_exec",
  "install_package",
  "native_build",
] as const;

export function registerBuiltinTools(registry: ToolRegistry = toolRegistry): void {
  registry.register({
    id: "inspect_workspace",
    description:
      "Summarize the current workspace structure (page and database counts).",
    input: z.object({}),
    output: z.object({ pages: z.number().int(), databases: z.number().int() }),
    limits: { timeoutMs: 5_000 },
    networkPermission: "none",
    handler: (_input, ctx) => {
      const ws = parseSnapshot(ctx.workspaceJson);
      return { pages: ws.pages.length, databases: ws.databases.length };
    },
    toProgress: (_input, output) => ({
      title: `Reviewed ${output.pages} pages and ${output.databases} databases`,
    }),
  });

  registry.register({
    id: "validate_ops",
    description:
      "Dry-run a list of patch operations and report whether they yield a valid workspace.",
    input: z.object({ ops: agentOpsSchema }),
    output: z.object({ valid: z.boolean(), error: z.string().optional() }),
    limits: { timeoutMs: 10_000 },
    networkPermission: "none",
    handler: (input, ctx) => {
      const ws = parseSnapshot(ctx.workspaceJson);
      try {
        const parsed = safeParseWorkspace(applyAgentOps(ws, input.ops));
        return parsed.success ? { valid: true } : { valid: false, error: "schema" };
      } catch {
        return { valid: false, error: "apply" };
      }
    },
  });

  registry.register({
    id: "controlled_fetch",
    description:
      "Read allowlisted public web content over HTTPS for research. No request body; size- and time-capped.",
    input: z.object({ url: z.string().url() }),
    output: z.object({
      status: z.number().int(),
      contentType: z.string().nullable(),
      text: z.string(),
    }),
    limits: { timeoutMs: 12_000 },
    networkPermission: "allowlisted",
    handler: async (input, ctx) => {
      const result = await controlledFetch(input.url, {
        allowlist: fetchAllowlist(),
        signal: ctx.signal,
        audit: (record) =>
          console.log("[StudyOS] controlled_fetch", record),
      });
      return {
        status: result.status,
        contentType: result.contentType,
        text: result.text,
      };
    },
  });

  // Disabled stubs: registered so skills/the planner can see them, but inert
  // until the isolated sandbox provides their backend (Increment B).
  for (const id of STUB_TOOL_IDS) {
    registry.register({
      id,
      description: `${id} (requires the isolated sandbox; not available yet)`,
      input: z.unknown(),
      output: z.unknown(),
      limits: { timeoutMs: 1_000 },
      networkPermission: "none",
      enabled: false,
      handler: () => {
        throw new Error("tool backend not available");
      },
    });
  }
}

// Populate the application-wide registry on import.
registerBuiltinTools();
