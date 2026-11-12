import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { fmt } from "@/lib/i18n/interpolate";
import { MAX_MATERIALS_PER_WORKSPACE } from "@/lib/materials/limits";
import { MaterialApiError } from "./api";

/** Words for a material API error code. */
export function materialErrorMessage(cause: unknown, dict: Dictionary): string {
  const E = dict.materials.errors;
  const code = cause instanceof MaterialApiError ? cause.code : "network";
  switch (code) {
    case "too_large":
      return E.tooLarge;
    case "unsupported":
      return E.unsupported;
    case "no_text":
      return cause instanceof MaterialApiError && cause.kind === "pdf" ? E.scanned : E.noText;
    case "unreadable":
      return E.unreadable;
    case "timeout":
      return E.timeout;
    case "limit":
      return fmt(E.limit, { max: MAX_MATERIALS_PER_WORKSPACE });
    case "storage":
      return E.storage;
    case "busy":
      return E.busy;
    case "rate_limited":
      return E.rateLimited;
    case "not_found":
      return E.notFound;
    case "invalid":
      return E.invalid;
    default:
      return E.network;
  }
}
