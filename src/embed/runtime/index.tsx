import React from "react";
import { createRoot } from "react-dom/client";
import * as Recharts from "recharts";
import { transform } from "@babel/standalone";

const errStyle: React.CSSProperties = {
  padding: 16,
  font: "14px system-ui, sans-serif",
  color: "#b91c1c",
};

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return React.createElement(
        "div",
        { style: errStyle },
        "⚠️ This component couldn't render: " + this.state.error.message,
      );
    }
    return this.props.children as React.ReactElement;
  }
}

const root = createRoot(document.getElementById("root")!);

function renderSource(source: string) {
  let code: string | null | undefined;
  try {
    // `runtime: "classic"` emits React.createElement (provided by the closure
    // below). The default "automatic" runtime emits `import ... from
    // "react/jsx-runtime"`, which `new Function` rejects with "Cannot use
    // import statement outside a module" — i.e. every JSX component fails.
    code = transform(source, {
      presets: [["react", { runtime: "classic" }]],
      filename: "component.tsx",
    }).code;
  } catch (e) {
    root.render(
      React.createElement("div", { style: errStyle }, "⚠️ Couldn't compile: " + (e as Error).message),
    );
    return;
  }
  try {
    // Untrusted code — but we are inside the opaque-origin sandbox with a network-locked CSP.
    const factory = new Function(
      "React",
      "Recharts",
      `${code}\nreturn typeof App === "function" ? App : null;`,
    );
    const App = factory(React, Recharts);
    if (!App) throw new Error("source must define a top-level `App` component");
    root.render(React.createElement(ErrorBoundary, null, React.createElement(App)));
  } catch (e) {
    root.render(
      React.createElement(
        "div",
        { style: errStyle },
        "⚠️ This component couldn't render: " + (e as Error).message,
      ),
    );
  }
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window.parent) return;
  const d = ev.data as { type?: string; source?: unknown };
  if (d?.type === "render" && typeof d.source === "string") renderSource(d.source);
});

const post = (m: unknown) => window.parent.postMessage(m, "*");
new ResizeObserver(() =>
  post({ type: "height", px: document.documentElement.scrollHeight }),
).observe(document.documentElement);
post({ type: "ready" });
