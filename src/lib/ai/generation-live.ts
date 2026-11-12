/**
 * Turns what the model has really written so far (see ./workspace-stream)
 * into the build screen's progress events: the phase line names the database
 * or page being written and how many items it has, the planned component it
 * belongs to lights up, and the bar moves with the amount of reply received.
 * A slow timer only fills the gaps (the model thinks before it writes).
 *
 * Pure and synchronous: the route sends whatever `handle` / `tick` return.
 */
import type { GenerationStreamProgress } from "./generate";
import type { GenerationComponent, GenerationEvent, WorkspaceGenerationPlan } from "./generation-progress";
import { fmt } from "@/lib/i18n/interpolate";
import { plural, type PluralForms } from "@/lib/i18n/plural";

export interface LiveProgressMessages {
  /** The student's language, for the plural form of counts. */
  locale: string;
  /** Shown until the first piece arrives (the model is still thinking). */
  generating: string;
  /** "{name}" — a database is being set up. */
  database: string;
  /** "{name}" and "{count}" — rows written into it so far (plural forms). */
  rows: PluralForms;
  /** "{title}" — a page is being written. */
  page: string;
}

/** Bar range the build phase may use (the route sends 30 before it, 88 after). */
const BAR_START = 32;
const BAR_END = 86;
/** Roughly how much reply (characters) each planned component takes. */
const CHARS_PER_COMPONENT = 3_800;

function words(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 || /[぀-鿿]/.test(w));
}

/** The planned component a database or page most likely belongs to (shared word stems). */
export function componentFor(
  components: GenerationComponent[],
  name: string,
): GenerationComponent | undefined {
  const target = words(name);
  let best: { component: GenerationComponent; score: number } | undefined;
  for (const component of components) {
    const label = words(component.label);
    const shared = label.filter((w) =>
      target.some((t) => t.startsWith(w.slice(0, 5)) || w.startsWith(t.slice(0, 5))),
    );
    const score = shared.length / Math.max(1, label.length);
    if (score > 0 && (!best || score > best.score)) best = { component, score };
  }
  return best?.component;
}

export function createLiveProgress(plan: WorkspaceGenerationPlan, messages: LiveProgressMessages) {
  const components = plan.components;
  const progress = new Map(components.map((c) => [c.id, 6]));
  const status = new Map<string, "queued" | "generating">(components.map((c) => [c.id, "queued"]));
  const expectedChars = Math.max(8_000, components.length * CHARS_PER_COMPONENT);
  let bar = BAR_START;
  let message = messages.generating;
  let writing = false;

  const componentEvent = (component: GenerationComponent): GenerationEvent => ({
    type: "component",
    componentId: component.id,
    status: "generating",
    progress: progress.get(component.id) ?? 6,
  });

  /** Make `component` the one being written; earlier ones are as good as done. */
  const activate = (component: GenerationComponent, at: number): GenerationEvent[] => {
    const events: GenerationEvent[] = [];
    for (const other of components) {
      if (other.id === component.id || status.get(other.id) !== "generating") continue;
      if ((progress.get(other.id) ?? 0) >= 90) continue;
      progress.set(other.id, 90);
      events.push(componentEvent(other));
    }
    status.set(component.id, "generating");
    progress.set(component.id, Math.max(progress.get(component.id) ?? 6, at));
    events.push(componentEvent(component));
    return events;
  };

  const nextQueued = () => components.find((c) => status.get(c.id) === "queued");

  /** The phase line (and bar), when either changed. */
  const phase = (next: string, chars: number): GenerationEvent[] => {
    const before = Math.round(bar);
    bar = Math.max(bar, Math.min(BAR_END, BAR_START + ((BAR_END - BAR_START) * chars) / expectedChars));
    if (next === message && Math.round(bar) === before) return [];
    message = next;
    return [{ type: "phase", phase: "generating", message, progress: Math.round(bar) }];
  };

  return {
    /** Events for one piece of streamed output. */
    handle(event: GenerationStreamProgress): GenerationEvent[] {
      writing = true;
      switch (event.type) {
        case "text":
          return phase(message, event.chars);
        case "database": {
          const component = componentFor(components, event.name) ?? nextQueued();
          return [
            ...phase(fmt(messages.database, { name: event.name }), event.chars),
            ...(component ? activate(component, 30) : []),
          ];
        }
        case "rows": {
          const events = phase(plural(messages.locale, messages.rows, event.count, { name: event.database }), event.chars);
          const component = componentFor(components, event.database);
          if (component && status.get(component.id) === "generating") {
            const at = Math.min(88, Math.max(progress.get(component.id) ?? 0, 30 + event.count * 5));
            progress.set(component.id, at);
            events.push(componentEvent(component));
          }
          return events;
        }
        case "page": {
          const component = componentFor(components, event.title) ?? nextQueued();
          return [
            ...phase(fmt(messages.page, { title: event.title }), event.chars),
            ...(component ? activate(component, 45) : []),
          ];
        }
        default:
          return [];
      }
    },

    /** Gentle movement between real events; never claims a component is done. */
    tick(): GenerationEvent[] {
      const events: GenerationEvent[] = [];
      for (const component of components) {
        const current = progress.get(component.id) ?? 6;
        if (status.get(component.id) === "generating" && current < 85) {
          progress.set(component.id, current + 1);
          events.push(componentEvent(component));
        }
      }
      // While the model is still thinking, the first component shows life.
      const first = components[0];
      if (!writing && first && (progress.get(first.id) ?? 6) < 20) {
        progress.set(first.id, (progress.get(first.id) ?? 6) + 1);
        status.set(first.id, "generating");
        if (!events.some((e) => e.type === "component" && e.componentId === first.id)) {
          events.push(componentEvent(first));
        }
      }
      return events;
    },
  };
}
