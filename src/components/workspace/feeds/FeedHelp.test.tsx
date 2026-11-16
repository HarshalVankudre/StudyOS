import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { FeedHelp } from "./FeedHelp";

function show(locale: Locale) {
  const dict = getDictionary(locale);
  render(
    <I18nProvider locale={locale} dictionary={dict}>
      <FeedHelp />
    </I18nProvider>,
  );
  return dict.feeds;
}

describe("where to find the calendar link", () => {
  test("in German: the platforms German universities run, Moodle, ILIAS and Stud.IP", () => {
    const F = show("de");
    const items = screen.getAllByRole("listitem", { hidden: true }).map((li) => li.textContent ?? "");
    expect(items.map((text) => text.split(":")[0])).toEqual([
      F.platform.moodle,
      F.platform.ilias,
      F.platform.studip,
      F.platform.google,
    ]);
    expect(items[1]).toContain("Abonnieren");
    expect(items[2]).toContain("Kalender teilen");
    expect(items.join(" ")).not.toMatch(/Canvas|Blackboard|Brightspace/);
  });

  test("in English: the platforms as before", () => {
    const F = show("en");
    const items = screen.getAllByRole("listitem", { hidden: true }).map((li) => li.textContent ?? "");
    expect(items.map((text) => text.split(":")[0])).toEqual([
      F.platform.canvas,
      F.platform.moodle,
      F.platform.blackboard,
      F.platform.brightspace,
      F.platform.google,
    ]);
  });

  test.each(LOCALES.map((l) => l.code))("%s has instructions for ILIAS and Stud.IP", (code) => {
    const F = getDictionary(code).feeds;
    expect(F.platform.ilias).toBe("ILIAS");
    expect(F.platform.studip).toBe("Stud.IP");
    // The menu names are the German ones those platforms show.
    expect(F.help.ilias).toContain("Abonnieren");
    expect(F.help.studip).toContain("Kalender teilen");
  });
});
