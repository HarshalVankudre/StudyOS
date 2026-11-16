import { describe, expect, it } from "vitest";
import { NOTICE_LIMITS } from "./config";
import { EMPTY_VALUES, readValues, validateNotice, type NoticeValues } from "./form";

const TODAY = "2026-11-13";
const withdrawal: NoticeValues = { ...EMPTY_VALUES, name: "Ada Lovelace", email: "ada@example.com", contract: "pack" };
const cancellation: NoticeValues = { ...EMPTY_VALUES, name: "Ada Lovelace", email: "ada@example.com", contract: "pro" };

describe("validateNotice", () => {
  it("accepts a withdrawal with only name, email and contract", () => {
    expect(validateNotice("withdrawal", withdrawal, TODAY)).toEqual({
      ok: true,
      notice: {
        kind: "withdrawal",
        name: "Ada Lovelace",
        email: "ada@example.com",
        contractKind: "pack",
        packId: null,
        details: null,
        cancelType: null,
        reason: null,
        requestedEnd: null,
      },
    });
  });

  it("requires exactly the statutory minimum: name, contract and the email for the acknowledgement", () => {
    const result = validateNotice("withdrawal", { ...EMPTY_VALUES }, TODAY);
    expect(result).toEqual({ ok: false, errors: { name: "required", email: "required", contract: "required" } });
  });

  it("refuses an address that is not one, or that could carry a header", () => {
    for (const email of ["ada", "ada@", "a b@example.com", "ada@example.com\r\nBcc: x@y.z", "<ada@example.com>"]) {
      const result = validateNotice("withdrawal", { ...withdrawal, email }, TODAY);
      expect(result, email).toMatchObject({ ok: false, errors: { email: "invalid" } });
    }
  });

  it("caps every field's length", () => {
    const long = (n: number) => "x".repeat(n + 1);
    expect(validateNotice("withdrawal", { ...withdrawal, name: long(NOTICE_LIMITS.name) }, TODAY)).toMatchObject({
      errors: { name: "tooLong" },
    });
    expect(validateNotice("withdrawal", { ...withdrawal, details: long(NOTICE_LIMITS.details) }, TODAY)).toMatchObject({
      errors: { details: "tooLong" },
    });
    expect(
      validateNotice("withdrawal", { ...withdrawal, email: `${"a".repeat(250)}@example.com` }, TODAY),
    ).toMatchObject({ errors: { email: "tooLong" } });
    expect(
      validateNotice("cancellation", { ...cancellation, cancelType: "extraordinary", reason: long(NOTICE_LIMITS.reason) }, TODAY),
    ).toMatchObject({ errors: { reason: "tooLong" } });
    // At the limit is fine.
    expect(validateNotice("withdrawal", { ...withdrawal, name: "x".repeat(NOTICE_LIMITS.name) }, TODAY).ok).toBe(true);
  });

  it("flattens the name to one line and keeps the details' line breaks", () => {
    const result = validateNotice(
      "withdrawal",
      { ...withdrawal, name: "  Ada\r\n\tLovelace ", details: "Bought on 2 Nov\r\n\r\n\r\n\r\nOrder 42\u0007" },
      TODAY,
    );
    expect(result).toMatchObject({ ok: true, notice: { name: "Ada Lovelace", details: "Bought on 2 Nov\n\nOrder 42" } });
  });

  it("knows which contracts each function is for", () => {
    expect(validateNotice("withdrawal", { ...withdrawal, contract: "pack:clx123" }, TODAY)).toMatchObject({
      ok: true,
      notice: { contractKind: "pack", packId: "clx123" },
    });
    // A credit pack is one-off: there is nothing to cancel.
    expect(validateNotice("cancellation", { ...cancellation, contract: "pack" }, TODAY)).toMatchObject({
      errors: { contract: "invalid" },
    });
    expect(validateNotice("cancellation", { ...cancellation, contract: "pack:clx123" }, TODAY)).toMatchObject({
      errors: { contract: "invalid" },
    });
    expect(validateNotice("withdrawal", { ...withdrawal, contract: "pack:../../x" }, TODAY)).toMatchObject({
      errors: { contract: "invalid" },
    });
  });

  it("defaults a cancellation to ordinary, at the earliest possible date", () => {
    expect(validateNotice("cancellation", cancellation, TODAY)).toMatchObject({
      ok: true,
      notice: { cancelType: "ordinary", reason: null, requestedEnd: null, contractKind: "pro" },
    });
  });

  it("asks an extraordinary cancellation for its reason, and drops a reason sent with an ordinary one", () => {
    expect(validateNotice("cancellation", { ...cancellation, cancelType: "extraordinary" }, TODAY)).toMatchObject({
      errors: { reason: "required" },
    });
    expect(
      validateNotice("cancellation", { ...cancellation, cancelType: "extraordinary", reason: "Service unusable" }, TODAY),
    ).toMatchObject({ ok: true, notice: { cancelType: "extraordinary", reason: "Service unusable" } });
    expect(validateNotice("cancellation", { ...cancellation, reason: "just because" }, TODAY)).toMatchObject({
      ok: true,
      notice: { reason: null },
    });
    expect(validateNotice("cancellation", { ...cancellation, cancelType: "sideways" }, TODAY)).toMatchObject({
      errors: { cancelType: "invalid" },
    });
  });

  it("takes a chosen end date from today onwards, ignoring a date when the earliest is chosen", () => {
    const at = (endDate: string) =>
      validateNotice("cancellation", { ...cancellation, endWhen: "date", endDate }, TODAY);
    expect(at("2026-12-31")).toMatchObject({ ok: true, notice: { requestedEnd: "2026-12-31" } });
    expect(at(TODAY)).toMatchObject({ ok: true, notice: { requestedEnd: TODAY } });
    expect(at("")).toMatchObject({ errors: { endDate: "required" } });
    for (const bad of ["2026-11-12", "2026-02-30", "31.12.2026", "2026-13-01"]) {
      expect(at(bad), bad).toMatchObject({ errors: { endDate: "invalid" } });
    }
    expect(
      validateNotice("cancellation", { ...cancellation, endWhen: "earliest", endDate: "2020-01-01" }, TODAY),
    ).toMatchObject({ ok: true, notice: { requestedEnd: null } });
  });

  it("ignores cancellation fields on a withdrawal", () => {
    expect(
      validateNotice("withdrawal", { ...withdrawal, cancelType: "extraordinary", endWhen: "date", endDate: "x" }, TODAY),
    ).toMatchObject({ ok: true, notice: { cancelType: null, reason: null, requestedEnd: null } });
  });
});

describe("readValues", () => {
  it("reads the form's strings, empty when missing, and cuts absurd lengths", () => {
    const data = new FormData();
    data.set("name", "Ada");
    data.set("details", "y".repeat(100_000));
    const values = readValues(data);
    expect(values).toMatchObject({ name: "Ada", email: "", contract: "", cancelType: "ordinary", endWhen: "earliest" });
    expect(values.details.length).toBe(5000);
  });
});
