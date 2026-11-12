import { describe, expect, it } from "vitest";
import {
  SAVE_LOG_TABS,
  fateOfSends,
  isSaveLog,
  newSaveId,
  newTabId,
  readSaveLog,
  recordSave,
  serializeSaveLog,
} from "./save-ids";

const TAB = "tab-laptop-1";
const PHONE = "tab-phone-01";

/** The column after a chain of writes, starting from a fresh workspace at version 1. */
function column(writes: Array<[tab?: string, save?: string]>, raw = "", version = 1): { raw: string; version: number } {
  for (const [tab, save] of writes) {
    raw = serializeSaveLog(recordSave(readSaveLog(raw, version), version + 1, tab, save));
    version += 1;
  }
  return { raw, version };
}

describe("the save log", () => {
  it("answers 'landed' for a save of the tab, however many saves other tabs made since", () => {
    let state = column([[TAB, "save-000001"]]); // v2: the laptop's save
    // 500 saves by the phone (the third review: 120 were enough to forget it).
    for (let i = 0; i < 500; i += 1) state = column([[PHONE, `phone-${String(i).padStart(6, "0")}`]], state.raw, state.version);
    const log = readSaveLog(state.raw, state.version);
    expect(fateOfSends(log, state.version, TAB, 1, ["save-000001"])).toEqual({
      fate: "landed",
      saveId: "save-000001",
      version: 2,
    });
    // One entry per tab, not per save.
    expect(Object.keys(log.tabs)).toHaveLength(2);
  });

  it("answers 'none' when the workspace moved on without the save, with certainty", () => {
    const state = column([[PHONE, "phone-000001"], [undefined, undefined], [PHONE, "phone-000002"]]);
    const log = readSaveLog(state.raw, state.version);
    expect(fateOfSends(log, state.version, TAB, 1, ["save-000001", "save-000002"])).toEqual({ fate: "none" });
  });

  it("answers 'pending' while the workspace is still at the save's version", () => {
    const log = readSaveLog("", 1);
    expect(fateOfSends(log, 1, TAB, 1, ["save-000001"])).toEqual({ fate: "pending" });
    // A read that lags behind tells nothing either.
    expect(fateOfSends(log, 1, TAB, 3, ["save-000001"])).toEqual({ fate: "pending" });
  });

  it("answers 'unknown' for versions written by an instance that does not keep the log (a rolling deploy)", () => {
    const before = column([[PHONE, "phone-000001"]]); // v2, logged
    // v3 written by an older build: the document moves on, the column does not.
    const log = readSaveLog(before.raw, 3);
    expect(log.unknownThrough).toBe(3);
    expect(fateOfSends(log, 3, TAB, 2, ["save-000001"])).toEqual({ fate: "unknown" });
    // The next writer of this build records the gap for good...
    const after = serializeSaveLog(recordSave(log, 4, PHONE, "phone-000002"));
    expect(fateOfSends(readSaveLog(after, 4), 4, TAB, 2, ["save-000001"])).toEqual({ fate: "unknown" });
    // ...and saves made on top of it are certain again.
    expect(fateOfSends(readSaveLog(after, 4), 4, TAB, 3, ["save-000001"])).toEqual({ fate: "none" });
  });

  it("treats the previous build's column, a damaged one and an older server's reply as telling nothing", () => {
    const previous = JSON.stringify({ t: 0, s: [["save-000001", 2]] });
    expect(readSaveLog(previous, 5)).toEqual({ v: 2, at: 5, unknownThrough: 5, tabs: {} });
    expect(readSaveLog("{not json", 5).unknownThrough).toBe(5);
    for (const reply of [undefined, null, { through: 0, ids: [["save-000001", 2]] }, "x", { v: 2 }]) {
      expect(isSaveLog(reply)).toBe(false);
      expect(fateOfSends(reply, 5, TAB, 1, ["save-000001"])).toEqual({ fate: "unknown" });
      expect(fateOfSends(reply, 1, TAB, 1, ["save-000001"])).toEqual({ fate: "pending" });
    }
  });

  it("an editor save without a usable tab or save id leaves its version unknown (never 'none' by mistake)", () => {
    for (const [tab, save] of [["", "save-000001"], ["not a token!", "save-000001"], ["tab-1", "short"], ["tab-1", ""]]) {
      const state = column([[tab, save]]); // ids the log cannot record
      const log = readSaveLog(state.raw, state.version);
      expect(log.tabs).toEqual({});
      expect(fateOfSends(log, 2, tab, 1, [save])).toEqual({ fate: "unknown" });
    }
    // A server-side writer passes neither and keeps the log complete.
    const server = column([[undefined, undefined]]);
    expect(readSaveLog(server.raw, server.version).unknownThrough).toBe(1);
  });

  it("forgets the tabs that saved longest ago beyond the cap, and says so", () => {
    let state = column([[TAB, "save-000001"]]);
    for (let i = 0; i < SAVE_LOG_TABS; i += 1) {
      state = column([[`tab-other-${String(i).padStart(4, "0")}`, `other-${String(i).padStart(6, "0")}`]], state.raw, state.version);
    }
    const log = readSaveLog(state.raw, state.version);
    expect(Object.keys(log.tabs)).toHaveLength(SAVE_LOG_TABS);
    expect(log.tabs[TAB]).toBeUndefined();
    expect(log.unknownThrough).toBe(2);
    // The laptop's save can no longer be confirmed: unknown, not "did not land".
    expect(fateOfSends(log, state.version, TAB, 1, ["save-000001"])).toEqual({ fate: "unknown" });
    // A later save of another tab, based on a version after the gap, is still certain.
    expect(fateOfSends(log, state.version, "tab-new-0001", 5, ["save-x00001"])).toEqual({ fate: "none" });
  });

  it("an entry that names one of the saves with an impossible version is not trusted", () => {
    const log = readSaveLog(JSON.stringify({ v: 2, at: 9, u: 1, tabs: { [TAB]: ["save-000001", 7] } }), 9);
    expect(fateOfSends(log, 9, TAB, 1, ["save-000001"])).toEqual({ fate: "unknown" });
  });

  it("makes ids the server accepts", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSaveId()));
    expect(ids.size).toBe(200);
    const log = recordSave(readSaveLog("", 1), 2, newTabId(), newSaveId());
    expect(Object.keys(log.tabs)).toHaveLength(1);
  });
});
