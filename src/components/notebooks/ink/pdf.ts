/**
 * PDF page backgrounds (browser only). pdf.js is loaded on first use, so
 * notebooks without imported PDFs never download it; its parser runs in a
 * module worker bundled from pdfjs-dist (same origin: CSP worker-src 'self').
 *
 * Documents are fetched from /api/notebooks/files/:id (owner-scoped,
 * immutable, so the browser cache serves reopenings) and kept open while the
 * notebook is open. Rendered pages are returned as canvases; the engine keeps
 * them in its raster cache.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((mod) => {
    if (!mod.GlobalWorkerOptions.workerPort) {
      mod.GlobalWorkerOptions.workerPort = new Worker(
        new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
        { type: "module" },
      );
    }
    return mod;
  });
  return pdfjsPromise;
}

interface OpenDoc {
  doc: Promise<PDFDocumentProxy>;
  destroy: () => void;
}

const docs = new Map<string, OpenDoc>();

export function fileUrl(fileId: string): string {
  return `/api/notebooks/files/${encodeURIComponent(fileId)}`;
}

function openDoc(fileId: string): Promise<PDFDocumentProxy> {
  let open = docs.get(fileId);
  if (!open) {
    let destroy = () => {};
    const doc = loadPdfJs().then((pdfjs) => {
      // XFA forms off: a lecture PDF only needs its page drawings.
      const task = pdfjs.getDocument({ url: fileUrl(fileId), withCredentials: true, enableXfa: false });
      destroy = () => void task.destroy();
      return task.promise;
    });
    open = { doc, destroy: () => destroy() };
    doc.catch(() => docs.delete(fileId));
    docs.set(fileId, open);
  }
  return open.doc;
}

/**
 * Render one PDF page at `scale` device pixels per page unit. Page units are
 * CSS pixels (96 dpi) and PDF units are points (72 dpi), hence 96/72; the
 * page size the server stored was derived the same way, so the bitmap fills
 * the page exactly.
 */
export async function renderPdfPage(
  fileId: string,
  pageNumber: number,
  pageWidth: number,
  scale: number,
): Promise<HTMLCanvasElement> {
  const doc = await openDoc(fileId);
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: (pageWidth / base.width) * scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  return canvas;
}

/** Close every open document (when the notebook editor unmounts). */
export function closeAllPdfs() {
  for (const open of docs.values()) open.destroy();
  docs.clear();
}
