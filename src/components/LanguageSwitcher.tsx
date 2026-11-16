"use client";

/**
 * Language selector. Lists every supported locale by its own name (no flags); picking
 * one writes the locale cookie via the `setLocale` server action, then calls
 * `router.refresh()` so all Server Components (and the <html lang/dir>) re-render
 * in the new language. Used in the landing nav, the app header, the generator
 * header, and the workspace editor.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Languages } from "lucide-react";
import { toast } from "sonner";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { setLocale } from "@/lib/i18n/actions";
import { useI18n } from "@/lib/i18n/client";

export function LanguageSwitcher({
  /** On phones show only the languages icon (the name from `sm` up). */
  compact = false,
  /** Never show the name: for narrow places such as the workspace sidebar. */
  iconOnly = false,
  /** Where the list opens: "above" for a trigger at the bottom of the screen. */
  menu = "below",
  /** Tune contrast for dark vs light surfaces. */
  tone = "light",
}: {
  compact?: boolean;
  iconOnly?: boolean;
  menu?: "below" | "above";
  tone?: "light" | "dark";
}) {
  const router = useRouter();
  const { locale, dict, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (code: Locale) => {
    setOpen(false);
    if (code === locale) return;
    startTransition(async () => {
      try {
        await setLocale(code);
      } catch {
        // Offline, or the app was updated meanwhile: the language stays as it
        // is. Thrown inside this transition it would replace the page with the
        // error screen. (The toast shows on pages that have a toaster.)
        toast.error(dict.safety.actionFailed);
        return;
      }
      router.refresh();
    });
  };

  const triggerTone =
    tone === "dark"
      ? "border-paper/20 text-paper/80 hover:border-paper/50 hover:text-paper"
      : "border-ink/15 text-ink-soft hover:border-ink/40 hover:text-ink";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${dict.language.choose}: ${current.nativeName}`}
        className={`flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border text-sm transition disabled:opacity-50 ${
          iconOnly ? "w-9 justify-center" : "px-3 py-1.5"
        } ${triggerTone}`}
      >
        <Languages className="h-4 w-4 shrink-0" aria-hidden />
        {/* The language's own name, never a flag (Windows shows flags as "GB"). */}
        <span
          lang={current.code}
          dir="auto"
          className={
            iconOnly ? "hidden" : compact ? "hidden max-w-[7rem] truncate font-medium sm:inline" : "font-medium"
          }
          data-testid="language-current"
        >
          {current.nativeName}
        </span>
        {!iconOnly && (
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        )}
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={dict.language.label}
          className={`absolute z-50 max-h-80 w-48 overflow-y-auto rounded-2xl border border-ink/10 bg-card p-1 shadow-pop ${
            menu === "above" ? "bottom-full mb-2" : "mt-2"
          } ${dir === "rtl" ? "left-0" : "right-0"}`}
        >
          {LOCALES.map((l) => {
            const active = l.code === locale;
            return (
              <li key={l.code} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => choose(l.code)}
                  className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm transition ${
                    active
                      ? "bg-ink/[0.06] font-medium text-ink"
                      : "text-ink-soft hover:bg-ink/5 hover:text-ink"
                  }`}
                >
                  <span lang={l.code} dir="auto" className="flex-1 truncate">
                    {l.nativeName}
                  </span>
                  {active && <Check className="h-4 w-4 shrink-0" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
