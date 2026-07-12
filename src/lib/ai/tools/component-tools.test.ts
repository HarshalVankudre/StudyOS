import { describe, expect, it } from "vitest";
import { createToolRegistry } from "./registry";
import { registerComponentTools } from "./component-tools";

function reg() {
  const r = createToolRegistry();
  registerComponentTools(r);
  return r;
}

describe("check_component", () => {
  it("accepts valid JSX", async () => {
    const out = await reg().run(
      "check_component",
      { source: "function App(){ return <div>hi</div>; }" },
      { taskId: "t" },
    );
    expect(out).toEqual({ ok: true });
  });

  it("reports a compile error for broken JSX", async () => {
    const out = (await reg().run(
      "check_component",
      { source: "function App(){ return <div>; }" },
      { taskId: "t" },
    )) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(typeof out.error).toBe("string");
  });
});
