import "server-only";
import { z } from "zod";
import { safeParseWorkspace } from "@/lib/workspace/schema";
import { applyAgentOps, agentOpsSchema } from "@/lib/ai/agent-ops";
import { toolRegistry, type ToolRegistry } from "./registry";
import { parseSnapshot } from "./snapshot";

export function registerWorkspaceTools(registry: ToolRegistry = toolRegistry): void {
  registry.register({
    id: "summarize_workspace",
    description:
      "Return a compact, plain-language summary of the workspace: page and database counts and their names. Call this first to orient.",
    input: z.object({}),
    output: z.object({ summary: z.string() }),
    limits: { timeoutMs: 5_000 },
    networkPermission: "none",
    handler: (_input, ctx) => {
      const ws = parseSnapshot(ctx.workspaceJson);
      const dbNames = ws.databases.map((d) => d.name).join(", ") || "none";
      const pageNames = ws.pages.map((p) => p.title).join(", ") || "none";
      return {
        summary:
          `${ws.databases.length} database(s): ${dbNames}. ` +
          `${ws.pages.length} page(s): ${pageNames}.`,
      };
    },
    toProgress: (_input, output) => ({ title: "Reviewed the whole workspace", detail: output.summary }),
  });

  registry.register({
    id: "find_entities",
    description:
      "Search pages, databases, and rows by a case-insensitive substring of their visible label/title/name. Use to locate ids before editing.",
    input: z.object({ query: z.string().min(1).max(200) }),
    output: z.object({
      matches: z.array(
        z.object({
          id: z.string(),
          type: z.enum(["page", "database", "row"]),
          label: z.string(),
        }),
      ),
    }),
    limits: { timeoutMs: 5_000 },
    networkPermission: "none",
    handler: (input, ctx) => {
      const ws = parseSnapshot(ctx.workspaceJson);
      const q = input.query.toLowerCase();
      const matches: { id: string; type: "page" | "database" | "row"; label: string }[] = [];
      for (const p of ws.pages) {
        if (p.title.toLowerCase().includes(q)) matches.push({ id: p.id, type: "page", label: p.title });
      }
      for (const d of ws.databases) {
        if (d.name.toLowerCase().includes(q)) matches.push({ id: d.id, type: "database", label: d.name });
        for (const r of d.rows) {
          const text = JSON.stringify(r.cells).toLowerCase();
          if (text.includes(q)) matches.push({ id: r.id, type: "row", label: `${d.name} row` });
        }
      }
      return { matches: matches.slice(0, 50) };
    },
  });

  registry.register({
    id: "read_area",
    description:
      "Return the full JSON of one page or database by id, so you can see its exact current contents before changing it.",
    input: z.object({ id: z.string().min(1).max(100) }),
    output: z.object({ kind: z.enum(["page", "database", "none"]), json: z.string() }),
    limits: { timeoutMs: 5_000 },
    networkPermission: "none",
    handler: (input, ctx) => {
      const ws = parseSnapshot(ctx.workspaceJson);
      const page = ws.pages.find((p) => p.id === input.id);
      if (page) return { kind: "page" as const, json: JSON.stringify(page) };
      const db = ws.databases.find((d) => d.id === input.id);
      if (db) return { kind: "database" as const, json: JSON.stringify(db) };
      return { kind: "none" as const, json: "{}" };
    },
  });

  registry.register({
    id: "apply_ops",
    description:
      "Validate a list of patch operations against the current workspace. Returns ok:true if they yield a valid workspace (the change is then staged), or ok:false with an error so you can fix and retry. Emit the SMALLEST set of operations; never resend unchanged data.",
    input: z.object({ ops: agentOpsSchema }),
    output: z.object({ ok: z.boolean(), opCount: z.number().int(), error: z.string().optional() }),
    limits: { timeoutMs: 10_000 },
    networkPermission: "none",
    handler: (input, ctx) => {
      const ws = parseSnapshot(ctx.workspaceJson);
      try {
        const parsed = safeParseWorkspace(applyAgentOps(ws, input.ops));
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          return { ok: false, opCount: input.ops.length, error: issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "schema" };
        }
        return { ok: true, opCount: input.ops.length };
      } catch (error) {
        return { ok: false, opCount: input.ops.length, error: error instanceof Error ? error.message : "apply failed" };
      }
    },
    toProgress: (input, output) =>
      output.ok ? { title: `Staged ${output.opCount} change(s)` } : { title: "Reworking an invalid change" },
  });
}

registerWorkspaceTools();
