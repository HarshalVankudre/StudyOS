/**
 * Copy-on-write drafts: run a mutator on a document without copying it.
 *
 * `produce(doc, fn)` hands `fn` a stand-in for `doc` that reads like the
 * document and can be changed in place like a clone (`d.pages[0].title = x`,
 * `blocks.splice(i, 1)`, `d.pages = d.pages.filter(...)`). Only the objects on
 * the paths `fn` writes to are copied; everything else in the result is the
 * very same object as in `doc`, which is never modified. That keeps an edit to
 * a large workspace proportional to the edit, not to the workspace (a full
 * `structuredClone` of a 2 MB workspace costs tens of milliseconds on a
 * phone, per keystroke for fields that write on every key), and lets the
 * change be found by comparing only what changed.
 *
 * Plain objects and arrays are drafted; anything else is used as it is. A
 * mutator that does something a draft cannot take part in (e.g. calls
 * `structuredClone` on part of it) throws; callers fall back to running it on
 * a real clone. After `produce` returns, the stand-ins no longer change the
 * result (late writes are ignored).
 */

const STATE = Symbol("draft-state");

interface DraftState {
  base: Record<PropertyKey, unknown> | unknown[];
  copy: Record<PropertyKey, unknown> | unknown[] | null;
  parent: DraftState | null;
  children: Map<PropertyKey, DraftState>;
  proxy: object;
  done: boolean;
  final?: unknown;
}

function isDraftable(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stateOf(value: unknown): DraftState | undefined {
  return typeof value === "object" && value !== null
    ? ((value as Record<symbol, unknown>)[STATE] as DraftState | undefined)
    : undefined;
}

function latest(state: DraftState): Record<PropertyKey, unknown> {
  return (state.copy ?? state.base) as Record<PropertyKey, unknown>;
}

function markModified(state: DraftState): void {
  for (let s: DraftState | null = state; s && !s.copy; s = s.parent) {
    s.copy = Array.isArray(s.base) ? s.base.slice() : { ...s.base };
  }
}

function hasOwn(obj: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function createState(base: object, parent: DraftState | null): DraftState {
  const state = {
    base,
    copy: null,
    parent,
    children: new Map(),
    done: false,
  } as unknown as DraftState;
  const handler: ProxyHandler<object> = {
    get(_target, key) {
      if (key === STATE) return state;
      if (state.done) return Reflect.get(state.final as object, key);
      const src = latest(state);
      const value = Reflect.get(src, key);
      if (!hasOwn(src, key) || !isDraftable(value) || stateOf(value)) return value;
      // A child that is still the document's own object: draft it.
      if ((state.base as Record<PropertyKey, unknown>)[key] !== value) return value; // new, the mutator's own
      let child = state.children.get(key);
      if (!child || child.base !== value) {
        child = createState(value, state);
        state.children.set(key, child);
      }
      return child.proxy;
    },
    set(_target, key, value) {
      if (state.done) return true;
      const src = latest(state);
      if (hasOwn(src, key) && src[key as keyof typeof src] === value) return true;
      markModified(state);
      (state.copy as Record<PropertyKey, unknown>)[key] = value;
      return true;
    },
    deleteProperty(_target, key) {
      if (state.done) return true;
      if (!hasOwn(latest(state), key)) return true;
      markModified(state);
      delete (state.copy as Record<PropertyKey, unknown>)[key];
      state.children.delete(key);
      return true;
    },
    has(_target, key) {
      return key in latest(state);
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(latest(state));
      // An array's `length` is a fixed own key of the (array) target.
      if (Array.isArray(target) && !keys.includes("length")) keys.push("length");
      return keys;
    },
    getOwnPropertyDescriptor(target, key) {
      const src = latest(state);
      const desc = Reflect.getOwnPropertyDescriptor(src, key);
      if (!desc) return undefined;
      if (Array.isArray(target) && key === "length") {
        return { value: (src as unknown as unknown[]).length, writable: true, enumerable: false, configurable: false };
      }
      return { value: handler.get!(target, key, undefined), writable: true, enumerable: desc.enumerable, configurable: true };
    },
    defineProperty(_target, key, desc) {
      if (state.done) return true;
      markModified(state);
      return Reflect.defineProperty(state.copy as object, key, desc);
    },
    getPrototypeOf() {
      return Object.getPrototypeOf(state.base);
    },
    setPrototypeOf() {
      return false;
    },
    preventExtensions() {
      return false;
    },
  };
  state.proxy = new Proxy(Array.isArray(base) ? [] : {}, handler);
  return state;
}

/** Replace every stand-in reachable from a new value by its final object. */
function resolve(value: unknown, seen: Set<object>): unknown {
  const s = stateOf(value);
  if (s) return finalize(s, seen);
  if (!isDraftable(value) || seen.has(value)) return value;
  seen.add(value);
  const obj = value as Record<PropertyKey, unknown>;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === "object" && v !== null) obj[key] = resolve(v, seen);
  }
  return value;
}

function finalize(state: DraftState, seen: Set<object>): unknown {
  if (state.done) return state.final;
  state.done = true;
  if (!state.copy) {
    state.final = state.base;
    return state.final;
  }
  const copy = state.copy as Record<PropertyKey, unknown>;
  for (const key of Object.keys(copy)) {
    const v = copy[key];
    if (typeof v !== "object" || v === null) continue;
    const child = stateOf(v);
    if (child) copy[key] = finalize(child, seen);
    else if ((state.base as Record<PropertyKey, unknown>)[key] === v) {
      // Unchanged child of the document: if it was drafted and changed
      // through this key, take the changed one.
      const drafted = state.children.get(key);
      if (drafted && drafted.base === v) copy[key] = finalize(drafted, seen);
    } else {
      copy[key] = resolve(v, seen);
    }
  }
  state.final = copy;
  return copy;
}

/**
 * Run `fn` on a copy-on-write stand-in for `base`; returns the changed
 * document (or `base` itself when nothing was written). `base` is not
 * modified.
 */
export function produce<T extends object>(base: T, fn: (draft: T) => void): T {
  const root = createState(base, null);
  let ok = false;
  try {
    fn(root.proxy as T);
    ok = true;
  } finally {
    if (!ok) markDone(root);
  }
  return finalize(root, new Set()) as T;
}

function markDone(state: DraftState): void {
  state.done = true;
  state.final = state.base;
  for (const child of state.children.values()) markDone(child);
}
