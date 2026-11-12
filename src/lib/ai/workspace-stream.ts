/**
 * Reads a workspace JSON reply while it streams and reports what the model
 * has actually written so far: each database as its name arrives, its row
 * count as rows complete, and each page as its title arrives. The generator
 * forwards these to the build screen, so the progress the student watches is
 * the real output, not a timer.
 *
 * A tiny incremental JSON tokenizer: constant memory per character, never
 * throws on malformed input (it just stops recognising structure), and holds
 * at most a short string buffer.
 */

export type WorkspaceStreamEvent =
  | { type: "database"; name: string }
  | { type: "rows"; database: string; count: number }
  | { type: "page"; title: string };

interface Frame {
  kind: "object" | "array";
  /** Where this container sits in its parent: a key, or "[]" for an array element. */
  at: string;
  /** Objects: the key whose value comes next. */
  key?: string;
  expectKey: boolean;
  /** Database objects: their name, once read. */
  name?: string;
  /** Arrays of rows: how many have completed. */
  count: number;
}

const MAX_STRING = 200;

export interface WorkspaceStreamScanner {
  push(delta: string): void;
  /** Characters seen so far (a rough measure of how much is written). */
  readonly chars: number;
}

export function createWorkspaceStreamScanner(
  onEvent: (event: WorkspaceStreamEvent) => void,
): WorkspaceStreamScanner {
  const stack: Frame[] = [];
  let inString = false;
  let escaped = false;
  let buffer = "";
  let chars = 0;

  const path = () => stack.map((frame) => frame.at).join(".");

  const emit = (event: WorkspaceStreamEvent) => {
    try {
      onEvent(event);
    } catch {
      // Progress is best effort; never break generation over it.
    }
  };

  const endString = (value: string) => {
    const top = stack.at(-1);
    if (!top || top.kind !== "object") return;
    if (top.expectKey) {
      top.key = value;
      top.expectKey = false;
      return;
    }
    const where = path();
    const text = value.trim();
    if (!text) return;
    if (where === "$.databases.[]" && top.key === "name") {
      top.name = text;
      emit({ type: "database", name: text });
    } else if (where === "$.pages.[]" && top.key === "title") {
      emit({ type: "page", title: text });
    }
  };

  const open = (kind: Frame["kind"]) => {
    const parent = stack.at(-1);
    const at = stack.length === 0 ? "$" : parent?.kind === "array" ? "[]" : (parent?.key ?? "?");
    stack.push({ kind, at, expectKey: kind === "object", count: 0 });
  };

  const close = () => {
    const frame = stack.pop();
    if (!frame) return;
    // A finished row: an object element of "$.databases.[].rows".
    const parent = stack.at(-1);
    if (frame.kind === "object" && parent?.kind === "array" && path() === "$.databases.[].rows") {
      parent.count += 1;
      const database = stack.at(-2)?.name;
      if (database) emit({ type: "rows", database, count: parent.count });
    }
  };

  return {
    get chars() {
      return chars;
    },
    push(delta: string) {
      chars += delta.length;
      for (const ch of delta) {
        if (inString) {
          if (escaped) {
            escaped = false;
            if (buffer.length < MAX_STRING) buffer += ch === "n" ? " " : ch;
          } else if (ch === "\\") {
            escaped = true;
          } else if (ch === '"') {
            inString = false;
            endString(buffer);
          } else if (buffer.length < MAX_STRING) {
            buffer += ch;
          }
          continue;
        }
        switch (ch) {
          case '"':
            inString = true;
            buffer = "";
            break;
          case "{":
            open("object");
            break;
          case "[":
            open("array");
            break;
          case "}":
          case "]":
            close();
            break;
          case ",": {
            const top = stack.at(-1);
            if (top?.kind === "object") {
              top.expectKey = true;
              top.key = undefined;
            }
            break;
          }
          default:
            break;
        }
      }
    },
  };
}
