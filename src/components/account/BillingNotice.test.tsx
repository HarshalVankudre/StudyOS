import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/lib/i18n/dictionaries/en";
import { de } from "@/lib/i18n/dictionaries/de";
import { BillingNotice, parseBillingNotice } from "./BillingNotice";

describe("parseBillingNotice", () => {
  it("accepts the known codes only", () => {
    expect(parseBillingNotice("unavailable")).toBe("unavailable");
    expect(parseBillingNotice("already_subscribed")).toBe("already_subscribed");
    expect(parseBillingNotice(["error", "x"])).toBe("error");
    expect(parseBillingNotice("<script>")).toBeNull();
    expect(parseBillingNotice(undefined)).toBeNull();
  });
});

describe("BillingNotice", () => {
  it("renders nothing without a code", () => {
    const { container } = render(<BillingNotice code={null} messages={en.billingNotice} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces the translated message as a status", () => {
    render(<BillingNotice code="unavailable" messages={de.billingNotice} />);
    expect(screen.getByRole("status")).toHaveTextContent(de.billingNotice.unavailable);
  });

  it("explains an existing subscription", () => {
    render(<BillingNotice code="already_subscribed" messages={en.billingNotice} />);
    expect(screen.getByRole("status")).toHaveTextContent(/already have an active Pro/);
  });
});
