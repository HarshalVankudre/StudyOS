import { describe, expect, it } from "vitest";
import { feedSecrets, readFeed } from "./normalize";

/**
 * Token scrubbing against the encoded forms the second security review used
 * to slip a feed's secret past the redaction (probe sec2/feeds/secret.probe.ts).
 * The leak check is the probe's: the lowercased JSON of the whole result must
 * not contain the token, its upper-case form, its percent-encoded form, or
 * either half of it.
 */
const NOW = Date.parse("2026-11-12T00:00:00Z");
const TOK = "0123456789abcdef0123456789abcdef";
const MOODLE = `https://moodle.univ-example.edu/calendar/export_execute.php?userid=42&authtoken=${TOK}&preset_what=all&preset_time=recentupcoming`;
const CANVAS_TOK = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";
const CANVAS = `https://canvas.univ-example.edu/feeds/calendars/user_${CANVAS_TOK}.ics`;
const GOOGLE = `https://calendar.google.com/calendar/ical/student%40univ-example.edu/private-${"f".repeat(32)}/basic.ics`;
const PCT = TOK.split("")
  .map((c) => "%" + c.charCodeAt(0).toString(16))
  .join("");

const PRODID: Record<string, string> = {
  [MOODLE]: "-//Moodle Pty Ltd//NONSGML Moodle Version 2024//EN",
  [CANVAS]: "-//Instructure//Canvas//EN",
  [GOOGLE]: "-//Google Inc//Google Calendar 70.9054//EN",
};

