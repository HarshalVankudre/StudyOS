"use client";

/**
 * Notes to study kit: read the notebook's handwriting (pages whose ink
 * changed since they were last read), join it with the text of imported PDF
 * pages, and add the result to a course as study material. The kit itself
 * (flashcards, quiz, notes) is then made in the course with the existing
 * study-kit flow, which shows its price before anything runs. Reading the
 * handwriting uses no credits.
 */
import { useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/interpolate";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError, blobToBase64, jsonInit, patchNotebook } from "./api";
import type { InkEngine } from "./ink/engine";
import type { NotebookSync } from "./sync/sync";

export interface CourseOption {
  id: string;
  name: string;
  icon: string | null;
}

interface PageText {
  id: string;
  position: number;
  pdfText: string;
  inkText: string;
  inkVersion: number;
  inkTextVersion: number;
  strokeCount: number;
}

/** Most text sent as one material (the paste limit of /api/materials). */
const MAX_TEXT = 195_000;

type Phase =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "reading"; done: number; total: number }
  | { kind: "adding" }
  | { kind: "done"; courseId: string; courseName: string; partial: boolean };

export function StudyKitDialog({
  open,
  onOpenChange,
  notebookId,
  title,
  linkedCourseId,
  courses,
  engine,
  sync,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId: string;
  title: string;
  linkedCourseId: string | null;
  courses: CourseOption[];
  engine: InkEngine | null;
  sync: NotebookSync | null;
}) {
  const { dict } = useI18n();
  const S = dict.notebooks.studyKit;
  const [courseId, setCourseId] = useState<string>(
    linkedCourseId && courses.some((c) => c.id === linkedCourseId) ? linkedCourseId : (courses[0]?.id ?? ""),
  );
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = phase.kind === "saving" || phase.kind === "reading" || phase.kind === "adding";
  const base = `/api/notebooks/${encodeURIComponent(notebookId)}`;

  async function run() {
    if (!courseId || !engine || !sync) return;
    try {
      setPhase({ kind: "saving" });
      // Recognition reads the server's ink versions: send the latest strokes first.
      await Promise.race([sync.whenSaved(), new Promise((r) => setTimeout(r, 8000))]);

      let { pages } = await api<{ pages: PageText[] }>(`${base}/text`);
      const stale = pages.filter((p) => p.strokeCount > 0 && p.inkTextVersion !== p.inkVersion);
      let partial = false;
      if (stale.length) {
        setPhase({ kind: "reading", done: 0, total: stale.length });
        await sync.loadInk(stale.map((p) => p.id));
        let done = 0;
        for (const p of stale) {
          const blob = await engine.renderInkImage(p.id);
          if (blob) {
            try {
              const image = await blobToBase64(blob);
              const res = await api<{ text: string }>(
                `${base}/recognize`,
                jsonInit("POST", { pageId: p.id, inkVersion: p.inkVersion, image, mime: "image/jpeg" }),
              );
              p.inkText = res.text;
            } catch (err) {
              if (err instanceof ApiError && (err.status === 503 || err.status === 429)) {
                partial = true;
                if (err.status === 503) toast.message(S.unavailable);
                break;
              }
              partial = true;
            }
          }
          done++;
          setPhase({ kind: "reading", done, total: stale.length });
        }
        // Pick up what was stored (also pages read before an error).
        ({ pages } = await api<{ pages: PageText[] }>(`${base}/text`));
      }

      const text = pages
        .sort((a, b) => a.position - b.position)
        .map((p, i) => {
          const body = [p.pdfText.trim(), p.inkText.trim()].filter(Boolean).join("\n\n");
          return body ? `[${fmt(dict.notebooks.editor.pageNumber, { page: i + 1 })}]\n${body}` : "";
        })
        .filter(Boolean)
        .join("\n\n")
        .slice(0, MAX_TEXT);
      if (text.replace(/\s+/g, "").length < 20) {
        toast.error(text ? S.tooShort : S.nothing);
        setPhase({ kind: "idle" });
        return;
      }

      setPhase({ kind: "adding" });
      await api(`/api/materials`, jsonInit("POST", { workspaceId: courseId, title: title.slice(0, 120), text }));
      if (courseId !== linkedCourseId) void patchNotebook(notebookId, { workspaceId: courseId }).catch(() => {});
      const course = courses.find((c) => c.id === courseId);
      setPhase({ kind: "done", courseId, courseName: course?.name ?? "", partial });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      toast.error(code === "rate_limited" ? dict.notebooks.library.rateLimited : code === "no_text" ? S.tooShort : S.failed);
      setPhase({ kind: "idle" });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) setPhase({ kind: "idle" });
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{S.title}</DialogTitle>
          <DialogDescription>{S.intro}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-ink-faint">{S.free}</p>

        {phase.kind === "done" ? (
          <div className="rounded-md border border-line-strong bg-lime-faint px-4 py-3 text-sm">
            {fmt(S.done, { course: phase.courseName })}
          </div>
        ) : courses.length === 0 ? (
          <div className="space-y-3 text-sm text-ink-soft">
            <p>{S.noCourses}</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/generate">{S.createCourse}</Link>
            </Button>
          </div>
        ) : (
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">{S.course}</span>
            <select
              value={courseId}
              disabled={busy}
              onChange={(e) => setCourseId(e.target.value)}
              className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm"
            >
              <option value="" disabled>
                {S.chooseCourse}
              </option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ""}
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {busy && (
          <p className="flex items-center gap-2 text-sm text-ink-soft" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            {phase.kind === "saving"
              ? S.saving
              : phase.kind === "reading"
                ? fmt(S.recognizing, { done: phase.done, total: phase.total })
                : S.adding}
          </p>
        )}

        <DialogFooter>
          {phase.kind === "done" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {S.close}
              </Button>
              <Button asChild>
                <Link href={`/app/${encodeURIComponent(phase.courseId)}`}>{S.openCourse}</Link>
              </Button>
            </>
          ) : (
            <Button onClick={run} disabled={busy || !courseId || courses.length === 0}>
              {S.start}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
