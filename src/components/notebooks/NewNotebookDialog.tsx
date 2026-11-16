"use client";

/** Create a notebook: name, cover, paper (template, colour, size, orientation) and an optional course. */
import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  COVER_COLORS,
  PAGE_SIZES,
  PAPER_COLORS,
  TEMPLATE_KINDS,
  type CoverColor,
  type NotebookPaper,
  type PageSizeName,
  type PaperColor,
  type TemplateKind,
} from "@/lib/notebooks/model";
import { COVER_HEX } from "./api";
import type { CourseOption } from "./StudyKitDialog";

export interface NewNotebookInput {
  title: string;
  cover: CoverColor;
  paper: NotebookPaper;
  workspaceId: string | null;
}

/** A small SVG preview of a paper template. */
function TemplatePreview({ kind, paper }: { kind: TemplateKind; paper: PaperColor }) {
  const bg = paper === "white" ? "#ffffff" : paper === "cream" ? "#fbf6e8" : "#1d1f23";
  const line = paper === "dark" ? "#4b515b" : "#b9c7da";
  const lines: React.ReactNode[] = [];
  if (kind === "ruled" || kind === "narrow") {
    const step = kind === "ruled" ? 7 : 5.5;
    for (let y = 14; y < 66; y += step) lines.push(<line key={y} x1="0" x2="48" y1={y} y2={y} stroke={line} strokeWidth="0.6" />);
    lines.push(<line key="m" x1="9" x2="9" y1="0" y2="68" stroke="#e8a3a3" strokeWidth="0.6" />);
  } else if (kind === "grid") {
    for (let v = 4; v < 68; v += 4) {
      lines.push(<line key={`h${v}`} x1="0" x2="48" y1={v} y2={v} stroke={line} strokeWidth="0.4" />);
      if (v < 48) lines.push(<line key={`v${v}`} y1="0" y2="68" x1={v} x2={v} stroke={line} strokeWidth="0.4" />);
    }
  } else if (kind === "dots") {
    for (let y = 4; y < 68; y += 4) for (let x = 4; x < 48; x += 4) lines.push(<circle key={`${x}-${y}`} cx={x} cy={y} r="0.5" fill={line} />);
  } else if (kind === "cornell") {
    lines.push(<line key="t" x1="0" x2="48" y1="10" y2="10" stroke={line} strokeWidth="0.8" />);
    lines.push(<line key="c" x1="14" x2="14" y1="10" y2="56" stroke={line} strokeWidth="0.8" />);
    lines.push(<line key="b" x1="0" x2="48" y1="56" y2="56" stroke={line} strokeWidth="0.8" />);
  }
  return (
    <svg viewBox="0 0 48 68" className="h-[68px] w-12 rounded-[3px] shadow-sm ring-1 ring-black/10" aria-hidden>
      <rect width="48" height="68" fill={bg} />
      {lines}
    </svg>
  );
}

export function NewNotebookDialog({
  open,
  onOpenChange,
  courses,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courses: CourseOption[];
  onCreate: (input: NewNotebookInput) => Promise<void>;
}) {
  const { dict } = useI18n();
  const N = dict.notebooks;
  const C = N.create;
  const [title, setTitle] = useState("");
  const [cover, setCover] = useState<CoverColor>("teal");
  const [kind, setKind] = useState<TemplateKind>("ruled");
  const [paperColor, setPaperColor] = useState<PaperColor>("white");
  const [size, setSize] = useState<PageSizeName>("a4");
  const [landscape, setLandscape] = useState(false);
  const [course, setCourse] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onCreate({
        title: title.trim() || C.defaultName,
        cover,
        paper: { template: { kind, paper: paperColor }, size, landscape },
        workspaceId: course || null,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{C.title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">{C.name}</span>
            <Input value={title} maxLength={120} placeholder={C.defaultName} autoFocus onChange={(e) => setTitle(e.target.value)} />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{C.cover}</legend>
            <div className="flex flex-wrap gap-2">
              {COVER_COLORS.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`${C.cover} ${i + 1}`}
                  aria-pressed={cover === c}
                  onClick={() => setCover(c)}
                  className={cn("h-8 w-8 rounded-md transition", cover === c ? "ring-2 ring-lime ring-offset-2 ring-offset-popover" : "hover:scale-105")}
                  style={{ background: COVER_HEX[c] }}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{C.template}</legend>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {TEMPLATE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-md p-2 text-[11px] transition",
                    kind === k ? "bg-lime-faint ring-2 ring-lime" : "hover:bg-hover",
                  )}
                >
                  <TemplatePreview kind={k} paper={paperColor} />
                  {N.templates[k]}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">{C.paperColor}</span>
              <select value={paperColor} onChange={(e) => setPaperColor(e.target.value as PaperColor)} className="h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-sm">
                {PAPER_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {N.papers[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">{C.size}</span>
              <select value={size} onChange={(e) => setSize(e.target.value as PageSizeName)} className="h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-sm">
                {(Object.keys(PAGE_SIZES) as PageSizeName[]).map((s) => (
                  <option key={s} value={s}>
                    {N.sizes[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">{C.orientation}</span>
              <select
                value={landscape ? "l" : "p"}
                onChange={(e) => setLandscape(e.target.value === "l")}
                className="h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-sm"
              >
                <option value="p">{C.portrait}</option>
                <option value="l">{C.landscape}</option>
              </select>
            </label>
          </div>

          {courses.length > 0 && (
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">{C.course}</span>
              <select value={course} onChange={(e) => setCourse(e.target.value)} className="h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-sm">
                <option value="">{C.noCourse}</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon ? `${c.icon} ` : ""}
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="block text-xs text-ink-faint">{C.courseHint}</span>
            </label>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {N.library.cancel}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? C.creating : C.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
