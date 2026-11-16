import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";

const nav = vi.hoisted(() => ({ pathname: "/app" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("@/lib/i18n/client", () => ({ useI18n: () => ({ dict: en, locale: "en" }) }));

import { AppNav, activeSection } from "./AppNav";

const HREFS = ["/app", "/app/agenda", "/app/insights", "/app/grades", "/app/agents"];

describe("activeSection", () => {
  it("marks Today only on /app itself, and a section on its own pages", () => {
    expect(activeSection("/app", HREFS)).toBe("/app");
    expect(activeSection("/app/", HREFS)).toBe("/app");
    expect(activeSection("/app/insights", HREFS)).toBe("/app/insights");
    expect(activeSection("/app/grades/anything", HREFS)).toBe("/app/grades");
    // A workspace is not a section.
    expect(activeSection("/app/abc123", HREFS)).toBeNull();
    expect(activeSection("/app/agendas", HREFS)).toBeNull();
  });
});

describe("AppNav", () => {
  it("links every section and marks the current one", () => {
    nav.pathname = "/app/agenda";
    render(<AppNav />);
    const navigation = screen.getByRole("navigation", { name: en.shell.appNav });
    expect(navigation).toBeInTheDocument();
    for (const name of [en.today.title, en.agenda.label, en.insights.label, en.gradesOverview.label, en.agentCenter.label]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: en.agenda.label })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: en.today.title })).not.toHaveAttribute("aria-current");
  });
});
