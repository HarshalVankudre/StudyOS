import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { NotionImportButton } from "./NotionImportButton";
import { NotionImportHost } from "./NotionImportHost";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

describe("Import from Notion entry points", () => {
  // The dialog is loaded on demand, which takes a while on a busy machine.
  it("the home page button opens the dialog the app shell hosts", { timeout: 20_000 }, async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider locale="en" dictionary={en}>
        <NotionImportButton label={en.notionImport.homeButton} />
        <NotionImportHost />
      </I18nProvider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: en.notionImport.homeButton }));
    expect(await screen.findByRole("dialog", { name: en.notionImport.title }, { timeout: 15_000 })).toBeInTheDocument();
  });
});
