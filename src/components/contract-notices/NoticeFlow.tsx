"use client";

/**
 * The two-step withdrawal / cancellation flow (/withdraw, /cancel): the form,
 * the review with the statutory confirm button, and the receipt. Driven by
 * one server action through useActionState, so every step also works before
 * JavaScript has loaded (the form posts and the page renders the next step).
 * With JavaScript, focus moves to the first field with an error, or to the
 * new step's heading.
 */
import { useActionState, useEffect, useRef } from "react";
import { contractNoticeAction, type NoticeError, type NoticeState } from "@/lib/contract-notices/actions";
import { HONEYPOT_FIELD, NOTICE_LIMITS, type NoticeKind } from "@/lib/contract-notices/config";
import { FIELD_ORDER, type FieldError, type NoticeField, type NoticeValues } from "@/lib/contract-notices/form";
import type { NoticeMessages } from "@/lib/contract-notices/format";
import { fmt } from "@/lib/i18n/interpolate";
import { cn } from "@/lib/utils";

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-lime px-6 text-base font-semibold text-lime-on transition hover:bg-lime-hover disabled:opacity-60";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink transition hover:bg-hover disabled:opacity-60";
const INPUT =
  "mt-1.5 block min-h-11 w-full rounded-xl border border-line-strong bg-paper px-3 text-base text-ink placeholder:text-ink-faint aria-[invalid=true]:border-rose-600";
const ERROR_TEXT = "text-rose-700 dark:text-rose-300";

export interface NoticeFlowProps {
  kind: NoticeKind;
  messages: NoticeMessages;
  initialValues: NoticeValues;
  /** The "Which contract?" choices (lib/contract-notices/store.ts contractOptions). */
  contracts: { value: string; label: string }[];
  /** The email route, shown whenever something stops the online function. */
  contactEmail: string;
  signedIn: boolean;
}

export function NoticeFlow(props: NoticeFlowProps) {
  const initial: NoticeState = { step: "form", key: "initial", values: props.initialValues, errors: {}, error: null };
  const [state, formAction, pending] = useActionState(contractNoticeAction, initial);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    // Nothing moves on the first render; afterwards, the first error or the new step.
    if (first.current) {
      first.current = false;
      return;
    }
    if (state.step === "form") {
      const field = FIELD_ORDER.find((name) => state.errors[name]);
      if (field) {
        formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
        return;
      }
    }
    headingRef.current?.focus();
  }, [state]);

  if (state.step === "receipt") return <Receipt {...props} state={state} headingRef={headingRef} />;
  if (state.step === "review") {
    return (
      <Review {...props} state={state} formAction={formAction} pending={pending} headingRef={headingRef} />
    );
  }
  return (
    <div ref={formRef}>
      <FormStep key={state.key} {...props} state={state} formAction={formAction} pending={pending} headingRef={headingRef} />
    </div>
  );
}

type StepProps<S extends NoticeState["step"]> = NoticeFlowProps & {
  state: Extract<NoticeState, { step: S }>;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
};

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-3xl border border-line bg-card p-5 sm:p-8">{children}</div>;
}

function StepHeading({
  headingRef,
  step,
  title,
  M,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  step: 1 | 2 | null;
  title: string;
  M: NoticeMessages;
}) {
  return (
    <div>
      {step && <p className="text-sm font-semibold text-ink-soft">{fmt(M.step, { n: step })}</p>}
      <h2 ref={headingRef} tabIndex={-1} className="mt-1 font-display text-2xl font-bold tracking-tight outline-none">
        {title}
      </h2>
    </div>
  );
}

/** The email route, with the address as a link (the function never dead-ends). */
function EmailRoute({ M, email, className }: { M: NoticeMessages; email: string; className?: string }) {
  const [before, after = ""] = M.errors.emailRoute.split("{email}");
  return (
    <p className={className}>
      {before}
      <a href={`mailto:${email}`} className="break-all font-semibold underline underline-offset-4">
        {email}
      </a>
      {after}
    </p>
  );
}

