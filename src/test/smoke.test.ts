import { describe, expect, it } from "vitest";

describe("test environment", () => {
  it("provides a DOM", () => {
    const element = document.createElement("div");
    element.textContent = "StudyOS";
    expect(element).toHaveTextContent("StudyOS");
  });
});
