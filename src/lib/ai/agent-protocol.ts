import { z } from "zod";
import { extractJson } from "./generate";
import type { AgentChoice } from "./agent-shared";

export const agentPlanSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), reply: z.string().min(1) }),
  z.object({
    action: z.literal("clarify"),
    reply: z.string().min(1),
    choices: z
      .array(z.object({ id: z.string().min(1), label: z.string().min(1).max(80), value: z.string().min(1).max(300) }))
      .min(2)
      .max(4),
  }),
  z.object({
    action: z.literal("execute"),
    skillId: z.string().min(1),
    summary: z.string().min(1).max(400),
    affectedAreaIds: z.array(z.string()).default([]),
  }),
]);

export type AgentPlanDecision =
  | { action: "reply"; reply: string }
  | { action: "clarify"; reply: string; choices: AgentChoice[] }
  | { action: "execute"; skillId: string; summary: string; affectedAreaIds: string[] };

export const agentStepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("tool"), tool: z.string().min(1), input: z.unknown() }),
  z.object({ action: z.literal("final"), reply: z.string().min(1) }),
]);

export type AgentStep =
  | { action: "tool"; tool: string; input: unknown }
  | { action: "final"; reply: string };

export function parseAgentPlan(raw: string): AgentPlanDecision {
  const parsed = agentPlanSchema.safeParse(extractJson(raw));
  if (!parsed.success) throw new Error(`invalid plan JSON: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  return parsed.data as AgentPlanDecision;
}

export function parseAgentStep(raw: string): AgentStep {
  const parsed = agentStepSchema.safeParse(extractJson(raw));
  if (!parsed.success) throw new Error(`invalid step JSON: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  return parsed.data as AgentStep;
}
