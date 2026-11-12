import { describe, expect, it } from "vitest";
import { describeLiveStep, liveStepKeys, toolStepInfo, type LiveStepKey } from "./agent-steps";

const labels = new Proxy({} as Record<LiveStepKey, string>, { get: (_t, key) => `<${String(key)}>` });

describe("agent step descriptions", () => {
  it("records the tool and the distinct kinds of change in a batch", () => {
    const info = toolStepInfo(
      "apply_ops",
      { ops: [{ op: "add_row" }, { op: "add_row" }, { op: "update_page" }, { nope: 1 }] },
      { ok: true, opCount: 3 },
    );
    expect(info).toEqual({ tool: "apply_ops", ok: true, ops: ["add_row", "update_page"] });
  });

  it("keeps only the tool name for reading tools (no ids or text)", () => {
    expect(toolStepInfo("read_area", { areaId: "p-1" }, { area: "secret page text" })).toEqual({ tool: "read_area" });
  });

  it("maps operations to friendly keys, without repeats, specific lines first", () => {
    expect(liveStepKeys({ tool: "apply_ops", ok: true, ops: ["add_page", "set_page_blocks", "update_page", "mystery"] })).toEqual([
      "addPage",
      "editPage",
    ]);
    expect(liveStepKeys({ tool: "apply_ops", ok: true, ops: ["mystery"] })).toEqual(["working"]);
    expect(liveStepKeys({ tool: "apply_ops", ok: false, ops: ["add_page"] })).toEqual(["retrying"]);
  });

  it("describes reading, searching and unknown tools neutrally", () => {
    expect(liveStepKeys({ tool: "summarize_workspace" })).toEqual(["reading"]);
    expect(liveStepKeys({ tool: "find_entities" })).toEqual(["finding"]);
    expect(liveStepKeys({ tool: "brand_new_tool" })).toEqual(["working"]);
    expect(liveStepKeys(undefined)).toEqual(["working"]);
  });

  it("joins a batch into one line", () => {
    expect(describeLiveStep({ tool: "apply_ops", ok: true, ops: ["add_row", "delete_row"] }, labels)).toBe(
      "<addRows> · <removeRows>",
    );
  });
});
