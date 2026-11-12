import { describe, expect, it } from "vitest";
import { regionalLocale, weekStartFor } from "./regional";

describe("regionalLocale", () => {
  it("uses the browser's regional variant of the interface language", () => {
    expect(regionalLocale("en", ["en-GB", "de-DE"])).toBe("en-GB");
    expect(regionalLocale("de", ["en-US", "de-AT"])).toBe("de-AT");
  });

  it("borrows the region when the browser prefers another language", () => {
    expect(regionalLocale("en", ["de-DE"])).toBe("en-DE");
  });

  it("keeps the bare language when nothing tells the region", () => {
    expect(regionalLocale("ja", [])).toBe("ja");
    expect(regionalLocale("fr", ["fr"])).toBe("fr");
    expect(regionalLocale("en", ["not a tag!!"])).toBe("en");
  });
});

describe("weekStartFor", () => {
  it("starts on Monday for German and British English, Sunday for US English", () => {
    expect(weekStartFor("de", [])).toBe(1);
    expect(weekStartFor("en", ["en-GB"])).toBe(1);
    expect(weekStartFor("en", ["en-US"])).toBe(0);
    expect(weekStartFor("en", [])).toBe(0);
  });

  it("follows the student's region for the interface language", () => {
    expect(weekStartFor("en", ["de-DE"])).toBe(1);
    expect(weekStartFor("ja", [])).toBe(0);
  });

  it("starts on Saturday for Arabic in Egypt", () => {
    expect(weekStartFor("ar", ["ar-EG"])).toBe(6);
  });
});
