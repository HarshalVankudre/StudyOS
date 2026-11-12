// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ICS_LIMITS } from "./ical";
import { readFeed } from "./normalize";

/**
 * Hostile calendars measured in the second security review (probe
 * sec2/feeds/ical.probe.ts). Each used to block the event loop for one to
 * ten seconds per fetch; each must now be read well inside a generous
 * bound, measured here. Inputs are kept under the fetcher's 3 MB cap.
 */
const CAP = 3_000_000;
const NOW = Date.parse("2026-11-12T00:00:00Z");
const head = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//probe//EN\r\n";
const tail = "END:VCALENDAR\r\n";
/** Generous: the caps make each case a few hundred ms at most on a laptop. */
const BOUND_MS = 3_000;

function fill(unit: (i: number) => string, budget = CAP - 200): string {
  const parts: string[] = [];
  let n = 0;
  for (let i = 0; ; i++) {
    const u = unit(i);
    if (n + u.length > budget) break;
    parts.push(u);
    n += u.length;
  }
  return parts.join("");
}

function timed(body: string, options: { timeBudgetMs?: number } = {}) {
  const text = head + body + tail;
  expect(text.length).toBeLessThanOrEqual(CAP);
  const t0 = performance.now();
  const result = readFeed(text, { now: NOW, ...options });
  return { result, ms: performance.now() - t0 };
}

const junkZones = Array.from(
  { length: 600 },
  (_, i) => `BEGIN:VEVENT\r\nUID:j${i}\r\nSUMMARY:x\r\nDTSTART;TZID=Junk/Zone${i}:20261201T100000\r\nEND:VEVENT\r\n`,
).join("");
const exLine = (tz: string) => `EXDATE;TZID=${tz}:${Array(1700).fill("20270101T100000").join(",")}\r\n`;

describe("hostile calendars finish quickly", () => {
  it("600 junk TZIDs, then an EXDATE flood with an unknown TZID (was 10.5 s)", () => {
    const body =
      junkZones +
      `BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:x\r\nDTSTART:20261201T100000Z\r\n${fill(() => exLine("Not/AZone/Either"), CAP - 400 - junkZones.length - head.length)}END:VEVENT\r\n`;
    const { result, ms } = timed(body);
    expect(ms).toBeLessThan(BOUND_MS);
    expect(result.ok).toBe(true);
  }, 60_000);

  it("600 junk TZIDs, then an EXDATE flood with a decorated Windows-style TZID (was 9.3 s)", () => {
    const body =
      junkZones +
      `BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:x\r\nDTSTART:20261201T100000Z\r\n${fill(() => exLine('"(UTC-05:00) A/B/C/D/E"'), CAP - 400 - junkZones.length - head.length)}END:VEVENT\r\n`;
    const { result, ms } = timed(body);
    expect(ms).toBeLessThan(BOUND_MS);
    expect(result.ok).toBe(true);
  }, 60_000);

  it("one repeating event with an EXDATE flood in a valid IANA zone (was 1.1 s)", () => {
    const body = `BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:x\r\nDTSTART;TZID=America/New_York:20261201T100000\r\nRRULE:FREQ=DAILY\r\n${fill(() => exLine("America/New_York"), CAP - 400 - head.length)}END:VEVENT\r\n`;
    const { result, ms } = timed(body);
    expect(ms).toBeLessThan(BOUND_MS);
    expect(result.ok).toBe(true);
    // The series still expands (EXDATEs beyond the cap are ignored, not fatal).
    if (result.ok) expect(result.feed.events.length).toBeGreaterThan(0);
  }, 60_000);

  it("many events each with 50 lines of 100 zoned EXDATEs (was 1.8 s)", () => {
    const exdates = Array(50)
      .fill(`EXDATE;TZID=America/New_York:${Array(100).fill("20270101T100000").join(",")}\r\n`)
      .join("");
    const body = fill(
      (i) => `BEGIN:VEVENT\r\nUID:x${i}\r\nSUMMARY:x\r\nDTSTART;TZID=America/New_York:20261201T100000\r\nRRULE:FREQ=DAILY\r\n${exdates}END:VEVENT\r\n`,
      CAP - 200 - head.length,
    );
    const { result, ms } = timed(body);
    expect(ms).toBeLessThan(BOUND_MS);
    expect(result.ok).toBe(true);
  }, 60_000);

  it("a hostile feed does not slow later normal feeds (global zone caches stay usable)", () => {
    const zones = Intl.supportedValuesOf("timeZone");
    const victim = zones.slice(300, 310);
    const normal =
      Array.from(
        { length: 300 },
        (_, i) =>
          `BEGIN:VEVENT\r\nUID:n${i}\r\nSUMMARY:Lecture ${i}\r\nDTSTART;TZID=${victim[i % 10]}:20261201T100000\r\nRRULE:FREQ=WEEKLY;COUNT=30\r\nEXDATE;TZID=${victim[i % 10]}:20261208T100000,20261215T100000\r\nEND:VEVENT\r\n`,
      ).join("");
    const before = timed(normal);
    // Cache filler: hundreds of real zones plus hundreds of junk names.
    const filler =
      zones
        .slice(0, 250)
        .map((z, i) => `BEGIN:VEVENT\r\nUID:z${i}\r\nSUMMARY:x\r\nDTSTART;TZID=${z}:20261201T100000\r\nEND:VEVENT\r\n`)
        .join("") + junkZones;
    timed(filler);
    // Case variants of real zones are distinct cache keys that Intl accepts.
    timed(zones.slice(0, 400).map((z, i) => `BEGIN:VEVENT\r\nUID:c${i}\r\nSUMMARY:x\r\nDTSTART;TZID=${z.toUpperCase()}:20261201T100000\r\nEND:VEVENT\r\n`).join(""));
    const after = timed(normal);
    expect(after.result.ok).toBe(true);
    expect(after.ms).toBeLessThan(BOUND_MS);
    // Generous: a poisoned cache made this several times slower.
    expect(after.ms).toBeLessThan(Math.max(before.ms * 3, 500));
  }, 60_000);

  it("resolves at most maxZonesPerCalendar distinct TZIDs; later new ones count as unknown", () => {
    const n = ICS_LIMITS.maxZonesPerCalendar;
    const junk = Array.from(
      { length: n },
      (_, i) => `BEGIN:VEVENT\r\nUID:j${i}\r\nSUMMARY:x\r\nDTSTART;TZID=Junk/Zone${i}:20261201T100000\r\nEND:VEVENT\r\n`,
    ).join("");
    const real = `BEGIN:VEVENT\r\nUID:real\r\nSUMMARY:x\r\nDTSTART;TZID=Europe/Berlin:20261201T100000\r\nEND:VEVENT\r\n`;
    const { result } = timed(junk + real);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ev = result.feed.events.find((e) => e.key === "real");
    // Past the cap the zone is not looked up: the time reads as floating.
    expect(ev?.when).toEqual({ local: "2026-12-01T10:00:00" });
    expect(result.feed.warnings).toContain("unknown_zone");
  });

  it("refuses a calendar that does not finish within the time budget, instead of returning part of it", () => {
    const body = fill(
      (i) => `BEGIN:VEVENT\r\nUID:w${i}\r\nSUMMARY:x\r\nDTSTART;TZID=Europe/Berlin:20260101T100000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU\r\nEND:VEVENT\r\n`,
      CAP - 200 - head.length,
    );
    const { result, ms } = timed(body, { timeBudgetMs: 1 });
    expect(result).toEqual({ ok: false, error: "too_large" });
    expect(ms).toBeLessThan(BOUND_MS);
  }, 60_000);
});
