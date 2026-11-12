import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { LOCALES } from "@/lib/i18n/config";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/actions", () => ({ setLocale: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/i18n/client", () => ({
  useI18n: () => ({ dict: en, locale: "de", dir: "ltr" }),
}));

import { LanguageSwitcher } from "./LanguageSwitcher";

/** Regional-indicator letters (flag emoji) and the "GB"/"DE" pairs Windows shows instead. */
const FLAG = /[\u{1F1E6}-\u{1F1FF}]/u;

describe("LanguageSwitcher (QA round 3: no flags)", () => {
  it("names the current language and every choice in its own words, with no flags", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);
    const trigger = screen.getByRole("button", { name: `${en.language.choose}: Deutsch` });
    expect(trigger).toHaveTextContent("Deutsch");
    expect(trigger.textContent).not.toMatch(FLAG);
    expect(trigger.textContent).not.toMatch(/\bDE\b/);

    await user.click(trigger);
    const list = screen.getByRole("listbox");
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(LOCALES.map((l) => l.nativeName));
    expect(within(list).getByText("العربية")).toHaveAttribute("lang", "ar");
    for (const o of options) expect(o.textContent).not.toMatch(FLAG);
    expect(list.textContent).not.toMatch(/\b(GB|SA|DE|ES|FR|IT|BR|NL|CN|JP)\b/);
  });

  it("compact: the name is still there (hidden only on phones), never a flag", () => {
    render(<LanguageSwitcher compact />);
    const name = screen.getByTestId("language-current");
    expect(name).toHaveTextContent("Deutsch");
    expect(name.className).toContain("sm:inline");
    expect(screen.getByRole("button").textContent).not.toMatch(FLAG);
  });
});
