import { z } from "zod";

export const DAILY_STUDY_AGENT_KEY = "daily-study";
export const DEFAULT_DAILY_MINUTES = 60;
export const DAILY_MINUTES_OPTIONS = [30, 45, 60, 90, 120] as const;

export const dailyStudyPlanItemSchema = z.object({
  id: z.string().min(1).max(300),
  kind: z.enum(["deadline", "flashcards", "task"]),
  title: z.string().min(1).max(180),
  source: z.string().min(1).max(180),
  reason: z.string().min(1).max(500),
  workspaceId: z.string().min(1),
  href: z.string().startsWith("/app/"),
  durationMinutes: z.number().int().min(5).max(240),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueCount: z.number().int().positive().optional(),
  completed: z.boolean(),
});

export const dailyStudyPlanItemsSchema = z
  .array(dailyStudyPlanItemSchema)
  .max(12);

export type DailyStudyPlanItem = z.infer<typeof dailyStudyPlanItemSchema>;

export interface DailyStudyAgentConfigData {
  enabled: boolean;
  dailyMinutes: number;
  timeZone: string;
}
export interface DailyStudyPlanData {
  id: string;
  localDate: string;
  timeZone: string;
  summary: string;
  items: DailyStudyPlanItem[];
  sourceCount: number;
  candidateCount: number;
  generatedAt: Date;
}

export interface AgentRunData {
  id: string;
  trigger: "auto" | "manual";
  status: "running" | "completed" | "failed";
  summary: string | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface AgentCenterSnapshot {
  config: DailyStudyAgentConfigData;
  plan: DailyStudyPlanData | null;
  runs: AgentRunData[];
}

export function parseDailyStudyPlanItems(value: string): DailyStudyPlanItem[] {
  const parsed = dailyStudyPlanItemsSchema.safeParse(JSON.parse(value));
  if (!parsed.success) throw new Error("The saved daily study plan is invalid.");
  return parsed.data;
}
