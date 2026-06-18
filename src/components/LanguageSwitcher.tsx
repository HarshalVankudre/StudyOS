"use client";

/**
 * Language selector. Lists every supported locale (flag + native name); picking
 * one writes the locale cookie via the `setLocale` server action, then calls
 * `router.refresh()` so all Server Components (and the <html lang/dir>) re-render
 * in the new language. Used in the landing nav, the app header, the generator
 * header, and the workspace editor.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Languages } from "lucide-react";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { setLocale } from "@/lib/i18n/actions";
import { useI18n } from "@/lib/i18n/client";

export function LanguageSwitcher({
  /** Hide the language name on small screens, showing only the flag. */
  compact = false,
  /** Tune contrast for dark vs light surfaces. */
  tone = "light",
}: {
  compact?: boolean;
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
      await setLocale(code);
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
        aria-label={dict.language.choose}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition disabled:opacity-50 ${triggerTone}`}
      >
        <Languages className="h-4 w-4" aria-hidden />
        <span aria-hidden>{current.flag}</span>
        {!compact && <span className="font-medium">{current.nativeName}</span>}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={dict.language.label}
          className={`absolute z-50 mt-2 max-h-80 w-48 overflow-y-auto rounded-xl border border-ink/10 bg-white p-1 shadow-[0_24px_60px_-28px_rgba(26,23,18,0.45)] ${
            dir === "rtl" ? "left-0" : "right-0"
          }`}
        >
          {LOCALES.map((l) => {
            const active = l.code === locale;
            return (
              <li key={l.code} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => choose(l.code)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                    active
                      ? "bg-ink/[0.06] font-medium text-ink"
                      : "text-ink-soft hover:bg-ink/5 hover:text-ink"
                  }`}
                >
                  <span className="text-base leading-none" aria-hidden>
                    {l.flag}
                  </span>
                  <span className="flex-1 truncate">{l.nativeName}</span>
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
