import { describe, expect, it } from "vitest";
import { FALLBACK_SUPPORT_EMAIL } from "@/lib/site";
import { legalNoticeConfigured, operatorDetails, parseAddress, telHref } from "./operator";

const CONFIGURED = {
  STUDYOS_OPERATOR_NAME: "  Example   Learning GmbH ",
  STUDYOS_OPERATOR_ADDRESS: "Musterstraße 1|10115 Berlin|Germany",
};

describe("legal notice operator details", () => {
  it("is not configured without both a name and a postal address", () => {
    expect(operatorDetails({})).toBeNull();
    expect(operatorDetails({ STUDYOS_OPERATOR_NAME: "Example GmbH" })).toBeNull();
    expect(operatorDetails({ STUDYOS_OPERATOR_ADDRESS: "Musterstraße 1" })).toBeNull();
    expect(operatorDetails({ STUDYOS_OPERATOR_NAME: "  ", STUDYOS_OPERATOR_ADDRESS: "Musterstraße 1" })).toBeNull();
    expect(operatorDetails({ STUDYOS_OPERATOR_NAME: "Example GmbH", STUDYOS_OPERATOR_ADDRESS: " | \\n " })).toBeNull();
    expect(legalNoticeConfigured({})).toBe(false);
    expect(legalNoticeConfigured(CONFIGURED)).toBe(true);
  });

  it("parses name and address, leaving optional fields empty", () => {
    expect(operatorDetails(CONFIGURED)).toEqual({
      name: "Example Learning GmbH",
      address: ["Musterstraße 1", "10115 Berlin", "Germany"],
      email: FALLBACK_SUPPORT_EMAIL,
      phone: null,
      register: null,
      vatId: null,
      responsible: null,
    });
  });

  it("splits address lines on line breaks, a literal \\n or |", () => {
    expect(parseAddress("Musterstraße 1\n10115 Berlin\r\nGermany")).toEqual(["Musterstraße 1", "10115 Berlin", "Germany"]);
    expect(parseAddress("Musterstraße 1\\n10115 Berlin\\nGermany")).toEqual(["Musterstraße 1", "10115 Berlin", "Germany"]);
    expect(parseAddress(" Musterstraße 1 ||  10115   Berlin ")).toEqual(["Musterstraße 1", "10115 Berlin"]);
    expect(parseAddress(undefined)).toEqual([]);
  });

  it("uses the operator email, else the support email", () => {
    expect(operatorDetails({ ...CONFIGURED, STUDYOS_OPERATOR_EMAIL: " legal@example.com " })?.email).toBe("legal@example.com");
    expect(operatorDetails({ ...CONFIGURED, STUDYOS_SUPPORT_EMAIL: "help@example.com" })?.email).toBe("help@example.com");
    expect(
      operatorDetails({ ...CONFIGURED, STUDYOS_OPERATOR_EMAIL: "not an address", STUDYOS_SUPPORT_EMAIL: "help@example.com" })?.email,
    ).toBe("help@example.com");
  });

  it("reads the optional fields", () => {
    const details = operatorDetails({
      ...CONFIGURED,
      STUDYOS_OPERATOR_PHONE: "+49 30 1234-567",
      STUDYOS_OPERATOR_REGISTER: "Amtsgericht Berlin-Charlottenburg, HRB 12345",
      STUDYOS_OPERATOR_VAT_ID: "DE123456789",
      STUDYOS_OPERATOR_RESPONSIBLE: "Erika Mustermann",
    });
    expect(details).toMatchObject({
      phone: "+49 30 1234-567",
      register: "Amtsgericht Berlin-Charlottenburg, HRB 12345",
      vatId: "DE123456789",
      responsible: "Erika Mustermann",
    });
    expect(telHref(details!.phone!)).toBe("tel:+49301234567");
  });

  it("ignores absurdly long values", () => {
    expect(operatorDetails({ ...CONFIGURED, STUDYOS_OPERATOR_NAME: "x".repeat(301) })).toBeNull();
    expect(operatorDetails({ ...CONFIGURED, STUDYOS_OPERATOR_VAT_ID: "x".repeat(301) })?.vatId).toBeNull();
  });
});
