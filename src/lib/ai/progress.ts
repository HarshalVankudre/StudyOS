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
}

export function createInitialAgentActivity(
  message: string,
): AgentActivityState {
  return {
    phase: "inspecting",
    message,
    progress: 4,
    discoveries: [],
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
      progress: Math.max(state.progress, event.progress),
    };
  }

  if (event.type === "discovery") {
    const discoveries = state.discoveries.filter(
      (item) => item.id !== event.discovery.id,
    );
    return {
      ...state,
      progress: Math.max(state.progress, event.progress),
      discoveries: [...discoveries, event.discovery].slice(-3),
    };
  }

  if (event.type === "result") {
    return { ...state, progress: 100 };
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
