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

const post = (m: unknown) => window.parent.postMessage(m, "*");

// Handshake. The parent may start listening after this frame has loaded (a
// slow hydration, a deep link on the dev server), so a single "ready" can be
// lost. The frame announces "ready" again on a backoff until a "render"
// arrives (the acknowledgement), and answers the parent's "hello" (sent when
// it starts listening) at once. Only the parent window is ever listened to.
let acknowledged = false;
let lastSource: string | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
const RETRY_MS = [100, 200, 400, 800, 1600, 3200];
function announce(attempt = 0) {
  if (acknowledged) return;
  post({ type: "ready" });
  const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
  // Keep trying for about a minute, then stop: a parent that never answers is gone.
  if (attempt < 25) retry = setTimeout(() => announce(attempt + 1), wait);
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window.parent) return;
  const d = ev.data as { type?: string; source?: unknown };
  if (d?.type === "render" && typeof d.source === "string") {
    acknowledged = true;
    if (retry) clearTimeout(retry);
    // The same component again (a repeated handshake): keep it and its state.
    if (d.source === lastSource) return;
    lastSource = d.source;
    renderSource(d.source);
  } else if (d?.type === "hello") {
    // The parent is listening now. Re-announce even after a render, so a
    // parent that remounted gets its handshake.
    post({ type: "ready" });
  }
});

new ResizeObserver(() =>
  post({ type: "height", px: document.documentElement.scrollHeight }),
).observe(document.documentElement);
announce();
