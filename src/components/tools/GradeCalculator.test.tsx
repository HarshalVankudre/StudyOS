import { readFileSync } from "node:fs";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { de } from "@/lib/i18n/dictionaries/de";
import { en } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { decodeState, MAX_ROWS, START_ROWS } from "@/lib/tools/grade-calculator";
import { GradeCalculator } from "./GradeCalculator";

const T = en.tools.gradeCalculator;
const g = en.grades;
const PATH = "/tools/grade-calculator";

function open(fragment = "", locale: "en" | "de" = "en") {
  window.history.replaceState(null, "", `${PATH}${fragment}`);
  return render(
    <I18nProvider locale={locale} dictionary={locale === "de" ? de : en}>
      <GradeCalculator />
    </I18nProvider>,
  );
}

/** The boxes of row `n` (1-based) while it has no name. */
const box = (column: string, n: number, itemN = T.itemN) => screen.getByRole("textbox", { name: `${column} ${fmt(itemN, { n })}` });
const outlook = () => screen.getByTestId("calc-outlook");

beforeEach(() => {
  window.history.replaceState(null, "", PATH);
});

describe("the grade calculator", () => {
  test("starts with a few empty rows, an empty result and an example to load", () => {
    open();
    expect(screen.getAllByRole("textbox", { name: new RegExp(`^${T.nameColumn}`) })).toHaveLength(START_ROWS);
    expect(outlook()).toHaveTextContent(T.empty);
    expect(outlook()).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("calc-current")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: T.loadExample })).toBeInTheDocument();
  });

  test("typing scores updates the result as you type", async () => {
    const user = userEvent.setup();
    open();
    await user.type(box(g.columns.weight, 1), "60");
    await user.type(box(g.columns.score, 1), "39/50");
    expect(screen.getByTestId("calc-current")).toHaveTextContent("78%");
    await user.type(box(g.columns.weight, 2), "40");
    await user.type(screen.getByRole("textbox", { name: g.target }), "80");

    expect(outlook()).toHaveTextContent(
      fmt(g.outlook.needed, { target: "80%", average: "83%", remaining: "40%" }),
    );
    expect(screen.getByTestId("calc-needed")).toHaveTextContent("83%");
    expect(screen.getByText(fmt(g.decided, { percent: "60%" }), { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
  });

  test("says when the target is secured, and when it is out of reach", async () => {
    const user = userEvent.setup();
    open("#t=85&r=90~100~&r=10~~");
    expect(outlook()).toHaveTextContent(fmt(g.outlook.secured, { target: "85%" }));
    expect(screen.getByTestId("calc-needed")).toHaveTextContent(T.securedValue);

    const score = box(g.columns.score, 1);
    await user.clear(score);
    await user.type(score, "50");
    expect(screen.getByTestId("calc-needed")).toHaveTextContent(T.unreachableValue);
    expect(outlook()).toHaveTextContent(
      fmt(g.outlook.unreachable, { target: "85%", average: "400%", best: "55%" }),
    );
  });

  test("explains the assumptions it made", () => {
    open("#r=30~80~&r=40~~");
    expect(screen.getByText(fmt(g.notes.weightsUnder, { sum: "70%" }))).toBeInTheDocument();
  });

  test("points out an unreadable score once you leave the box", async () => {
    const user = userEvent.setup();
    open();
    const score = box(g.columns.score, 1);
    await user.type(score, "abc");
    const message = fmt(g.invalidScore, { text: "abc" });
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(score).toHaveAttribute("aria-invalid", "true");
  });

  test("loads an example in the chosen scale", async () => {
    const user = userEvent.setup();
    open();
    await user.selectOptions(screen.getByRole("combobox", { name: g.scaleLabel }), "us_letter");
    await user.click(screen.getByRole("button", { name: T.loadExample }));

    const names = en.landing.samples.grades;
    expect(screen.getByRole("textbox", { name: `${T.nameColumn} ${fmt(T.itemN, { n: 1 })}` })).toHaveValue(names.problemSets);
    expect(screen.getByRole("textbox", { name: `${g.columns.score} ${names.midterm}` })).toHaveValue("65/80");
    expect(screen.getByRole("combobox", { name: g.target })).toHaveValue("87");
    expect(screen.getByTestId("calc-current")).toHaveTextContent("B");
    expect(outlook()).toHaveTextContent(fmt(g.outlook.needed, { target: "B+ (87%)", average: "87.7%", remaining: "40%" }));
    // An example never replaces the student's own numbers: it is offered only while there are none.
    expect(screen.queryByRole("button", { name: T.loadExample })).not.toBeInTheDocument();
  });

  test("adds and removes rows, keeping focus in the list", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: T.addRow }));
    const added = screen.getByRole("textbox", { name: `${T.nameColumn} ${fmt(T.itemN, { n: START_ROWS + 1 })}` });
    expect(added).toHaveFocus();

    const remove = screen.getAllByRole("button", { name: fmt(g.categories.remove, { name: fmt(T.itemN, { n: 1 }) }) });
    await user.click(remove[0]);
    expect(screen.getAllByRole("textbox", { name: new RegExp(`^${T.nameColumn}`) })).toHaveLength(START_ROWS);
    expect(document.activeElement).toHaveAccessibleName(fmt(g.categories.remove, { name: fmt(T.itemN, { n: 1 }) }));
  });

  test("stops adding rows at the maximum", async () => {
    const user = userEvent.setup();
    open(`#${Array.from({ length: MAX_ROWS - 1 }, () => "r=1~~").join("&")}`);
    const add = screen.getByRole("button", { name: T.addRow });
    await user.click(add);
    expect(add).toBeDisabled();
    expect(screen.getByText(fmt(T.maxRows, { max: MAX_ROWS }))).toBeInTheDocument();
  });

  test("keeps the calculation in the address, never in storage or cookies", async () => {
    const user = userEvent.setup();
    open();
    await user.type(box(T.nameColumn, 1), "Midterm");
    await user.type(screen.getByRole("textbox", { name: `${g.columns.weight} Midterm` }), "25");
    await user.type(screen.getByRole("textbox", { name: `${g.columns.score} Midterm` }), "42/50");
    await waitFor(() => expect(window.location.hash).toBe("#m=course&r=25~42/50~Midterm"));
    expect(window.location.pathname).toBe(PATH);
    expect(document.cookie).toBe("");
    // The privacy policy lists what the site stores; this page must not add to it.
    for (const file of ["./GradeCalculator.tsx", "../../lib/tools/grade-calculator.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
    }
  });

  test("opens a shared link as it was", () => {
    open("#s=uk_degree&t=60&r=50~72~Essay&r=50~~Exam");
    expect(screen.getByRole("combobox", { name: g.scaleLabel })).toHaveValue("uk_degree");
    expect(screen.getByRole("combobox", { name: g.target })).toHaveValue("60");
    expect(screen.getByRole("textbox", { name: `${g.columns.score} Essay` })).toHaveValue("72");
    expect(screen.getByTestId("calc-current")).toHaveTextContent(g.uk.first);
  });

  test("a hostile link cannot blow up the page", () => {
    const junk = Array.from({ length: 3_000 }, (_, i) => `r=${"9".repeat(50)}~%E0%A4~${"<b>x</b>".repeat(40)}${i}`).join("&");
    const { container } = open(`#s=__proto__&t=%ZZ&${junk}`);
    expect(screen.getAllByRole("textbox", { name: new RegExp(`^${T.nameColumn}`) }).length).toBeLessThanOrEqual(MAX_ROWS);
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByRole("combobox", { name: g.scaleLabel })).toHaveValue("percent");
  });

  test("follows a link pasted into the same tab", async () => {
    open();
    await act(async () => {
      window.history.replaceState(null, "", `${PATH}#r=100~91~Thesis`);
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(screen.getByRole("textbox", { name: `${g.columns.score} Thesis` })).toHaveValue("91");
  });

  test("copies a link that opens the same calculation", async () => {
    // user-event puts a working clipboard in place of the browser's.
    const user = userEvent.setup();
    open("#t=80&r=60~78~Midterm&r=40~~Final");
    await user.click(screen.getByRole("button", { name: en.share.copy }));

    const url = new URL(await navigator.clipboard.readText());
    expect(url.pathname).toBe(PATH);
    expect(decodeState(url.hash, "ects")).toEqual(decodeState("#t=80&r=60~78~Midterm&r=40~~Final", "course"));
    expect(within(screen.getByTestId("calc-result")).getByRole("status")).toHaveTextContent(en.share.copied);
  });

  test("says so when the link cannot be copied", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    open("#r=100~90~Exam");
    await user.click(screen.getByRole("button", { name: en.share.copy }));
    expect(await screen.findByText(T.copyFailed)).toBeInTheDocument();
  });
});

