import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Unmount React trees and reset the DOM between tests. Vitest is configured
// without `globals`, so React Testing Library's auto-cleanup (which relies on a
// global `afterEach`) does not register itself — do it explicitly.
afterEach(() => {
  cleanup();
});
