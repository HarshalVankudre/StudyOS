/**
 * The public face (landing, pricing, legal chrome, page metadata) and the
 * Agent Center must be really translated in every language: the same keys,
 * the same {placeholders}, and not English copies.
 */
import { describe, expect, it } from "vitest";
import { LOCALES } from "../config";
import { getDictionary } from "./index";
import { en } from "./en";

const SECTIONS = ["meta", "landing", "pricing", "legal", "agentCenter"] as const;

function leaves(value: unknown, path = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") {
    out.set(path, value);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => leaves(v, `${path}[${i}]`).forEach((s, p) => out.set(p, s)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      leaves(v, path ? `${path}.${k}` : k).forEach((s, p) => out.set(p, s));
    }
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Strings that are legitimately the same in every language. */
const SAME_EVERYWHERE = /^(StudyOS|\{name\} · StudyOS|📄|\/|.*\{date\}.*|[\d\s%.,:/·$-]*)$/;

describe.each(LOCALES.filter((l) => l.code !== "en").map((l) => l.code))("%s marketing copy", (code) => {
  const dict = getDictionary(code);

  it.each(SECTIONS)("%s has every key, with the same placeholders", (section) => {
    const source = leaves(en[section]);
    const target = leaves(dict[section]);
    expect([...target.keys()].sort()).toEqual([...source.keys()].sort());
    for (const [path, text] of source) {
      expect({ path, placeholders: placeholders(target.get(path) ?? "") }).toEqual({
        path,
        placeholders: placeholders(text),
      });
    }
  });

  it.each(SECTIONS)("%s is translated, not copied from English", (section) => {
    expect(dict[section]).not.toBe(en[section]);
    const source = leaves(en[section]);
    const target = leaves(dict[section]);
    const copied = [...source].filter(
      ([path, text]) => text.trim() !== "" && !SAME_EVERYWHERE.test(text) && target.get(path) === text,
    );
    // A handful of identical strings is normal (brand names, "Pro", "FSRS");
    // more than that means a block was left in English.
    expect(copied.length, copied.map(([p]) => p).join(", ")).toBeLessThanOrEqual(
      Math.max(3, Math.floor(source.size * 0.08)),
    );
  });
});