const ERROR_MESSAGE: Record<NoticeError, (M: NoticeMessages) => string> = {
  rate_limited: (M) => M.errors.rateLimited,
  busy: (M) => M.errors.busy,
  failed: (M) => M.errors.failed,
};

function ProblemBox({ M, error, email }: { M: NoticeMessages; error: NoticeError; email: string }) {
  return (
    <div role="alert" className="mt-6 rounded-2xl border border-rose-600/40 bg-paper px-4 py-3 text-sm text-ink">
      <p className={cn("font-semibold", ERROR_TEXT)}>{ERROR_MESSAGE[error](M)}</p>
      <EmailRoute M={M} email={email} className="mt-1" />
    </div>
  );
}

function fieldErrorText(M: NoticeMessages, field: NoticeField, error: FieldError): string {
  if (error === "tooLong") return M.errors.tooLong;
  if (error === "required") return M.errors.required;
  if (field === "email") return M.errors.invalidEmail;
  if (field === "endDate") return M.errors.invalidDate;
  return M.errors.invalidContract;
}

function FieldMessage({ id, text }: { id: string; text: string | null }) {
  if (!text) return null;
  return (
    <p id={id} className={cn("mt-1.5 text-sm font-semibold", ERROR_TEXT)}>
      {text}
    </p>
  );
}

