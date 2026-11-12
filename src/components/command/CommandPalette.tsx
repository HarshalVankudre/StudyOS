"use client";

import {
  ArrowLeft,
  BookOpen,
  Check,
  CircleHelp,
  Database,
  Download,
  FileText,
  Folder,
  Keyboard,
  Languages,
  Layers,
  ListChecks,
  Loader2,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Sunrise,
  Text,
  X,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { setLocale } from "@/lib/i18n/actions";
import { useI18n } from "@/lib/i18n/client";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import type { SearchHit, SearchKind, SearchResults } from "@/lib/search";
import { fold } from "@/lib/search/text";
import { cn } from "@/lib/utils";
import {
  emit,
  modKey,
  OPEN_EXPORT_EVENT,
  OPEN_STUDY_HUB_EVENT,
  SHOW_GETTING_STARTED_EVENT,
} from "./events";

const DEBOUNCE_MS = 180;

/** Top-level /app routes that are not a workspace id. */
const APP_SECTIONS = new Set(["agents", "credits", "settings"]);

/** The workspace id when the current route is /app/<id>, else null. */
export function workspaceIdFromPath(pathname: string | null): string | null {
  const m = /^\/app\/([^/?#]+)/.exec(pathname ?? "");
  if (!m || APP_SECTIONS.has(m[1])) return null;
  return decodeURIComponent(m[1]);
}

type ActionId =
  | "newWorkspace"
  | "today"
  | "settings"
  | "theme"
  | "language"
  | "studyHub"
  | "shortcuts"
  | "export"
  | "gettingStarted";

interface Item {
  id: string;
  group: SearchKind | "actions" | "languages";
  label: string;
  detail?: string;
  icon: React.ReactNode;
  emoji?: string;
  selected?: boolean;
  run: () => void;
}

const KIND_ICON: Record<SearchKind, React.ReactNode> = {
  workspace: <Folder className="h-4 w-4" aria-hidden />,
  page: <FileText className="h-4 w-4" aria-hidden />,
  row: <Database className="h-4 w-4" aria-hidden />,
  block: <Text className="h-4 w-4" aria-hidden />,
  card: <Layers className="h-4 w-4" aria-hidden />,
  question: <CircleHelp className="h-4 w-4" aria-hidden />,
};

type Status = "loading" | "ready" | "error" | "limited";

/**
 * ⌘/Ctrl+K palette: searches every workspace the student owns (on the
 * server) and offers quick actions. Results open the exact place through the
 * deep-link contract /app/<id>?page=…[&block=… | &db=…&row=…].
 */
export function CommandPalette({
  open,
  onOpenChange,
  onShowShortcuts,
  apple,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShowShortcuts: () => void;
  apple: boolean;
}) {
  const { dict, t, locale, plural } = useI18n();
  const C = dict.command;
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [, startTransition] = useTransition();
  const inWorkspace = workspaceIdFromPath(pathname) !== null;

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"main" | "language">("main");
  const [results, setResults] = useState<SearchResults | null>(null);
  // The palette is mounted fresh each time it opens, so state starts clean.
  const [status, setStatus] = useState<Status>("loading");
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // Debounced server search (an empty query lists the workspaces).
  useEffect(() => {
    if (!open || mode !== "main") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (res.status === 429) {
          setStatus("limited");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        setResults((await res.json()) as SearchResults);
        setStatus("ready");
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setStatus("error");
      }
    }, query.trim() ? DEBOUNCE_MS : 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, mode, query]);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const actions = useMemo(() => {
    const dark = resolvedTheme !== "light";
    const list: { id: ActionId; label: string; icon: React.ReactNode; run: () => void; show: boolean }[] = [
      { id: "newWorkspace", label: C.actions.newWorkspace, icon: <Plus className="h-4 w-4" aria-hidden />, run: () => go("/generate"), show: true },
      { id: "today", label: C.actions.today, icon: <Sunrise className="h-4 w-4" aria-hidden />, run: () => go("/app"), show: true },
      {
        id: "studyHub",
        label: C.actions.studyHub,
        icon: <BookOpen className="h-4 w-4" aria-hidden />,
        run: () => {
          close();
          emit(OPEN_STUDY_HUB_EVENT);
        },
        show: inWorkspace,
      },
      { id: "settings", label: C.actions.settings, icon: <Settings className="h-4 w-4" aria-hidden />, run: () => go("/app/settings"), show: true },
      {
        id: "theme",
        label: dark ? C.actions.themeLight : C.actions.themeDark,
        icon: dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />,
        run: () => {
          setTheme(dark ? "light" : "dark");
          close();
        },
        show: true,
      },
      {
        id: "language",
        label: C.actions.language,
        icon: <Languages className="h-4 w-4" aria-hidden />,
        run: () => {
          setMode("language");
          setQuery("");
          setActive(Math.max(0, LOCALES.findIndex((l) => l.code === locale)));
        },
        show: true,
      },
      {
        id: "shortcuts",
        label: C.actions.shortcuts,
        icon: <Keyboard className="h-4 w-4" aria-hidden />,
        run: () => {
          close();
          onShowShortcuts();
        },
        show: true,
      },
      {
        id: "export",
        label: C.actions.export,
        icon: <Download className="h-4 w-4" aria-hidden />,
        run: () => {
          close();
          emit(OPEN_EXPORT_EVENT);
        },
        show: inWorkspace,
      },
      {
        id: "gettingStarted",
        label: C.actions.gettingStarted,
        icon: <ListChecks className="h-4 w-4" aria-hidden />,
        run: () => {
          close();
          emit(SHOW_GETTING_STARTED_EVENT);
        },
        show: inWorkspace,
      },
    ];
    return list.filter((a) => a.show);
  }, [C.actions, close, go, inWorkspace, locale, onShowShortcuts, resolvedTheme, setTheme]);

  const items: Item[] = useMemo(() => {
    const q = fold(query.trim());
    if (mode === "language") {
      return LOCALES.filter((l) => !q || fold(`${l.nativeName} ${l.englishName}`).includes(q)).map((l) => ({
        id: `lang-${l.code}`,
        group: "languages" as const,
        label: l.nativeName,
        detail: l.englishName,
        icon: <span aria-hidden>{l.flag}</span>,
        selected: l.code === locale,
        run: () => {
          close();
          if (l.code === locale) return;
          startTransition(async () => {
            await setLocale(l.code as Locale);
            router.refresh();
          });
        },
      }));
    }
    const out: Item[] = [];
    const matchingActions = actions.filter((a) => !q || q.split(/\s+/).every((w) => fold(a.label).includes(w)));
    // Without a query the actions come first; with one, results lead.
    const actionItems = matchingActions.map((a) => ({
      id: `action-${a.id}`,
      group: "actions" as const,
      label: a.label,
      icon: a.icon,
      run: a.run,
    }));
    if (!q) out.push(...actionItems);
    for (const group of results?.groups ?? []) {
      for (const hit of group.hits) out.push(hitItem(hit));
    }
    if (q) out.push(...actionItems);
    return out;

    function hitItem(hit: SearchHit): Item {
      const where = [hit.context, hit.kind !== "workspace" ? `${hit.workspaceIcon ?? ""} ${hit.workspaceName}`.trim() : ""]
        .filter(Boolean)
        .filter((v, i, all) => all.indexOf(v) === i)
        .join(" · ");
      return {
        id: `${hit.kind}-${hit.href}`,
        group: hit.kind,
        label: hit.title || dict.editor.untitled,
        detail: [hit.snippet, where].filter(Boolean).join(" — "),
        icon: KIND_ICON[hit.kind],
        emoji: hit.kind === "workspace" || hit.kind === "page" ? hit.icon : undefined,
        run: () => go(hit.href),
      };
    }
  }, [actions, close, dict.editor.untitled, go, locale, mode, query, results, router]);

  // Keep the highlighted row valid and visible.
  const activeIndex = items.length === 0 ? -1 : Math.min(active, items.length - 1);
  const activeId = activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined;
  useEffect(() => {
    if (!activeId) return;
    document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + delta + items.length) % items.length);
    } else if (e.key === "Home" && items.length) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && items.length) {
      e.preventDefault();
      setActive(items.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[activeIndex]?.run();
    } else if (e.key === "Backspace" && mode === "language" && query === "") {
      e.preventDefault();
      setMode("main");
      setActive(0);
    }
  };

  // Group consecutive items under one heading.
  const sections: { group: Item["group"]; entries: { item: Item; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const last = sections[sections.length - 1];
    if (last && last.group === item.group) last.entries.push({ item, index });
    else sections.push({ group: item.group, entries: [{ item, index }] });
  });

  const trimmed = query.trim();
  const message =
    mode === "main"
      ? status === "error"
        ? C.error
        : status === "limited"
          ? C.rateLimited
          : status === "ready" && trimmed && (results?.total ?? 0) === 0
            ? t(C.noResults, { query: trimmed })
            : ""
      : "";
  // Announced to screen readers only: progress and result counts.
  const announcement =
    mode !== "main" || message || !trimmed
      ? ""
      : status === "loading"
        ? C.searching
        : plural(dict.counts.results, results?.total ?? 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
        className="top-[max(0.5rem,6dvh)] flex max-h-[min(36rem,86dvh)] w-full max-w-[calc(100%-1rem)] translate-y-0 flex-col gap-0 overflow-hidden border-line-strong bg-card p-0 text-ink shadow-pop sm:top-[12dvh] sm:max-w-xl"
      >
        <DialogTitle className="sr-only">{C.title}</DialogTitle>
        <DialogDescription className="sr-only">{C.footer}</DialogDescription>
        <div className="flex items-center gap-1 border-b border-line ps-2 pe-1">
          {mode === "language" ? (
            <button
              type="button"
              onClick={() => {
                setMode("main");
                setActive(0);
                inputRef.current?.focus();
              }}
              aria-label={C.back}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
            </button>
          ) : (
            <span className="grid h-11 w-9 shrink-0 place-items-center text-ink-faint" aria-hidden>
              {status === "loading" && trimmed ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </span>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              if (mode === "main") setStatus("loading");
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label={mode === "language" ? C.actions.language : C.title}
            placeholder={mode === "language" ? C.actions.language : C.placeholder}
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-12 min-w-0 flex-1 bg-transparent px-1 text-base text-ink outline-none placeholder:text-ink-faint sm:text-sm"
          />
          <button
            type="button"
            onClick={close}
            aria-label={C.close}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-ink-soft transition hover:bg-hover hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div ref={listRef} id={listId} role="listbox" aria-label={C.title} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
          {sections.map((section, si) => {
            const headingId = `${listId}-g-${si}`;
            const heading =
              section.group === "actions"
                ? C.groups.actions
                : section.group === "languages"
                  ? C.groups.languages
                  : C.groups[section.group];
            return (
              <div key={`${section.group}-${si}`} role="group" aria-labelledby={headingId} className="mb-1">
                <div id={headingId} className="px-2.5 pb-1 pt-2 font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  {heading}
                </div>
                {section.entries.map(({ item, index }) => (
                  <div
                    key={item.id}
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    onPointerMove={() => index !== activeIndex && setActive(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => item.run()}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm",
                      index === activeIndex ? "bg-hover text-ink" : "text-ink-soft",
                    )}
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center text-ink-faint">
                      {item.emoji ? <span className="text-base leading-none" aria-hidden>{item.emoji}</span> : item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="block truncate font-medium text-ink">{item.label}</span>
                      {item.detail && <span className="block truncate text-xs text-ink-faint">{item.detail}</span>}
                    </span>
                    {item.selected && <Check className="h-4 w-4 shrink-0 text-lime" aria-hidden />}
                  </div>
                ))}
              </div>
            );
          })}
          <p role="status" aria-live="polite" className="px-3 py-6 text-center text-sm text-ink-soft empty:hidden">
            {message}
          </p>
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </div>

        <div className="hidden items-center justify-between gap-3 border-t border-line px-3 py-2 font-mono text-[11px] text-ink-faint sm:flex">
          <span>{C.footer}</span>
          <span dir="ltr">{modKey("K", apple)}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
