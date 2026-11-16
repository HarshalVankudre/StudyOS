// @vitest-environment node
// GET /app/insights/export: the period's per-day numbers as a CSV download.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { buildInsights } from "@/lib/study/insights";

const m = vi.hoisted(() => ({
  userId: "user_1" as string | null,
  getInsights: vi.fn(),
  getI18n: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("@/lib/study/insights-store", () => ({ getInsights: m.getInsights }));
vi.mock("@/lib/i18n/server", () => ({ getI18n: m.getI18n }));

import { GET } from "./route";

const get = (query = "") => GET(new Request(`http://localhost/app/insights/export${query}`));

const sample = buildInsights({
  period: "30d",
  today: "2026-11-13",
  timeZone: "UTC",
  studyDays: [
    {
      localDate: "2026-11-13",
      reviews: 9,
      practice: 1,
      newCards: 2,
      reviewTotal: 4,
      reviewPassed: 3,
      quizAnswers: 5,
      quizCorrect: 4,
    },
  ],
  focusDays: [{ localDate: "2026-11-13", seconds: 1500, sessions: 1 }],
  courseStudy: [],
  courseFocus: [],
  courses: [],
  focusStarts: [],
  streakDays: [],
});

beforeEach(() => {
  m.userId = "user_1";
  m.getInsights.mockResolvedValue(sample);
  m.getI18n.mockResolvedValue({ dict: en, locale: "en" });
});

describe("insights CSV export", () => {
  it("downloads the signed-in student's days for the period, never cached", async () => {
    const res = await get("?period=30d");
    expect(res.status).toBe(200);
    expect(m.getInsights).toHaveBeenCalledWith({ period: "30d" });
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="studyos-insights-30d-2026-11-13.csv"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const text = await res.text();
    const lines = text.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "Date,Focus minutes,Focus sessions,Cards reviewed,New cards,Recall rate (%),Quiz answers,Quiz answers right",
    );
    expect(lines).toHaveLength(31);
    expect(lines[1]).toBe("2026-10-15,0,0,0,0,,0,0");
    expect(lines[30]).toBe("2026-11-13,25,1,10,2,75,5,4");
  });

  it("falls back to 7 days for an unknown period", async () => {
    await get("?period=forever");
    expect(m.getInsights).toHaveBeenCalledWith({ period: "7d" });
  });

  it("refuses signed-out requests without reading anything", async () => {
    m.userId = null;
    const res = await get("?period=7d");
    expect(res.status).toBe(401);
    expect(m.getInsights).not.toHaveBeenCalled();
  });

  it("answers 503 when the numbers could not be read", async () => {
    m.getInsights.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
