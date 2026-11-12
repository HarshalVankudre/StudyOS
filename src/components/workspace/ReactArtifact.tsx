"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function clampArtifactHeight(px: number): number {
  return Math.min(2000, Math.max(60, Math.round(px)));
}

export function isFromIframe(ev: MessageEvent, iframe: HTMLIFrameElement | null): boolean {
  return !!iframe && ev.source === iframe.contentWindow;
}

/**
 * An interactive component in a sandboxed frame (src/embed/runtime). The
 * handshake works whichever side is first: the frame announces "ready" (and
 * repeats it until a render arrives), and this side says "hello" when it
 * starts listening and whenever the frame has loaded, which the frame answers
 * with "ready". Every "ready" gets the current source; the frame ignores a
 * source it already shows. Only messages from this frame's own window count.
 */
export function ReactArtifact({ source, title }: { source: string; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const sourceRef = useRef(source);
  // The frame said "ready" at least once since it last loaded.
  const readyRef = useRef(false);

  const post = useCallback((message: unknown) => {
    // The frame has an opaque origin, so its origin cannot be named.
    ref.current?.contentWindow?.postMessage(message, "*");
  }, []);
  const sendRender = useCallback(() => post({ type: "render", source: sourceRef.current }), [post]);
  const hello = useCallback(() => post({ type: "hello" }), [post]);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (!isFromIframe(ev, ref.current)) return;
      const d = ev.data as { type?: string; px?: unknown };
      if (d?.type === "ready") {
        readyRef.current = true;
        sendRender();
      } else if (d?.type === "height" && typeof d.px === "number") {
        setHeight(clampArtifactHeight(d.px));
      }
    }
    window.addEventListener("message", onMessage);
    // Listening now: a "ready" sent before this point was lost, so ask again.
    hello();
    return () => window.removeEventListener("message", onMessage);
  }, [hello, sendRender]);

  // A new source goes to a frame that is already up straight away.
  useEffect(() => {
    if (sourceRef.current === source) return;
    sourceRef.current = source;
    if (readyRef.current) sendRender();
  }, [source, sendRender]);

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
        onLoad={() => {
          // A (re)loaded frame starts empty: it needs its render again.
          readyRef.current = false;
          hello();
        }}
      />
    </figure>
  );
}
