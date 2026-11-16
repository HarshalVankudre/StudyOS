/**
 * The withdrawal and cancellation forms: what they hold and how a submission
 * is checked. Pure: the server action validates with it, the client form
 * only uses its types.
 *
 * Only what the law lets us require is required: a name, the contract and
 * the email address for the acknowledgement (and, for an extraordinary
 * cancellation, its reason). Everything else is optional; every field has a
 * length cap.
 */
import { z } from "zod";
import { isPlausibleEmail } from "@/lib/site";
import {
  CANCEL_TYPES,
  CONTRACTS_FOR,
  END_CHOICES,
  NOTICE_LIMITS,
  type CancelType,
  type ContractKind,
  type NoticeKind,
} from "./config";

/** The form's fields as typed (strings, so a form can be shown again exactly as sent). */
export interface NoticeValues {
  name: string;
  email: string;
  /** "pro" | "pack" | "other", or "pack:<ledger id>" for a pack of the signed-in sender. */
  contract: string;
  details: string;
  cancelType: string;
  reason: string;
  endWhen: string;
  endDate: string;
}

export type NoticeField = keyof Omit<NoticeValues, "endWhen">;
export type FieldError = "required" | "invalid" | "tooLong";
export type FieldErrors = Partial<Record<NoticeField, FieldError>>;

/** Field order, for "focus the first error". */
export const FIELD_ORDER: readonly NoticeField[] = [
  "cancelType",
  "reason",
  "name",
  "email",
  "contract",
  "details",
  "endDate",
];

export const EMPTY_VALUES: NoticeValues = {
  name: "",
  email: "",
  contract: "",
  details: "",
  cancelType: "ordinary",
  reason: "",
  endWhen: "earliest",
  endDate: "",
};

/** Longest raw value read from the form; anything longer is cut before validation reports it. */
const RAW_CAP = 5000;

/** The form's values from a submission (missing fields are empty). */
export function readValues(formData: FormData): NoticeValues {
  const read = (name: keyof NoticeValues, fallback = "") => {
    const value = formData.get(name);
    return typeof value === "string" ? value.slice(0, RAW_CAP) : fallback;
  };
  return {
    name: read("name"),
    email: read("email"),
    contract: read("contract"),
    details: read("details"),
    cancelType: read("cancelType", "ordinary"),
    reason: read("reason"),
    endWhen: read("endWhen", "earliest"),
    endDate: read("endDate"),
  };
}

/** A notice that passed validation. */
export interface ValidNotice {
  kind: NoticeKind;
  name: string;
  email: string;
  contractKind: ContractKind;
  /** A credit pack of the signed-in sender (CreditLedger id), when they picked one. */
  packId: string | null;
  details: string | null;
  cancelType: CancelType | null;
  reason: string | null;
  /** YYYY-MM-DD, or null for the earliest possible date. */
  requestedEnd: string | null;
}

export type Validation = { ok: true; notice: ValidNotice } | { ok: false; errors: FieldErrors };

/** One line: control characters and runs of white space become a single space. */
const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
/** Several lines kept, other control characters dropped, at most two blank lines in a row. */
const multiLine = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const PACK_VALUE = /^pack:([A-Za-z0-9_-]{1,64})$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day YYYY-MM-DD. */
function isCalendarDay(value: string): boolean {
  const m = DAY.exec(value);
  if (!m) return false;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.toISOString().slice(0, 10) === value;
}

const text = (max: number) => z.string().max(max);
const email = z
  .string()
  .max(NOTICE_LIMITS.email)
  .pipe(z.email())
  .refine((value) => isPlausibleEmail(value));

/**
 * Check a submission. `today` (YYYY-MM-DD, the operator's day) is the
 * earliest end date a cancellation may ask for.
 */
export function validateNotice(kind: NoticeKind, values: NoticeValues, today: string): Validation {
  const errors: FieldErrors = {};
  const name = oneLine(values.name);
  const address = values.email.trim();
  const details = multiLine(values.details);
  const reason = multiLine(values.reason);

  if (!name) errors.name = "required";
  else if (!text(NOTICE_LIMITS.name).safeParse(name).success) errors.name = "tooLong";

  if (!address) errors.email = "required";
  else if (address.length > NOTICE_LIMITS.email) errors.email = "tooLong";
  else if (!email.safeParse(address).success) errors.email = "invalid";

  let contractKind: ContractKind | null = null;
  let packId: string | null = null;
  const pack = PACK_VALUE.exec(values.contract);
  if (pack && CONTRACTS_FOR[kind].includes("pack")) {
    contractKind = "pack";
    packId = pack[1];
  } else if ((CONTRACTS_FOR[kind] as readonly string[]).includes(values.contract)) {
    contractKind = values.contract as ContractKind;
  }
  if (!values.contract) errors.contract = "required";
  else if (!contractKind) errors.contract = "invalid";

  if (!text(NOTICE_LIMITS.details).safeParse(details).success) errors.details = "tooLong";

  let cancelType: CancelType | null = null;
  let requestedEnd: string | null = null;
  if (kind === "cancellation") {
    const type = z.enum(CANCEL_TYPES).safeParse(values.cancelType);
    if (!type.success) errors.cancelType = "invalid";
    else cancelType = type.data;
    if (cancelType === "extraordinary") {
      if (!reason) errors.reason = "required";
      else if (!text(NOTICE_LIMITS.reason).safeParse(reason).success) errors.reason = "tooLong";
    }
    const when = z.enum(END_CHOICES).safeParse(values.endWhen);
    if (when.success && when.data === "date") {
      const day = values.endDate.trim();
      if (!day) errors.endDate = "required";
      else if (!isCalendarDay(day) || day < today) errors.endDate = "invalid";
      else requestedEnd = day;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    notice: {
      kind,
      name,
      email: address,
      contractKind: contractKind!,
      packId,
      details: details || null,
      cancelType,
      reason: cancelType === "extraordinary" ? reason : null,
      requestedEnd,
    },
  };
}