function cal(url: string, vevent: string, extra = "") {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:${PRODID[url]}\r\n${extra}${vevent}END:VCALENDAR\r\n`;
}
const ev = (props: string, uid = "ev0@probe") =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:20261201T100000Z\r\n${props}END:VEVENT\r\n`;

function leaks(json: string, url: string): string[] {
  const tokens =
    url === MOODLE
      ? [TOK, TOK.slice(0, 16), TOK.slice(16), PCT, TOK.toUpperCase()]
      : url === CANVAS
        ? [CANVAS_TOK, CANVAS_TOK.slice(0, 20), CANVAS_TOK.slice(20)]
        : ["f".repeat(32), "f".repeat(16)];
  const lower = json.toLowerCase();
  return tokens.filter((t) => lower.includes(t.toLowerCase()));
}

const CASES: [string, string, string, string?][] = [
  ["raw token in summary", MOODLE, ev(`SUMMARY:See authtoken ${TOK} here\r\n`)],
  ["full link in summary", MOODLE, ev(`SUMMARY:Feed ${MOODLE}\r\n`)],
  ["percent-encoded token in summary", MOODLE, ev(`SUMMARY:tok ${PCT}\r\n`)],
  ["uppercase token", MOODLE, ev(`SUMMARY:tok ${TOK.toUpperCase()}\r\n`)],
  ["token with zero-width space", MOODLE, ev(`SUMMARY:tok ${TOK.slice(0, 16)}​${TOK.slice(16)}\r\n`)],
  ["token with soft hyphen and word joiner", MOODLE, ev(`SUMMARY:tok ${TOK.slice(0, 8)}­${TOK.slice(8, 20)}⁠${TOK.slice(20)}\r\n`)],
  ["token split by escaped comma", MOODLE, ev(`SUMMARY:tok ${TOK.slice(0, 16)}\\,${TOK.slice(16)}\r\n`)],
  ["token split by escaped semicolon", MOODLE, ev(`SUMMARY:tok ${TOK.slice(0, 16)}\\;${TOK.slice(16)}\r\n`)],
  ["full-width digits", MOODLE, ev(`SUMMARY:tok ${TOK.replace(/[0-9]/g, (d) => String.fromCharCode(0xff10 + Number(d)))}\r\n`)],
  ["token split across fold", MOODLE, ev(`SUMMARY:tok ${TOK.slice(0, 16)}\r\n ${TOK.slice(16)}\r\n`)],
  ["token straddling the 500-char clip", MOODLE, ev(`SUMMARY:${"a".repeat(480)}${TOK}\r\n`)],
  ["token in UID", MOODLE, ev("SUMMARY:x\r\n", `${TOK}@moodle`)],
  ["percent-encoded token in UID", MOODLE, ev("SUMMARY:x\r\n", `${PCT}@moodle`)],
  ["token in CATEGORIES (moodle course)", MOODLE, ev(`SUMMARY:Quiz is due\r\nCATEGORIES:${TOK}\r\n`)],
  ["token in URL prop", MOODLE, ev(`SUMMARY:x\r\nURL:https://other.example.org/?t=${TOK}\r\n`)],
  ["percent-encoded token in URL prop", MOODLE, ev(`SUMMARY:x\r\nURL:https://other.example.org/?t=${PCT}\r\n`)],
  ["token in description link (moodle)", MOODLE, ev(`SUMMARY:x\r\nDESCRIPTION:open https://moodle.univ-example.edu/mod/x?authtoken=${TOK}\r\n`)],
  ["html-escaped link in summary", MOODLE, ev(`SUMMARY:${MOODLE.replace(/&/g, "&amp;")}\r\n`)],
  ["canvas token in summary", CANVAS, ev(`SUMMARY:user_${CANVAS_TOK}\r\n`)],
  ["bare canvas token", CANVAS, ev(`SUMMARY:${CANVAS_TOK}\r\n`)],
  ["bare canvas token mid-text", CANVAS, ev(`SUMMARY:x ${CANVAS_TOK} y\r\n`)],
  ["lowercased canvas token", CANVAS, ev(`SUMMARY:x ${CANVAS_TOK.toLowerCase()} y\r\n`)],
  ["google private token", GOOGLE, ev(`SUMMARY:private-${"f".repeat(32)}\r\n`)],
  ["google private token alone", GOOGLE, ev(`SUMMARY:key ${"f".repeat(32)}\r\n`)],
  ["token in X-WR-CALNAME", MOODLE, ev("SUMMARY:x\r\n"), `X-WR-CALNAME:cal ${TOK}\r\n`],
];

describe("feed secret scrubbing", () => {
  it.each(CASES)("%s: nothing leaks", (_name, url, vevent, extra) => {
    const result = readFeed(cal(url, vevent, extra), { now: NOW, feedUrl: url });
    expect(result.ok).toBe(true);
    expect(leaks(JSON.stringify(result), url)).toEqual([]);
  });

  it("names the bare token forms as secrets", () => {
    expect(feedSecrets(CANVAS)).toContain(CANVAS_TOK);
    expect(feedSecrets(GOOGLE)).toContain("f".repeat(32));
    expect(feedSecrets(MOODLE)).toContain(TOK);
  });

  it("keeps ordinary titles intact", () => {
    const result = readFeed(cal(MOODLE, ev("SUMMARY:Essay 2: calendar export of chapter 4 is due\r\n")), {
      now: NOW,
      feedUrl: MOODLE,
    });
    expect(result.ok && result.feed.events[0].title).toBe("Essay 2: calendar export of chapter 4");
  });

  it("hashes a secret-bearing UID stably, keeping occurrence keys tied to their series", () => {
    const uid = `${TOK}@moodle`;
    const text = cal(
      MOODLE,
      `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:Lecture\r\nDTSTART:20261201T100000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEND:VEVENT\r\n`,
    );
    const a = readFeed(text, { now: NOW, feedUrl: MOODLE });
    const b = readFeed(text, { now: NOW, feedUrl: MOODLE });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.feed.events.map((e) => e.key)).toEqual(b.feed.events.map((e) => e.key));
    expect(a.feed.events).toHaveLength(3);
    for (const e of a.feed.events) {
      expect(e.series).toMatch(/^h-/);
      // The sync flags a missing occurrence only when its key's prefix is not a followed series.
      expect(e.key.slice(0, e.key.indexOf("#"))).toBe(e.series);
    }
    expect(leaks(JSON.stringify(a), MOODLE)).toEqual([]);
  });

  it("leaves UIDs without a secret unchanged", () => {
    const result = readFeed(cal(CANVAS, ev("SUMMARY:Essay\r\n", "event-assignment-123")), { now: NOW, feedUrl: CANVAS });
    expect(result.ok && result.feed.events[0].key).toBe("event-assignment-123");
  });
});
