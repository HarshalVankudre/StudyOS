import { describe, expect, it } from "vitest";
import { transform } from "@babel/standalone";

/**
 * Locks the JSX-transform contract the embed runtime depends on: it compiles
 * untrusted source with `new Function("React", "Recharts", code)`, so the
 * output MUST use the classic runtime (React.createElement) and MUST NOT emit
 * ES `import`s — those throw "Cannot use import statement outside a module"
 * and break every JSX component. Regression guard for the automatic-runtime
 * default in @babel/standalone v8. This is the fast twin of the browser
 * keystone in e2e/embed-security.e2e.ts.
 */
function compile(source: string): string {
  return (
    transform(source, {
      presets: [["react", { runtime: "classic" }]],
      filename: "component.tsx",
    }).code ?? ""
  );
}

describe("embed JSX transform", () => {
  it("emits React.createElement, not an automatic-runtime import", () => {
    const code = compile("function App(){ return <div>hi {1 + 1}</div>; }");
    expect(code).toContain("React.createElement");
    expect(code).not.toContain("import");
    expect(code).not.toContain("jsx-runtime");
  });

  it("produces source that runs in the runtime's closure shape", () => {
    const code = compile(
      "function App(){ return <button onClick={() => {}}>go</button>; }",
    );
    const factory = new Function(
      "React",
      "Recharts",
      `${code}\nreturn typeof App === "function" ? App : null;`,
    );
    const fakeReact = {
      createElement: (type: unknown, props: unknown, ...kids: unknown[]) => ({
        type,
        props,
        kids,
      }),
    };
    const App = factory(fakeReact, {});
    expect(typeof App).toBe("function");
    const el = App();
    expect(el.type).toBe("button");
  });
});
