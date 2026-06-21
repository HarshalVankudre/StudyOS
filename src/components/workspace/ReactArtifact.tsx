"use client";
import { useEffect, useRef, useState } from "react";

export function clampArtifactHeight(px: number): number {
  return Math.min(2000, Math.max(60, Math.round(px)));
}

export function isFromIframe(ev: MessageEvent, iframe: HTMLIFrameElement | null): boolean {
  return !!iframe && ev.source === iframe.contentWindow;
}

export function ReactArtifact({ source, title }: { source: string; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const iframe = ref.current;
      if (!isFromIframe(ev, iframe)) return;
      const d = ev.data as { type?: string; px?: unknown };
      if (d?.type === "ready") {
        iframe!.contentWindow?.postMessage({ type: "render", source }, "*");
      } else if (d?.type === "height" && typeof d.px === "number") {
        setHeight(clampArtifactHeight(d.px));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [source]);

  return (
    <figure className="my-3">
      {title ? <figcaption className="mb-1 text-xs text-ink-soft">{title}</figcaption> : null}
      {/* allow-scripts WITHOUT allow-same-origin => opaque origin (no parent access). */}
      <iframe
        ref={ref}
        src="/embed/react"
        sandbox="allow-scripts"
        title={title ?? "Interactive component"}
        style={{ width: "100%", height, border: 0 }}
        className="rounded-md border border-line bg-white"
      />
    </figure>
  );
}
