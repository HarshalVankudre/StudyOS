import "server-only";
import { z } from "zod";
import { transform } from "@babel/standalone";
import { MAX_COMPONENT_SOURCE } from "@/lib/workspace/schema";
import { toolRegistry, type ToolRegistry } from "./registry";

export function registerComponentTools(registry: ToolRegistry = toolRegistry): void {
  registry.register({
    id: "check_component",
    description:
      "Compile-check a self-contained React component (JSX). Returns ok:true if it transpiles, else ok:false with the error to fix. The source must define a top-level `App` component and use ONLY the React and Recharts globals — no import/export statements.",
    input: z.object({ source: z.string().min(1).max(MAX_COMPONENT_SOURCE) }),
    output: z.object({ ok: z.boolean(), error: z.string().optional() }),
    limits: { timeoutMs: 5_000 },
    networkPermission: "none",
    handler: (input) => {
      try {
        // Syntax/transform check only. NEVER eval the result — the source is untrusted.
        transform(input.source, { presets: ["react"], filename: "component.tsx" });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "compile failed" };
      }
    },
    toProgress: (_i, o) => ({ title: o.ok ? "Component compiles" : "Fixing the component" }),
  });
}

registerComponentTools();
