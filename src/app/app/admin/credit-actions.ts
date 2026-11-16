"use server";

/**
 * Operator console, Support tools: grant or deduct a student's credits
 * (lib/ops/credit-adjust.ts). Like the console's other actions it re-checks
 * the admin allow-list (lib/ops/admin.ts) and does nothing at all for anyone
 * else. Used with useActionState: every submit carries the form's nonce, so
 * a double submit applies once, and the state hands back the nonce for the
 * next adjustment (a new one once this one is applied).
 */
import { randomUUID } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdmin } from "@/lib/ops/admin";
import {
  ADMIN_ADJUST_MAX,
  ADMIN_NOTE_MAX_CHARS,
  adjustCredits,
  type CreditAdjustment,
} from "@/lib/ops/credit-adjust";
import { reportError } from "@/lib/ops/report-error";

export interface AdjustState {
  status: "idle" | "error" | "done";
  message: string;
  /** The nonce the form's next submit carries. */
  nonce: string;
  /** What the form shows again (its fields reset after every submit): all of it after an error, the user id after a success. */
  values?: { userId: string; amount: string; note: string };
}

const num = (value: number) => value.toLocaleString("en-US");

const adjustInput = z.object({
  userId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{1,64}$/, "Enter a Clerk user id (letters, digits and _, e.g. user_2abc…)."),
  amount: z
    .string()
    .trim()
    .regex(/^[+-]?\d{1,6}$/, "The amount must be a whole number, e.g. 500 or -500.")
    .transform(Number)
    .refine((n) => n !== 0, "The amount must not be zero.")
    .refine((n) => Math.abs(n) <= ADMIN_ADJUST_MAX, `The amount must be at most ${num(ADMIN_ADJUST_MAX)} either way.`),
  note: z
    .string()
    .trim()
    .min(1, "A note is required: say why (e.g. the support ticket).")
    .max(ADMIN_NOTE_MAX_CHARS, `The note must be at most ${ADMIN_NOTE_MAX_CHARS} characters.`),
  nonce: z.string().regex(/^[A-Za-z0-9-]{16,64}$/, "This form is out of date: reload the page."),
});

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** Grant (positive amount) or deduct (negative) credits for one user, once per form nonce. */
export async function adjustCreditsAction(_prev: AdjustState, formData: FormData): Promise<AdjustState> {
  const { userId: adminId } = await auth();
  if (!adminId || !isAdmin(adminId)) return { status: "idle", message: "", nonce: "" };

  const nonce = field(formData, "nonce");
  const values = { userId: field(formData, "userId"), amount: field(formData, "amount"), note: field(formData, "note") };
  // Nothing is written on an error: the same nonce stays valid for the corrected form.
  const error = (message: string): AdjustState => ({ status: "error", message, nonce, values });
  const parsed = adjustInput.safeParse({ ...values, nonce });
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input.");
  const input = parsed.data;

  let result: CreditAdjustment;
  try {
    result = await adjustCredits({ ...input, adminId });
  } catch (err) {
    reportError(err, { source: "billing", route: "adjustCreditsAction", userId: input.userId });
    return error("The adjustment failed and nothing changed. Try again.");
  }

  const done = (message: string): AdjustState => ({
    status: "done",
    message,
    nonce: randomUUID(),
    values: { userId: input.userId, amount: "", note: "" },
  });
  switch (result.outcome) {
    case "unknown_user":
      return error(`No StudyOS account with the id ${input.userId}: nothing changed.`);
    case "deleted_account":
      return error(`The account ${input.userId} was deleted: nothing changed.`);
    case "duplicate":
      return done(
        `Already applied (this form was submitted twice): ${num(Math.abs(result.delta))} credits ${result.delta < 0 ? "deducted from" : "granted to"} ${result.userId} once. Nothing more changed.`,
      );
    case "applied": {
      revalidatePath("/app/admin");
      const { requested, delta, before, after } = result;
      const moved = Math.abs(delta);
      const asked = Math.abs(requested);
      const balance = `Balance ${num(before)} → ${num(after)}.`;
      const message =
        requested > 0
          ? `Granted ${num(moved)} credits to ${input.userId}. ${balance}`
          : moved < asked
            ? `Deducted ${num(moved)} of the ${num(asked)} credits asked from ${input.userId}: the balance was only ${num(before)}, so it is now zero. ${balance}`
            : `Deducted ${num(moved)} credits from ${input.userId}. ${balance}`;
      return done(message);
    }
  }
}