function FormStep({
  kind,
  messages: M,
  contracts,
  contactEmail,
  signedIn,
  state,
  formAction,
  pending,
  headingRef,
}: StepProps<"form"> & { formAction: (data: FormData) => void; pending: boolean }) {
  const v = state.values;
  const err =(field: NoticeField) => (state.errors[field] ? fieldErrorText(M, field, state.errors[field]) : null);
  const described = (field: NoticeField, hint?: string) =>
    [state.errors[field] ? `${field}-error` : null, hint].filter(Boolean).join(" ") || undefined;
  const invalid = (field: NoticeField) => (state.errors[field] ? true : undefined);
  const hasErrors = Object.keys(state.errors).length > 0;

  return (
    <Card>
      <StepHeading headingRef={headingRef} step={1} title={M.formTitle} M={M} />
      {signedIn && <p className="mt-2 text-sm text-ink-soft">{M.signedIn}</p>}
      {hasErrors && (
        <p role="alert" className={cn("mt-4 text-sm font-semibold", ERROR_TEXT)}>
          {M.errors.summary}
        </p>
      )}
      {state.error && <ProblemBox M={M} error={state.error} email={contactEmail} />}

      <form action={formAction} className="mt-6 flex flex-col gap-5">
        <input type="hidden" name="kind" value={kind} />

        {kind === "cancellation" && (
          <>
            <fieldset aria-describedby={described("cancelType")}>
              <legend className="text-sm font-semibold text-ink">{M.cancel.typeLabel}</legend>
              <div className="mt-2 flex flex-col gap-1">
                {(["ordinary", "extraordinary"] as const).map((type) => (
                  <label key={type} className="flex min-h-11 items-center gap-3 text-base text-ink">
                    <input
                      type="radio"
                      name="cancelType"
                      value={type}
                      defaultChecked={(v.cancelType || "ordinary") === type}
                      className="size-5 accent-lime-deep"
                    />
                    {M.cancel[type]}
                  </label>
                ))}
              </div>
              <FieldMessage id="cancelType-error" text={err("cancelType")} />
            </fieldset>
            <div>
              <label htmlFor="notice-reason" className="text-sm font-semibold text-ink">
                {M.cancel.reasonLabel}
              </label>
              <p id="notice-reason-hint" className="mt-0.5 text-sm text-ink-soft">
                {M.cancel.reasonHint}
              </p>
              <textarea
                id="notice-reason"
                name="reason"
                rows={3}
                maxLength={NOTICE_LIMITS.reason}
                defaultValue={v.reason}
                aria-invalid={invalid("reason")}
                aria-describedby={described("reason", "notice-reason-hint")}
                className={cn(INPUT, "py-2")}
              />
              <FieldMessage id="reason-error" text={err("reason")} />
            </div>
            <fieldset aria-describedby={described("endDate")}>
              <legend className="text-sm font-semibold text-ink">{M.cancel.endLabel}</legend>
              <div className="mt-2 flex flex-col gap-1">
                <label className="flex min-h-11 items-center gap-3 text-base text-ink">
                  <input
                    type="radio"
                    name="endWhen"
                    value="earliest"
                    defaultChecked={v.endWhen !== "date"}
                    className="size-5 accent-lime-deep"
                  />
                  {M.cancel.endEarliest}
                </label>
                <label className="flex min-h-11 items-center gap-3 text-base text-ink">
                  <input
                    type="radio"
                    name="endWhen"
                    value="date"
                    defaultChecked={v.endWhen === "date"}
                    className="size-5 accent-lime-deep"
                  />
                  {M.cancel.endDate}
                </label>
              </div>
              <label htmlFor="notice-end-date" className="mt-2 block text-sm font-semibold text-ink">
                {M.cancel.endDateLabel}
              </label>
              <input
                id="notice-end-date"
                type="date"
                name="endDate"
                defaultValue={v.endDate}
                aria-invalid={invalid("endDate")}
                aria-describedby={described("endDate")}
                className={cn(INPUT, "sm:max-w-xs")}
              />
              <FieldMessage id="endDate-error" text={err("endDate")} />
            </fieldset>
          </>
        )}

        <div>
          <label htmlFor="notice-name" className="text-sm font-semibold text-ink">
            {M.nameLabel}
          </label>
          <input
            id="notice-name"
            name="name"
            required
            autoComplete="name"
            maxLength={NOTICE_LIMITS.name}
            defaultValue={v.name}
            aria-invalid={invalid("name")}
            aria-describedby={described("name")}
            className={INPUT}
          />
          <FieldMessage id="name-error" text={err("name")} />
        </div>

        <div>
          <label htmlFor="notice-email" className="text-sm font-semibold text-ink">
            {M.emailLabel}
          </label>
          <p id="notice-email-hint" className="mt-0.5 text-sm text-ink-soft">
            {M.emailHint}
          </p>
          <input
            id="notice-email"
            name="email"
            type="email"
            required
            dir="ltr"
            autoComplete="email"
            maxLength={NOTICE_LIMITS.email}
            defaultValue={v.email}
            aria-invalid={invalid("email")}
            aria-describedby={described("email", "notice-email-hint")}
            className={cn(INPUT, "rtl:text-right")}
          />
          <FieldMessage id="email-error" text={err("email")} />
        </div>

        <div>
          <label htmlFor="notice-contract" className="text-sm font-semibold text-ink">
            {M.contractLabel}
          </label>
          <select
            id="notice-contract"
            name="contract"
            required
            defaultValue={contracts.some((c) => c.value === v.contract) ? v.contract : ""}
            aria-invalid={invalid("contract")}
            aria-describedby={described("contract")}
            className={INPUT}
          >
            <option value="" disabled>
              {M.chooseOne}
            </option>
            {contracts.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldMessage id="contract-error" text={err("contract")} />
        </div>

        <div>
          <label htmlFor="notice-details" className="text-sm font-semibold text-ink">
            {M.detailsLabel}
          </label>
          <p id="notice-details-hint" className="mt-0.5 text-sm text-ink-soft">
            {M.detailsHint}
          </p>
          <textarea
            id="notice-details"
            name="details"
            rows={3}
            maxLength={NOTICE_LIMITS.details}
            defaultValue={v.details}
            aria-invalid={invalid("details")}
            aria-describedby={described("details", "notice-details-hint")}
            className={cn(INPUT, "py-2")}
          />
          <FieldMessage id="details-error" text={err("details")} />
        </div>

        <div>
          <button type="submit" name="intent" value="review" disabled={pending} className={PRIMARY}>
            {pending ? M.sending : M.continue}
          </button>
        </div>
      </form>
    </Card>
  );
}

function Lines({ lines }: { lines: { label: string; value: string }[] }) {
  return (
    <dl className="mt-6 divide-y divide-line rounded-2xl bg-oat px-4 sm:px-5">
      {lines.map((line, index) => (
        <div key={index} className="grid gap-0.5 py-3 sm:grid-cols-[minmax(9rem,auto)_1fr] sm:gap-4">
          <dt className="text-sm text-ink-soft">{line.label}</dt>
          <dd dir="auto" className="whitespace-pre-wrap break-words text-base text-ink">
            {line.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Review({
  kind,
  messages: M,
  contactEmail,
  state,
  formAction,
  pending,
  headingRef,
}: StepProps<"review"> & { formAction: (data: FormData) => void; pending: boolean }) {
  const K = kind === "withdrawal" ? M.withdraw : M.cancel;
  const v = state.values;
  return (
    <Card>
      <StepHeading headingRef={headingRef} step={2} title={K.reviewTitle} M={M} />
      <p className="mt-2 text-ink-soft">{K.reviewIntro}</p>
      {state.error && <ProblemBox M={M} error={state.error} email={contactEmail} />}
      <Lines lines={state.lines} />
      <form action={formAction} className="mt-6">
        <input type="hidden" name="kind" value={kind} />
        {(Object.keys(v) as (keyof NoticeValues)[]).map((name) => (
          <input key={name} type="hidden" name={name} value={v[name]} />
        ))}
        {/* Hidden from people (and screen readers); naive bots fill it in. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            {HONEYPOT_FIELD}
            <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <button type="submit" name="intent" value="edit" formNoValidate disabled={pending} className={SECONDARY}>
            {M.edit}
          </button>
          <button type="submit" name="intent" value="confirm" disabled={pending} className={PRIMARY}>
            {pending ? M.sending : K.confirm}
          </button>
        </div>
      </form>
    </Card>
  );
}

function Receipt({
  kind,
  messages: M,
  contactEmail,
  state,
  headingRef,
}: StepProps<"receipt">) {
  const K = kind === "withdrawal" ? M.withdraw : M.cancel;
  const R = M.receipt;
  const ackText = state.ack === "sent" ? fmt(R.emailSent, { email: state.ackEmail }) : null;
  const [before, after = ""] = (state.ack === "not_configured" ? R.emailOff : R.emailFailed).split("{email}");
  return (
    <Card>
      <StepHeading headingRef={headingRef} step={null} title={K.receiptTitle} M={M} />
      <p className="mt-3 text-lg text-ink">{fmt(K.received, { date: state.receivedAt })}</p>
      {kind === "cancellation" && state.proEnds ? (
        <p className="mt-3 rounded-2xl bg-matcha px-4 py-3 text-ink">{fmt(M.cancel.scheduled, { date: state.proEnds })}</p>
      ) : (
        <p className="mt-3 text-ink-soft">{K.next}</p>
      )}
      <Lines lines={[...state.lines, { label: M.lines.reference, value: state.id }]} />
      {ackText ? (
        <p className="mt-6 rounded-2xl bg-cloud px-4 py-3 text-ink">{ackText}</p>
      ) : (
        <p role="status" className="mt-6 rounded-2xl bg-heather px-4 py-3 text-ink">
          {before}
          <a href={`mailto:${contactEmail}`} className="break-all font-semibold underline underline-offset-4">
            {contactEmail}
          </a>
          {after}
        </p>
      )}
      <div className="mt-6 print:hidden">
        <button type="button" onClick={() => window.print()} className={SECONDARY}>
          {R.print}
        </button>
      </div>
    </Card>
  );
}
