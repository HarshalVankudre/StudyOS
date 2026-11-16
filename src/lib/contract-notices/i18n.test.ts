/**
 * The withdrawal function and the cancellation button must be labelled as
 * the law says, in every language: every key, the same {placeholders}, really
 * translated, and the statutory German wording exactly.
 */
import { describe, expect, it } from "vitest";
import { LOCALES } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { en } from "@/lib/i18n/dictionaries/en";

function leaves(value: unknown, path = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") out.set(path, value);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) leaves(v, path ? `${path}.${k}` : k).forEach((s, p) => out.set(p, s));
  }
  return out;
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const codes = LOCALES.map((l) => l.code);

describe.each(codes.filter((code) => code !== "en"))("%s contractNotices", (code) => {
  const source = leaves(en.contractNotices);
  const target = leaves(getDictionary(code).contractNotices);

  it("has every key, each with the same placeholders", () => {
    expect([...target.keys()].sort()).toEqual([...source.keys()].sort());
    for (const [path, text] of source) {
      expect({ path, placeholders: placeholders(target.get(path) ?? "") }).toEqual({ path, placeholders: placeholders(text) });
      expect(target.get(path)?.trim(), path).not.toBe("");
    }
  });

  it("is translated, not copied from English", () => {
    // A few words are the same in some languages ("Name" in German); more means a block was left in English.
    const copied = [...source].filter(([path, text]) => target.get(path) === text);
    expect(copied.length, copied.map(([p]) => p).join(", ")).toBeLessThanOrEqual(3);
  });
});

describe("statutory labels", () => {
  it("German uses the wording of § 356a and § 312k BGB exactly", () => {
    const de = getDictionary("de").contractNotices;
    expect(de.withdrawLink).toBe("Vertrag widerrufen");
    expect(de.withdraw.confirm).toBe("Widerruf bestätigen");
    expect(de.cancelLink).toBe("Verträge hier kündigen");
    expect(de.cancel.confirm).toBe("Jetzt kündigen");
  });

  it("English and French use the directive's wording", () => {
    expect(en.contractNotices.withdrawLink).toBe("Withdraw from contract here");
    expect(en.contractNotices.withdraw.confirm).toBe("Confirm withdrawal");
    const fr = getDictionary("fr").contractNotices;
    expect(fr.withdrawLink).toBe("Rétracter le contrat ici");
    expect(fr.withdraw.confirm).toBe("Confirmer la rétractation");
  });

  it("never says a withdrawal or cancellation was accepted, only received", () => {
    // Every language states the date and time of receipt.
    for (const code of codes) {
      const M = getDictionary(code).contractNotices;
      for (const text of [M.withdraw.received, M.cancel.received]) expect(text, code).toContain("{date}");
    }
    expect(en.contractNotices.withdraw.received).toBe("We received your withdrawal declaration on {date}.");
    expect(JSON.stringify(en.contractNotices)).not.toMatch(/accepted|approved|is valid/i);
  });
});
