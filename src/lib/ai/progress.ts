/**
 * Pure, tested progress model for the Living Story.
 *
 * `reduceAgentActivity` folds real orchestration events (phase changes,
 * discoveries, the final result) into monotonic state — progress never goes
 * backwards. `advanceAnimatedProgress` lets the UI drift gently toward the
 * current phase's ceiling between events so the bar feels alive, but it can
 * never claim a phase finished before the backend confirms it.
 */
import type {
  AgentArea,
  AgentAreaStatus,
  AgentDiscovery,
  AgentPhase,
  AgentStreamEvent,
} from "./agent-shared";

export const PHASE_ORDER: AgentPhase[] = [
  "inspecting",
  "planning",
  "updating",
  "validating",
  "saving",
];

export const PHASE_CEILINGS: Record<AgentPhase, number> = {
  inspecting: 15,
  planning: 35,
  updating: 75,
  validating: 92,
  saving: 100,
};

export interface AgentActivityState {
  phase: AgentPhase;
  message: string;
  progress: number;
  discoveries: AgentDiscovery[];
  plan?: { summary: string; areas: AgentArea[] };
  areas: { id: string; status: AgentAreaStatus; label: string }[];
}

export function createInitialAgentActivity(
  message: string,
): AgentActivityState {
  return {
    phase: "inspecting",
    message,
    progress: 4,
    discoveries: [],
    areas: [],
  };
}

export function reduceAgentActivity(
  state: AgentActivityState,
  event: AgentStreamEvent,
): AgentActivityState {
  if (event.type === "phase") {
    return {
      ...state,
      phase: event.phase,
      message: event.message,
      // Monotonic, and never past the (now active) phase's ceiling — so a
      // stray route value can't claim a phase finished before it really did.
      progress: Math.min(
        PHASE_CEILINGS[event.phase],
        Math.max(state.progress, event.progress),
      ),
    };
  }

  if (event.type === "discovery") {
    const discoveries = state.discoveries.filter(
      (item) => item.id !== event.discovery.id,
    );
    return {
      ...state,
      progress: Math.min(
        PHASE_CEILINGS[state.phase],
        Math.max(state.progress, event.progress),
      ),
      discoveries: [...discoveries, event.discovery].slice(-3),
    };
  }

  if (event.type === "result") {
    return { ...state, progress: 100 };
  }

  if (event.type === "plan") {
    return {
      ...state,
      plan: { summary: event.summary, areas: event.areas },
      areas: event.areas.map((a) => ({ id: a.id, status: "queued", label: a.label })),
    };
  }

  if (event.type === "area") {
    return {
      ...state,
      progress: Math.min(PHASE_CEILINGS[state.phase], Math.max(state.progress, event.progress)),
      areas: state.areas.map((a) => (a.id === event.areaId ? { ...a, status: event.status } : a)),
    };
  }

  return state;
}

export function advanceAnimatedProgress(
  display: number,
  confirmed: number,
  phase: AgentPhase,
): number {
  const ceiling = PHASE_CEILINGS[phase];
  const target =
    confirmed >= ceiling ? confirmed : Math.max(confirmed, ceiling - 2);
  if (display >= target) return display;
  return Math.min(target, display + (target - display > 8 ? 2 : 0.5));
}