describe("the German grade average (Notenschnitt)", () => {
  const D = de.tools.gradeCalculator;
  const DE = D.ects;
  /** Row `n`'s credits and grade boxes in German, while it has no name. */
  const lp = (n: number) => box(DE.ectsColumn, n, D.itemN);
  const note = (n: number) => box(DE.gradeColumn, n, D.itemN);

  test("is where German visitors start; everyone else starts with one course and can switch", async () => {
    const user = userEvent.setup();
    const { unmount } = open("", "de");
    expect(screen.getByRole("radio", { name: D.modes.ects })).toBeChecked();
    expect(screen.getByRole("heading", { level: 2, name: DE.workTitle })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: D.modeLegend })).toBeInTheDocument();
    expect(screen.getByTestId("calc-rule")).toHaveTextContent(DE.rule);
    unmount();

    open();
    expect(screen.getByRole("radio", { name: T.modes.course })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: T.modes.ects }));
    expect(screen.getByRole("heading", { level: 2, name: T.ects.workTitle })).toBeInTheDocument();
    // An English link to the German mode says so, so it opens the same way anywhere.
    await waitFor(() => expect(window.location.hash).toBe("#m=ects"));
  });

  test("typing 9 LP and 1,7 gives the Schnitt, weighted by credits and cut after one decimal", async () => {
    const user = userEvent.setup();
    open("", "de");
    await user.type(lp(1), "9");
    await user.type(note(1), "1,7");
    expect(screen.getByTestId("calc-current")).toHaveTextContent("1,7");

    // (1,7 x 9 + 2,3 x 6) / 15 = 1,94: shown as 1,9, never rounded up to 2,0.
    await user.type(lp(2), "6");
    await user.type(note(2), "2,3");
    expect(screen.getByTestId("calc-current")).toHaveTextContent("1,9");
    expect(screen.getByText(fmt(DE.unrounded, { value: "1,94" }))).toBeInTheDocument();
    expect(screen.getByText(fmt(DE.ectsDone, { earned: "15", open: "0" }))).toBeInTheDocument();
  });

  test("a grade that is not a German grade is pointed out, not read as a percentage", async () => {
    const user = userEvent.setup();
    open("", "de");
    await user.type(lp(1), "6");
    await user.type(note(1), "87");
    await user.tab();
    expect(screen.getByText(fmt(DE.invalidGrade, { text: "87" }))).toBeInTheDocument();
    expect(note(1)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("calc-current")).toHaveTextContent("—");
  });

  test("a 5,0 is shown as not passed and left out of the Schnitt", () => {
    open("#m=ects&r=9~2,3~Mathe&r=6~5,0~Theo", "de");
    expect(screen.getAllByText(DE.failedTag)).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: `${DE.gradeColumn} Theo` })).toHaveAccessibleDescription(DE.failedTag);
    expect(screen.getByTestId("calc-current")).toHaveTextContent("2,3");
    expect(screen.getByText(fmt(DE.notes.failed, { count: 1 }))).toBeInTheDocument();
    expect(screen.getByText(fmt(DE.ectsDone, { earned: "9", open: "0" }))).toBeInTheDocument();
  });

  test("says what the open modules need for a target picked from the list", async () => {
    const user = userEvent.setup();
    open("#m=ects&r=9~2,3~Mathe&r=6~1,7~Prog&r=6~5,0~Theo&r=6~2,0~DB&r=6~~Stat&r=9~~SWT", "de");
    expect(screen.getByTestId("calc-outlook")).toHaveTextContent(DE.outlook.pick);
    await user.selectOptions(screen.getByRole("combobox", { name: DE.targetLabel }), "2.0");
    expect(screen.getByTestId("calc-needed")).toHaveTextContent("2,1");
    expect(screen.getByTestId("calc-outlook")).toHaveTextContent(
      fmt(DE.outlook.needed, { target: "2,0", grade: "2,1", open: "15" }),
    );
  });

  test("secured and out of reach", () => {
    const { unmount } = open("#m=ects&t=4.0&r=6~~Statistik", "de");
    expect(screen.getByTestId("calc-needed")).toHaveTextContent(D.securedValue);
    expect(screen.getByTestId("calc-outlook")).toHaveTextContent(fmt(DE.outlook.secured, { target: "4,0" }));
    unmount();

    open("#m=ects&t=1.5&r=150~3,0~Bisher&r=30~~Rest", "de");
    expect(screen.getByTestId("calc-needed")).toHaveTextContent(D.unreachableValue);
    expect(screen.getByTestId("calc-outlook")).toHaveTextContent(fmt(DE.outlook.unreachable, { target: "1,5", best: "2,6" }));
  });

  test("loads a German Bachelor as the example", async () => {
    const user = userEvent.setup();
    open("", "de");
    await user.click(screen.getByRole("button", { name: D.loadExample }));
    expect(screen.getByRole("textbox", { name: `${DE.moduleColumn} ${fmt(D.itemN, { n: 1 })}` })).toHaveValue(DE.example.math);
    expect(screen.getByRole("textbox", { name: `${DE.gradeColumn} ${DE.example.math}` })).toHaveValue("2,3");
    expect(screen.getByText(DE.failedTag)).toBeInTheDocument();
    expect(screen.getByTestId("calc-current")).toHaveTextContent("2,0");
    expect(screen.getByTestId("calc-outlook")).toHaveTextContent(fmt(DE.outlook.needed, { target: "2,0", grade: "2,1", open: "15" }));
  });

  test("the address carries the German mode and opens it the same way in English", async () => {
    const user = userEvent.setup();
    const { unmount } = open("", "de");
    await user.type(screen.getByRole("textbox", { name: `${DE.moduleColumn} ${fmt(D.itemN, { n: 1 })}` }), "Analysis");
    await user.type(screen.getByRole("textbox", { name: `${DE.ectsColumn} Analysis` }), "9");
    await user.type(screen.getByRole("textbox", { name: `${DE.gradeColumn} Analysis` }), "1,3");
    await user.selectOptions(screen.getByRole("combobox", { name: DE.targetLabel }), "1.5");
    await waitFor(() => expect(window.location.hash).toBe("#m=ects&t=1.5&r=9~1,3~Analysis"));
    const fragment = window.location.hash;
    unmount();

    open(fragment, "en");
    expect(screen.getByRole("radio", { name: T.modes.ects })).toBeChecked();
    expect(screen.getByRole("textbox", { name: `${T.ects.gradeColumn} Analysis` })).toHaveValue("1,3");
    expect(screen.getByRole("combobox", { name: T.ects.targetLabel })).toHaveValue("1.5");
    expect(screen.getByTestId("calc-current")).toHaveTextContent("1.3");
  });
});
