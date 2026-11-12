import type { QuestionAnswer } from "./onboarding";

export const GENERATION_COMPONENT_KINDS = [
  "dashboard",
  "courses",
  "assignments",
  "planner",
  "exams",
  "readings",
  "notes",
  "habits",
  "grades",
  "projects",
  "resources",
  "custom",
] as const;

export type GenerationComponentKind =
  (typeof GENERATION_COMPONENT_KINDS)[number];

export interface GenerationComponent {
  id: string;
  kind: GenerationComponentKind;
  label: string;
  icon: string;
  description: string;
}

export interface WorkspaceGenerationPlan {
  workspaceName: string;
  summary: string;
  components: GenerationComponent[];
}

export interface GenerationRequest {
  prompt: string;
  answers: QuestionAnswer[];
}

export type GenerationPhase =
  | "analyzing"
  | "planning"
  | "generating"
  | "validating"
  | "saving";

export type GenerationEvent =
  | {
      type: "phase";
      phase: GenerationPhase;
      message: string;
      progress: number;
    }
  | {
      type: "plan";
      plan: WorkspaceGenerationPlan;
    }
  | {
      type: "component";
      componentId: string;
      status: "queued" | "generating" | "complete";
      progress: number;
      detail?: string;
    }
  | {
      type: "complete";
      workspaceId: string;
      /** Credits this generation cost (0 when nothing ran). */
      credits?: number;
      /** The user's credit balance after the charge. */
      balance?: number;
    }
  | {
      /**
       * The student stopped the build: nothing was saved, and `credits` were
       * charged for the AI work already done (0 when none had started).
       */
      type: "cancelled";
      credits: number;
    }
  | {
      type: "error";
      message: string;
      /**
       * Lets the client offer the right way forward: buy credits, wait, or
       * retry. A "generation_failed" error was never charged.
       */
      code?: GenerationErrorCode;
    };

export type GenerationErrorCode =
  | "out_of_credits"
  | "rate_limited"
  /** Several builds failed recently; new ones wait (failed builds are free). */
  | "too_many_failures"
  /** The account stores the most workspaces it may. */
  | "workspace_limit"
  | "generation_failed";

export interface ComponentProgress {
  status: "queued" | "generating" | "complete";
  progress: number;
  detail?: string;
}
