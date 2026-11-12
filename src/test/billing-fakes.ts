/**
 * In-memory fakes for billing tests: a Prisma subset with real unique
 * constraints and all-or-nothing transactions, and a Stripe subset that keeps
 * customers, subscriptions, checkout sessions, invoices and refunds in memory.
 * No network, no database. Used by the billing, credits and webhook tests.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;

function uniqueError(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!(cond as Row[]).some((c) => matches(row, c))) return false;
      continue;
    }
    const value = row[key];
    if (cond === null) {
      if (value !== null && value !== undefined) return false;
    } else if (cond instanceof Date) {
      if (!(value instanceof Date) || value.getTime() !== cond.getTime()) return false;
    } else if (typeof cond === "object") {
      if ("lt" in cond && !(value != null && value < cond.lt)) return false;
      if ("in" in cond && !cond.in.includes(value)) return false;
      if ("startsWith" in cond && !(typeof value === "string" && value.startsWith(cond.startsWith))) return false;
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

let idSeq = 0;
const nextId = (p: string) => `${p}_${++idSeq}`;

export function createFakeDb() {
  const state = {
    subscriptions: new Map<string, Row>(),
    accounts: new Map<string, Row>(),
    ledger: [] as Row[],
    billingEvents: [] as Row[],
    deleted: new Map<string, Row>(),
  };

  const clone = () => ({
    subscriptions: new Map([...state.subscriptions].map(([k, v]) => [k, { ...v }])),
    accounts: new Map([...state.accounts].map(([k, v]) => [k, { ...v }])),
    ledger: state.ledger.map((r) => ({ ...r })),
    billingEvents: state.billingEvents.map((r) => ({ ...r })),
    deleted: new Map([...state.deleted].map(([k, v]) => [k, { ...v }])),
  });
  const restore = (snap: ReturnType<typeof clone>) => Object.assign(state, snap);

  const subscription = {
    findUnique: async ({ where }: any) => {
      const r = state.subscriptions.get(where.userId);
      return r ? { ...r } : null;
    },
    findFirst: async ({ where }: any) => {
      const r = [...state.subscriptions.values()].find((s) => matches(s, where));
      return r ? { ...r } : null;
    },
    upsert: async ({ where, create, update }: any) => {
      const existing = state.subscriptions.get(where.userId);
      if (existing) Object.assign(existing, update, { updatedAt: new Date() });
      else
        state.subscriptions.set(where.userId, {
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          status: "free",
          currentPeriodEnd: null,
          allowancePeriodStart: null,
          allowancePeriodEnd: null,
          ...create,
          updatedAt: new Date(),
        });
      return { ...state.subscriptions.get(where.userId) };
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const s of state.subscriptions.values()) {
        if (matches(s, where)) {
          Object.assign(s, data);
          count++;
        }
      }
      return { count };
    },
  };

  const creditAccount = {
    findUnique: async ({ where }: any) => {
      const r = state.accounts.get(where.userId);
      return r ? { ...r } : null;
    },
    create: async ({ data }: any) => {
      if (state.accounts.has(data.userId)) throw uniqueError();
      state.accounts.set(data.userId, { balance: 0, ...data });
      return { ...state.accounts.get(data.userId) };
    },
    update: async ({ where, data }: any) => {
      const r = state.accounts.get(where.userId);
      if (!r) throw Object.assign(new Error("not found"), { code: "P2025" });
      const b = data.balance;
      if (typeof b === "number") r.balance = b;
      else if (b?.increment) r.balance += b.increment;
      else if (b?.decrement) r.balance -= b.decrement;
      return { ...r };
    },
  };

  const creditLedger = {
    create: async ({ data }: any) => {
      if (data.idempotencyKey && state.ledger.some((l) => l.idempotencyKey === data.idempotencyKey)) {
        throw uniqueError();
      }
      const row = { id: nextId("led"), createdAt: new Date(), idempotencyKey: null, ...data };
      state.ledger.push(row);
      return { ...row };
    },
    findUnique: async ({ where }: any) => {
      const r = state.ledger.find((l) => l.idempotencyKey === where.idempotencyKey);
      return r ? { ...r } : null;
    },
    aggregate: async ({ where }: any) => {
      const rows = state.ledger.filter((l) => matches(l, where));
      return { _sum: { delta: rows.length ? rows.reduce((s, r) => s + r.delta, 0) : null } };
    },
  };

  const billingEvent = {
    create: async ({ data }: any) => {
      if (state.billingEvents.some((e) => e.kind === data.kind && e.stripeObjectId === data.stripeObjectId)) {
        throw uniqueError();
      }
      const row = { id: nextId("bev"), createdAt: new Date(), ...data };
      state.billingEvents.push(row);
      return { ...row };
    },
    findUnique: async ({ where }: any) => {
      const k = where.kind_stripeObjectId;
      const r = state.billingEvents.find((e) => e.kind === k.kind && e.stripeObjectId === k.stripeObjectId);
      return r ? { ...r } : null;
    },
    findFirst: async ({ where }: any) => {
      const r = state.billingEvents.find((e) => matches(e, where));
      return r ? { ...r } : null;
    },
  };

  const deletedAccount = {
    findUnique: async ({ where }: any) => state.deleted.get(where.userId) ?? null,
    upsert: async ({ where }: any) => {
      if (!state.deleted.has(where.userId)) {
        state.deleted.set(where.userId, { userId: where.userId, deletedAt: new Date() });
      }
      return state.deleted.get(where.userId);
    },
  };

  const db: any = {
    subscription,
    creditAccount,
    creditLedger,
    billingEvent,
    deletedAccount,
    // Tagged template; only the FOR UPDATE balance read is supported.
    $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
      if (!strings.join("?").includes("FOR UPDATE")) throw new Error("unsupported raw query");
      const r = state.accounts.get(values[0]);
      return r ? [{ balance: r.balance }] : [];
    },
    // All-or-nothing, like Postgres: a failure rolls every write back.
    $transaction: async (arg: any) => {
      const snap = clone();
      try {
        if (typeof arg === "function") return await arg(db);
        const out = [];
        for (const op of arg) out.push(await op);
        return out;
      } catch (err) {
        restore(snap);
        throw err;
      }
    },
  };

  // Prisma batch transactions receive already-created promises; make the
  // writes lazy so a rollback can undo them in order.
  for (const model of [subscription, creditAccount, creditLedger, billingEvent, deletedAccount] as Row[]) {
    for (const [name, fn] of Object.entries(model)) {
      model[name] = (...args: any[]) => {
        let p: Promise<any> | null = null;
        const run = () => (p ??= (fn as any)(...args));
        return { then: (a: any, b: any) => run().then(a, b), catch: (b: any) => run().catch(b) };
      };
    }
  }

  return {
    db,
    state,
    balance: (userId: string) => state.accounts.get(userId)?.balance ?? 0,
    ledgerFor: (userId: string) => state.ledger.filter((l) => l.userId === userId),
    reset: () =>
      restore({
        subscriptions: new Map(),
        accounts: new Map(),
        ledger: [],
        billingEvents: [],
        deleted: new Map(),
      }),
  };
}

// ---- Stripe -----------------------------------------------------------------

function stripeError(type: string, code: string, message = code): Error {
  return Object.assign(new Error(message), { type, code });
}

const list = (data: any[]) => ({ object: "list", data, has_more: false });

export function createFakeStripe() {
  let clock = 1_700_000_000;
  const s = {
    customers: new Map<string, Row>(),
    customerKeys: new Map<string, string>(),
    subscriptions: new Map<string, Row>(),
    sessions: new Map<string, Row>(),
    invoiceLines: new Map<string, Row[]>(),
    invoicePayments: new Map<string, Row[]>(),
    refunds: [] as Row[],
    refundKeys: new Map<string, Row>(),
    charges: new Map<string, Row>(),
    portalSessions: [] as Row[],
  };

  const stripe = {
    customers: {
      create: async (params: any, opts?: any) => {
        const key = opts?.idempotencyKey;
        if (key && s.customerKeys.has(key)) return { ...s.customers.get(s.customerKeys.get(key)!) };
        const c = { id: nextId("cus"), object: "customer", ...params };
        s.customers.set(c.id, c);
        if (key) s.customerKeys.set(key, c.id);
        return { ...c };
      },
    },
    subscriptions: {
      list: async ({ customer }: any) =>
        list([...s.subscriptions.values()].filter((x) => x.customer === customer).map((x) => ({ ...x }))),
      retrieve: async (id: string) => {
        const sub = s.subscriptions.get(id);
        if (!sub) throw stripeError("StripeInvalidRequestError", "resource_missing");
        return structuredClone(sub);
      },
      cancel: async (id: string) => {
        const sub = s.subscriptions.get(id);
        if (!sub) throw stripeError("StripeInvalidRequestError", "resource_missing");
        if (sub.status === "canceled") throw stripeError("StripeInvalidRequestError", "subscription_canceled");
        sub.status = "canceled";
        return { ...sub };
      },
      search: async ({ query }: any) => {
        const m = /metadata\['userId'\]:'([^']+)'/.exec(query);
        return list([...s.subscriptions.values()].filter((x) => x.metadata?.userId === m?.[1]));
      },
    },
    checkout: {
      sessions: {
        create: async (params: any) => {
          const id = nextId("cs");
          const session = {
            id,
            object: "checkout.session",
            created: ++clock,
            status: "open",
            payment_status: "unpaid",
            url: `https://checkout.stripe.test/${id}`,
            customer: params.customer ?? null,
            subscription: null,
            payment_intent: null,
            amount_total: params.line_items?.[0]?.price_data?.unit_amount ?? null,
            ...params,
          };
          s.sessions.set(id, session);
          return { ...session };
        },
        list: async ({ customer, status, payment_intent }: any) =>
          list(
            [...s.sessions.values()]
              .filter((x) => (customer ? x.customer === customer : true))
              .filter((x) => (status ? x.status === status : true))
              .filter((x) => (payment_intent ? x.payment_intent === payment_intent : true))
              .map((x) => ({ ...x })),
          ),
        retrieve: async (id: string) => {
          const x = s.sessions.get(id);
          if (!x) throw stripeError("StripeInvalidRequestError", "resource_missing");
          return { ...x };
        },
        expire: async (id: string) => {
          const x = s.sessions.get(id)!;
          if (x.status !== "open") throw stripeError("StripeInvalidRequestError", "session_not_open");
          x.status = "expired";
          return { ...x };
        },
      },
    },
    invoices: {
      listLineItems: async (id: string) => list(s.invoiceLines.get(id) ?? []),
    },
    invoicePayments: {
      list: async ({ invoice }: any) => list(s.invoicePayments.get(invoice) ?? []),
    },
    refunds: {
      create: async (params: any, opts?: any) => {
        const key = opts?.idempotencyKey;
        if (key && s.refundKeys.has(key)) return { ...s.refundKeys.get(key)! };
        const charge = [...s.charges.values()].find((c) => c.payment_intent === params.payment_intent);
        const amount = params.amount ?? charge?.amount ?? 0;
        const refund = { id: nextId("re"), ...params, amount };
        s.refunds.push(refund);
        if (key) s.refundKeys.set(key, refund);
        return { ...refund };
      },
    },
    charges: {
      retrieve: async (id: string) => ({ ...s.charges.get(id)! }),
    },
    billingPortal: {
      sessions: {
        create: async (params: any) => {
          const p = { id: nextId("bps"), url: "https://billing.stripe.test/portal", ...params };
          s.portalSessions.push(p);
          return p;
        },
      },
    },
    // Tests send the event JSON as the request body.
    webhooks: {
      constructEvent: (body: string, sig: string) => {
        if (sig !== "valid") throw new Error("bad signature");
        return JSON.parse(body);
      },
    },
  };

  // ---- Scenario helpers (simulate what Stripe does on its side) ----

  /** Complete a checkout session as Stripe would after payment. */
  function completeSubscriptionCheckout(
    sessionId: string,
    opts: { status?: string; periodStart?: number; periodEnd?: number; amount?: number } = {},
  ) {
    const session = s.sessions.get(sessionId)!;
    if (session.status !== "open") throw stripeError("StripeInvalidRequestError", "session_not_open");
    const start = opts.periodStart ?? ++clock;
    const end = opts.periodEnd ?? start + 30 * 86400;
    const subId = nextId("sub");
    const invoiceId = nextId("in");
    const piId = nextId("pi");
    const amount = opts.amount ?? 800;
    s.subscriptions.set(subId, {
      id: subId,
      object: "subscription",
      customer: session.customer,
      status: opts.status ?? "active",
      metadata: { ...(session.subscription_data?.metadata ?? {}) },
      latest_invoice: invoiceId,
      items: { data: [{ current_period_start: start, current_period_end: end }] },
    });
    s.charges.set(`ch_${piId}`, { id: `ch_${piId}`, payment_intent: piId, amount, customer: session.customer });
    s.invoicePayments.set(invoiceId, [
      { id: nextId("inpay"), status: "paid", amount_paid: amount, payment: { type: "payment_intent", payment_intent: piId } },
    ]);
    Object.assign(session, { status: "complete", payment_status: "paid", subscription: subId });
    const invoice = subscriptionInvoice(subId, { id: invoiceId, start, end, amount });
    return { session: { ...session }, subscription: structuredClone(s.subscriptions.get(subId)!), invoice, paymentIntent: piId };
  }

  /** A paid invoice for a subscription period (cycle or create). */
  function subscriptionInvoice(
    subId: string,
    opts: { id?: string; start: number; end: number; amount?: number; proration?: boolean; discount?: number; billingReason?: string },
  ) {
    const sub = s.subscriptions.get(subId)!;
    const id = opts.id ?? nextId("in");
    const line = {
      id: nextId("il"),
      amount: opts.amount ?? 800,
      discount_amounts: opts.discount ? [{ amount: opts.discount, discount: "di_1" }] : [],
      period: { start: opts.start, end: opts.end },
      parent: {
        type: "subscription_item_details",
        subscription_item_details: { proration: opts.proration ?? false, subscription: subId },
      },
    };
    s.invoiceLines.set(id, [line]);
    return {
      id,
      object: "invoice",
      customer: sub.customer,
      billing_reason: opts.billingReason ?? "subscription_cycle",
      amount_paid: Math.max(0, (opts.amount ?? 800) - (opts.discount ?? 0)),
      lines: { data: [line], has_more: false },
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: subId, metadata: { ...sub.metadata } },
      },
    };
  }

  /** Complete a credit-pack checkout (paid now, or pending for async methods). */
  function completePackCheckout(sessionId: string, opts: { paid?: boolean } = {}) {
    const session = s.sessions.get(sessionId)!;
    const piId = nextId("pi");
    const amount = session.amount_total ?? 1000;
    s.charges.set(`ch_${piId}`, { id: `ch_${piId}`, payment_intent: piId, amount, customer: session.customer });
    Object.assign(session, {
      status: "complete",
      payment_status: opts.paid === false ? "unpaid" : "paid",
      payment_intent: piId,
    });
    return { session: { ...session }, paymentIntent: piId, chargeId: `ch_${piId}`, amount };
  }

  function markPackPaid(sessionId: string) {
    const session = s.sessions.get(sessionId)!;
    session.payment_status = "paid";
    return { ...session };
  }

  return {
    stripe,
    state: s,
    completeSubscriptionCheckout,
    subscriptionInvoice,
    completePackCheckout,
    markPackPaid,
    setSubscriptionStatus: (id: string, status: string) => {
      s.subscriptions.get(id)!.status = status;
    },
    /** Create a subscription directly (e.g. a legacy duplicate on another customer). */
    addSubscription: (sub: Row): Row => {
      const full: Row = {
        object: "subscription",
        status: "active",
        metadata: {},
        latest_invoice: null,
        items: { data: [{ current_period_start: clock, current_period_end: clock + 30 * 86400 }] },
        ...sub,
      };
      s.subscriptions.set(full.id, full);
      return structuredClone(full);
    },
    reset: () => {
      for (const v of Object.values(s)) {
        if (v instanceof Map) v.clear();
        else if (Array.isArray(v)) v.length = 0;
      }
    },
  };
}

/** A webhook Request carrying `event` as its (fake-signed) body. */
export function webhookRequest(event: { type: string; data: { object: unknown } }, sig = "valid") {
  return new Request("http://test/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": sig },
    body: JSON.stringify({ id: nextId("evt"), ...event }),
  });
}
