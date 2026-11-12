/**
 * In-memory fakes for billing tests. No network, no database. Used by the
 * billing, credits and Stripe webhook tests.
 *
 * Prisma fake: the subset of models billing touches, with real unique
 * constraints and transactions that behave like Postgres at READ COMMITTED:
 *  - a transaction's writes are private until it commits (no dirty reads) and
 *    a rollback discards only its own writes;
 *  - every write takes the row's lock, held to the end of the transaction, so
 *    concurrent writers of one row serialize; an updateMany re-checks its
 *    condition after waiting for the lock;
 *  - `SELECT … FOR UPDATE` on CreditAccount and `pg_advisory_xact_lock` take
 *    real (async) locks.
 *
 * Stripe fake: customers, subscriptions with Stripe's real period boundaries
 * (the anchor day is kept and clamped to short months, so Jan 31 renews on
 * Feb 28 and then Mar 31), renewals that fail and go past_due with the period
 * already advanced, checkout sessions, invoices with `total`, `amount_paid`
 * and `starting_balance`, invoice payments, charges, refunds that can be
 * pending and then fail, disputes, and prices. Any call can be made to fail
 * (`failNext`), with a transient error or any Stripe error (`stripeError`),
 * including part-way through a multi-call flow.
 *
 * Also: rows shaped like the ones the code before billing round 2 wrote
 * (`seedLegacySubscription`, `seedLegacyProGrant`), and `permutations` for
 * delivering webhooks in every order.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AsyncLocalStorage } from "node:async_hooks";

type Row = Record<string, any>;

function uniqueError(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}
function notFoundError(): Error {
  return Object.assign(new Error("Record not found"), { code: "P2025" });
}

const isPlainObject = (v: unknown): v is Row =>
  typeof v === "object" && v !== null && !(v instanceof Date) && !Array.isArray(v);

const cmp = (a: any, b: any) => {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x < y ? -1 : x > y ? 1 : 0;
};
const same = (a: any, b: any) => {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  return a === b;
};

function matchField(value: any, cond: any): boolean {
  if (!isPlainObject(cond)) return same(value, cond);
  for (const [op, arg] of Object.entries(cond)) {
    switch (op) {
      case "equals":
        if (!same(value, arg)) return false;
        break;
      case "not":
        if (isPlainObject(arg) ? matchField(value, arg) : same(value, arg)) return false;
        // Prisma (like SQL) never matches NULL with `not: value`.
        if (!isPlainObject(arg) && arg !== null && (value === null || value === undefined)) return false;
        break;
      case "in":
        if (!(arg as any[]).some((a) => same(value, a))) return false;
        break;
      case "notIn":
        if (value === null || value === undefined) return false;
        if ((arg as any[]).some((a) => same(value, a))) return false;
        break;
      case "lt":
        if (value == null || cmp(value, arg) >= 0) return false;
        break;
      case "lte":
        if (value == null || cmp(value, arg) > 0) return false;
        break;
      case "gt":
        if (value == null || cmp(value, arg) <= 0) return false;
        break;
      case "gte":
        if (value == null || cmp(value, arg) < 0) return false;
        break;
      case "startsWith":
        if (!(typeof value === "string" && value.startsWith(arg))) return false;
        break;
      case "contains":
        if (!(typeof value === "string" && value.includes(arg))) return false;
        break;
      default:
        throw new Error(`fake prisma: unsupported filter ${op}`);
    }
  }
  return true;
}

export function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === "OR") {
      if (!(cond as Row[]).some((c) => matches(row, c))) return false;
    } else if (key === "AND") {
      const all = Array.isArray(cond) ? cond : [cond];
      if (!all.every((c) => matches(row, c))) return false;
    } else if (key === "NOT") {
      const all = Array.isArray(cond) ? cond : [cond];
      if (all.some((c) => matches(row, c))) return false;
    } else if (
      isPlainObject(cond) &&
      !(key in row) &&
      key.includes("_") &&
      Object.keys(cond).every((k) => k in row)
    ) {
      // Compound unique selector, e.g. { kind_key: { kind, key } }.
      if (!matches(row, cond)) return false;
    } else if (!matchField(row[key], cond)) {
      return false;
    }
  }
  return true;
}

function applyData(row: Row, data: Row): Row {
  const next = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (isPlainObject(value)) {
      if ("increment" in value) next[key] = (next[key] ?? 0) + value.increment;
      else if ("decrement" in value) next[key] = (next[key] ?? 0) - value.decrement;
      else if ("set" in value) next[key] = value.set;
      else next[key] = value;
    } else {
      next[key] = value;
    }
  }
  return next;
}

let idSeq = 0;
const nextId = (p: string) => `${p}_${String(++idSeq).padStart(6, "0")}`;

// ---- Locks ------------------------------------------------------------------

class LockManager {
  private held = new Map<string, { owner: symbol; waiters: (() => void)[] }>();
  async acquire(key: string, owner: symbol): Promise<void> {
    for (;;) {
      const h = this.held.get(key);
      if (!h) {
        this.held.set(key, { owner, waiters: [] });
        return;
      }
      if (h.owner === owner) return;
      await new Promise<void>((resolve) => h.waiters.push(resolve));
    }
  }
  release(key: string, owner: symbol): void {
    const h = this.held.get(key);
    if (!h || h.owner !== owner) return;
    this.held.delete(key);
    for (const wake of h.waiters) wake();
  }
  clear(): void {
    const all = [...this.held.values()];
    this.held.clear();
    for (const h of all) for (const wake of h.waiters) wake();
  }
}

// ---- Tables -----------------------------------------------------------------

type TableSpec = {
  pk: (row: Row) => string;
  uniques: ((row: Row) => string | null)[];
  defaults: (data: Row) => Row;
};

const now = () => new Date();

const TABLES: Record<string, TableSpec> = {
  subscription: {
    pk: (r) => r.userId,
    uniques: [],
    defaults: () => ({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      status: "free",
      currentPeriodEnd: null,
      allowancePeriodStart: null,
      allowancePeriodEnd: null,
      stripeSyncedAt: null,
      endedSubscriptionId: null,
      endedAt: null,
      stripeCheckedAt: null,
      allowanceSubscriptionId: null,
      allowancePaymentIntentId: null,
      allowancePaymentCents: null,
      allowanceYearly: false,
      allowanceStopAt: null,
      disputeId: null,
      disputedAt: null,
      updatedAt: now(),
    }),
  },
  creditAccount: {
    pk: (r) => r.userId,
    uniques: [],
    defaults: () => ({ balance: 0, createdAt: now(), updatedAt: now() }),
  },
  creditLedger: {
    pk: (r) => r.id,
    uniques: [(r) => (r.idempotencyKey ? `key:${r.idempotencyKey}` : null)],
    defaults: () => ({ id: nextId("led"), createdAt: now(), idempotencyKey: null }),
  },
  billingEvent: {
    pk: (r) => r.id,
    uniques: [(r) => `${r.kind}|${r.stripeObjectId}`],
    defaults: () => ({
      id: nextId("bev"),
      createdAt: now(),
      userId: null,
      paymentIntentId: null,
      amountCents: null,
      credits: null,
      detail: null,
      occurredAt: null,
    }),
  },
  deletedAccount: {
    pk: (r) => r.userId,
    uniques: [],
    defaults: () => ({ deletedAt: now() }),
  },
  billingIntent: {
    pk: (r) => r.id,
    uniques: [(r) => `${r.kind}|${r.key}`],
    defaults: () => ({
      id: nextId("bin"),
      userId: null,
      reason: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      state: "pending",
      attempts: 0,
      lastError: null,
      createdAt: now(),
      updatedAt: now(),
      completedAt: null,
    }),
  },
  creditHold: {
    pk: (r) => r.id,
    uniques: [],
    defaults: () => ({
      id: nextId("hold"),
      state: "held",
      charged: null,
      pendingCharge: null,
      createdAt: now(),
      settledAt: null,
    }),
  },
};

type Tx = { id: symbol; writes: Map<string, Map<string, Row | null>>; locks: Set<string> };

export function createFakeDb() {
  const base: Record<string, Map<string, Row>> = Object.fromEntries(
    Object.keys(TABLES).map((t) => [t, new Map<string, Row>()]),
  );
  const locks = new LockManager();
  const als = new AsyncLocalStorage<Tx>();

  /** Rows of `table` as the current transaction (or autocommit) sees them. */
  function view(table: string): Map<string, Row> {
    const tx = als.getStore();
    const own = tx?.writes.get(table);
    if (!own || own.size === 0) return base[table];
    const merged = new Map(base[table]);
    for (const [pk, row] of own) {
      if (row === null) merged.delete(pk);
      else merged.set(pk, row);
    }
    return merged;
  }

  /** Run `write` holding the row lock: until commit in a tx, else just for it. */
  async function withRowLock<T>(table: string, pk: string, write: (tx: Tx | undefined) => T): Promise<T> {
    const key = `${table}:${pk}`;
    const tx = als.getStore();
    if (tx) {
      await locks.acquire(key, tx.id);
      tx.locks.add(key);
      return write(tx);
    }
    const owner = Symbol("autocommit");
    await locks.acquire(key, owner);
    try {
      return write(undefined);
    } finally {
      locks.release(key, owner);
    }
  }

  function checkUnique(table: string, row: Row, rows: Map<string, Row>) {
    const spec = TABLES[table];
    const pk = spec.pk(row);
    for (const unique of spec.uniques) {
      const k = unique(row);
      if (k === null) continue;
      for (const [otherPk, other] of rows) {
        if (otherPk !== pk && unique(other) === k) throw uniqueError();
      }
    }
  }

  function put(table: string, tx: Tx | undefined, pk: string, row: Row | null) {
    if (tx) {
      if (!tx.writes.has(table)) tx.writes.set(table, new Map());
      tx.writes.get(table)!.set(pk, row);
    } else if (row === null) {
      base[table].delete(pk);
    } else {
      checkUnique(table, row, base[table]);
      base[table].set(pk, row);
    }
  }

  const copy = (r: Row | undefined | null) => (r ? { ...r } : null);

  function sortRows(rows: Row[], orderBy: any): Row[] {
    if (!orderBy) return rows;
    // { field: "asc" } or { field: { sort: "asc", nulls: "first" } }. Like
    // Postgres, NULLs sort last ascending (first descending) unless told.
    const orders = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o: Row) =>
      Object.entries(o).map(([field, spec]) => {
        const dir: "asc" | "desc" = typeof spec === "string" ? (spec as "asc" | "desc") : spec.sort;
        const nulls: "first" | "last" =
          typeof spec === "object" && spec.nulls ? spec.nulls : dir === "asc" ? "last" : "first";
        return { field, dir, nulls };
      }),
    );
    return [...rows].sort((a, b) => {
      for (const { field, dir, nulls } of orders) {
        const an = a[field] === null || a[field] === undefined;
        const bn = b[field] === null || b[field] === undefined;
        if (an || bn) {
          if (an && bn) continue;
          return (an ? -1 : 1) * (nulls === "first" ? 1 : -1);
        }
        const c = cmp(a[field], b[field]);
        if (c !== 0) return dir === "desc" ? -c : c;
      }
      return 0;
    });
  }

  function model(table: string) {
    const spec = TABLES[table];
    const findAll = (where?: Row) => [...view(table).values()].filter((r) => matches(r, where));
    const findOne = (where: Row) => {
      if (spec.pk({ ...where }) !== undefined && Object.keys(where).length === 1) {
        return view(table).get(spec.pk(where)) ?? null;
      }
      return findAll(where)[0] ?? null;
    };

    async function create({ data }: Row) {
      const row = { ...spec.defaults(data), ...data };
      const pk = spec.pk(row);
      return withRowLock(table, pk, (tx) => {
        const rows = view(table);
        if (rows.has(pk)) throw uniqueError();
        checkUnique(table, row, rows);
        put(table, tx, pk, row);
        return { ...row };
      });
    }

    async function update({ where, data }: Row) {
      const target = findOne(where);
      if (!target) throw notFoundError();
      const pk = spec.pk(target);
      return withRowLock(table, pk, (tx) => {
        const current = view(table).get(pk);
        if (!current || !matches(current, where)) throw notFoundError();
        const next = applyData(current, { ...data, ...("updatedAt" in current ? { updatedAt: now() } : {}) });
        checkUnique(table, next, view(table));
        put(table, tx, pk, next);
        return { ...next };
      });
    }

    async function updateMany({ where, data }: Row) {
      let count = 0;
      for (const candidate of findAll(where)) {
        const pk = spec.pk(candidate);
        await withRowLock(table, pk, (tx) => {
          // Re-check after the lock, like Postgres re-evaluates the WHERE.
          const current = view(table).get(pk);
          if (!current || !matches(current, where)) return;
          const next = applyData(current, { ...data, ...("updatedAt" in current ? { updatedAt: now() } : {}) });
          put(table, tx, pk, next);
          count++;
        });
      }
      return { count };
    }

    async function upsert({ where, create: createData, update: updateData }: Row) {
      const existing = findOne(where);
      if (existing) return update({ where, data: updateData });
      try {
        return await create({ data: { ...createData } });
      } catch (err) {
        if ((err as { code?: string }).code !== "P2002") throw err;
        return update({ where, data: updateData });
      }
    }

    async function deleteMany({ where }: Row = {}) {
      let count = 0;
      for (const candidate of findAll(where)) {
        const pk = spec.pk(candidate);
        await withRowLock(table, pk, (tx) => {
          const current = view(table).get(pk);
          if (!current || !matches(current, where)) return;
          put(table, tx, pk, null);
          count++;
        });
      }
      return { count };
    }

    return {
      findUnique: async ({ where }: Row) => copy(findOne(where)),
      findFirst: async ({ where, orderBy }: Row = {}) => copy(sortRows(findAll(where), orderBy)[0]),
      findMany: async ({ where, orderBy, take }: Row = {}) => {
        const rows = sortRows(findAll(where), orderBy).map((r) => ({ ...r }));
        return typeof take === "number" ? rows.slice(0, take) : rows;
      },
      count: async ({ where }: Row = {}) => findAll(where).length,
      aggregate: async ({ where, _sum }: Row) => {
        const rows = findAll(where);
        const sum: Row = {};
        for (const field of Object.keys(_sum ?? { delta: true })) {
          sum[field] = rows.length ? rows.reduce((s, r) => s + (r[field] ?? 0), 0) : null;
        }
        return { _sum: sum };
      },
      create,
      update,
      updateMany,
      upsert,
      delete: async ({ where }: Row) => {
        const target = findOne(where);
        if (!target) throw notFoundError();
        await deleteMany({ where: { [Object.keys(where)[0]]: Object.values(where)[0] } });
        return { ...target };
      },
      deleteMany,
    };
  }

  const models = {
    subscription: model("subscription"),
    creditAccount: model("creditAccount"),
    creditLedger: model("creditLedger"),
    billingEvent: model("billingEvent"),
    deletedAccount: model("deletedAccount"),
    billingIntent: model("billingIntent"),
    creditHold: model("creditHold"),
  };

  async function commit(tx: Tx) {
    // Unique keys are checked again against what others committed meanwhile.
    for (const [table, writes] of tx.writes) {
      const merged = new Map(base[table]);
      for (const [pk, row] of writes) {
        if (row === null) merged.delete(pk);
        else merged.set(pk, row);
      }
      for (const [, row] of writes) if (row) checkUnique(table, row, merged);
    }
    for (const [table, writes] of tx.writes) {
      for (const [pk, row] of writes) {
        if (row === null) base[table].delete(pk);
        else base[table].set(pk, row);
      }
    }
  }

  const db: any = {
    ...models,
    $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.join("?");
      const tx = als.getStore();
      if (sql.includes("pg_advisory_xact_lock")) {
        if (!tx) throw new Error("fake prisma: advisory xact lock outside a transaction");
        const key = `advisory:${values[0]}`;
        await locks.acquire(key, tx.id);
        tx.locks.add(key);
        return [{ locked: 1 }];
      }
      if (sql.includes('FROM "CreditAccount"') && sql.includes("FOR UPDATE")) {
        const userId = values[0];
        await withRowLock("creditAccount", userId, () => undefined);
        const r = view("creditAccount").get(userId);
        return r ? [{ balance: r.balance }] : [];
      }
      throw new Error(`fake prisma: unsupported raw query: ${sql}`);
    },
    $transaction: async (arg: any) => {
      if (als.getStore()) throw new Error("fake prisma: nested transaction");
      const tx: Tx = { id: Symbol("tx"), writes: new Map(), locks: new Set() };
      try {
        const out = await als.run(tx, async () => {
          if (typeof arg === "function") return arg(db);
          const results = [];
          for (const op of arg) results.push(await op);
          return results;
        });
        await commit(tx);
        return out;
      } finally {
        for (const key of tx.locks) locks.release(key, tx.id);
      }
    },
  };

  // Prisma batch transactions receive already-created promises; make every
  // model call lazy so it runs inside the transaction that awaits it.
  for (const m of Object.values(models) as Row[]) {
    for (const [name, fn] of Object.entries(m)) {
      m[name] = (...args: any[]) => {
        let p: Promise<any> | null = null;
        const run = () => (p ??= (fn as any)(...args));
        return {
          then: (a: any, b: any) => run().then(a, b),
          catch: (b: any) => run().catch(b),
          finally: (f: any) => run().finally(f),
        };
      };
    }
  }

  const state = {
    subscriptions: base.subscription,
    accounts: base.creditAccount,
    deleted: base.deletedAccount,
    get ledger() {
      return [...base.creditLedger.values()];
    },
    get billingEvents() {
      return [...base.billingEvent.values()];
    },
    get intents() {
      return [...base.billingIntent.values()];
    },
    get holds() {
      return [...base.creditHold.values()];
    },
  };

  return {
    db,
    state,
    /**
     * A Subscription row exactly as the code before billing round 2 left it:
     * status "active" or "canceled" (it stored "canceled" for EVERY status
     * that was not active: past_due, unpaid, incomplete...), the Stripe ids,
     * and nothing else (no period end, never stripeSyncedAt, no allowance).
     */
    seedLegacySubscription: (row: {
      userId: string;
      status: "active" | "canceled" | "free";
      stripeCustomerId?: string | null;
      stripeSubscriptionId?: string | null;
    }) => {
      base.subscription.set(row.userId, {
        ...TABLES.subscription.defaults({}),
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        ...row,
      });
    },
    /**
     * A Pro grant written by the code before coverage months existed: one
     * per paid invoice, keyed `pro_grant:<invoice id>`, created when the
     * webhook ran.
     */
    seedLegacyProGrant: (userId: string, invoiceId: string, createdAt: Date, credits = 1000) => {
      const id = nextId("led");
      base.creditLedger.set(id, {
        id,
        userId,
        delta: credits,
        reason: "pro_monthly",
        idempotencyKey: `pro_grant:${invoiceId}`,
        createdAt,
      });
      const account = base.creditAccount.get(userId);
      if (account) account.balance += credits;
      else base.creditAccount.set(userId, { userId, balance: credits, createdAt, updatedAt: createdAt });
    },
    balance: (userId: string) => base.creditAccount.get(userId)?.balance ?? 0,
    ledgerFor: (userId: string) => state.ledger.filter((l) => l.userId === userId),
    /** Sum of the ledger for a user (must always equal the balance). */
    ledgerSum: (userId: string) => state.ledger.filter((l) => l.userId === userId).reduce((s, l) => s + l.delta, 0),
    reset: () => {
      for (const t of Object.values(base)) t.clear();
      locks.clear();
    },
  };
}

// ---- Stripe -----------------------------------------------------------------

/** A Stripe API error (e.g. `stripeError("StripeInvalidRequestError", "resource_missing")`). */
export function stripeError(type: string, code: string, message = code): Error {
  return Object.assign(new Error(message), { type, code });
}

/** Every ordering of `items` (n! of them), for order-independence tests. */
export function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]),
  );
}

/** What a transient Stripe failure looks like (network/5xx): callers must retry. */
export function stripeConnectionError(message = "Stripe is unreachable"): Error {
  return Object.assign(new Error(message), { type: "StripeConnectionError" });
}

const list = (data: any[]) => ({ object: "list", data, has_more: false });

const DAY = 86_400;

/**
 * Stripe's period arithmetic: `anchor` plus `months` calendar months, keeping
 * the anchor's day and time and clamping to the target month's length.
 */
export function stripeAddMonths(anchorSec: number, months: number): number {
  const d = new Date(anchorSec * 1000);
  const m = d.getUTCMonth() + months;
  const year = d.getUTCFullYear() + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return (
    Date.UTC(year, month, Math.min(d.getUTCDate(), days), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) /
    1000
  );
}

type Interval = "month" | "year";
const intervalMonths = (i: Interval) => (i === "year" ? 12 : 1);

export function createFakeStripe() {
  let clock = 1_700_000_000;
  const s = {
    customers: new Map<string, Row>(),
    customerKeys: new Map<string, string>(),
    subscriptions: new Map<string, Row>(),
    sessions: new Map<string, Row>(),
    invoices: new Map<string, Row>(),
    invoiceLines: new Map<string, Row[]>(),
    invoicePayments: new Map<string, Row[]>(),
    refunds: [] as Row[],
    refundKeys: new Map<string, Row>(),
    charges: new Map<string, Row>(),
    prices: new Map<string, Row>(),
    portalSessions: [] as Row[],
    /** Calls made, by path ("refunds.create"), for assertions. */
    calls: [] as string[],
  };
  const failures = new Map<string, { error: () => Error; times: number }[]>();

  const nowSec = () => Math.floor(Date.now() / 1000);

  /** A subscription item for `price`, with its interval and current period. */
  function item(subId: string, priceId: string, interval: Interval, start: number, end: number) {
    return {
      id: `si_${subId}`,
      price: { id: priceId, recurring: { interval, interval_count: 1 } },
      current_period_start: start,
      current_period_end: end,
    };
  }

  /** Record a successful card payment for an invoice (charge + invoice payment). */
  function payInvoice(invoiceId: string, customer: string | null, amount: number): string {
    const piId = nextId("pi");
    s.charges.set(`ch_${piId}`, {
      id: `ch_${piId}`,
      object: "charge",
      payment_intent: piId,
      amount,
      amount_refunded: 0,
      refunded: false,
      customer,
    });
    s.invoicePayments.set(invoiceId, [
      ...(s.invoicePayments.get(invoiceId) ?? []),
      {
        id: nextId("inpay"),
        object: "invoice_payment",
        invoice: invoiceId,
        status: "paid",
        amount_paid: amount,
        payment: { type: "payment_intent", payment_intent: piId },
      },
    ]);
    return piId;
  }

  const stripe = {
    customers: {
      create: async (params: any, opts?: any) => {
        const key = opts?.idempotencyKey;
        if (key && s.customerKeys.has(key)) return { ...s.customers.get(s.customerKeys.get(key)!) };
        const c = { id: nextId("cus"), object: "customer", metadata: {}, ...params };
        s.customers.set(c.id, c);
        if (key) s.customerKeys.set(key, c.id);
        return { ...c };
      },
      retrieve: async (id: string) => {
        const c = s.customers.get(id);
        if (!c) throw stripeError("StripeInvalidRequestError", "resource_missing");
        return structuredClone(c);
      },
    },
    subscriptions: {
      list: async ({ customer }: any) =>
        list([...s.subscriptions.values()].filter((x) => x.customer === customer).map((x) => structuredClone(x))),
      retrieve: async (id: string) => {
        const sub = s.subscriptions.get(id);
        if (!sub) throw stripeError("StripeInvalidRequestError", "resource_missing");
        return structuredClone(sub);
      },
      cancel: async (id: string) => {
        const sub = s.subscriptions.get(id);
        if (!sub) throw stripeError("StripeInvalidRequestError", "resource_missing");
        // Stripe refuses a second cancel with an invalid-request error that
        // is NOT resource_missing.
        if (sub.status === "canceled") throw stripeError("StripeInvalidRequestError", "subscription_canceled");
        endSubscription(sub);
        return structuredClone(sub);
      },
      search: async ({ query }: any) => {
        const m = /metadata\['userId'\]:'([^']+)'/.exec(query);
        return list([...s.subscriptions.values()].filter((x) => x.metadata?.userId === m?.[1]).map((x) => structuredClone(x)));
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
      retrieve: async (id: string) => {
        const inv = s.invoices.get(id);
        if (!inv) throw stripeError("StripeInvalidRequestError", "resource_missing");
        return structuredClone(inv);
      },
      list: async ({ subscription, status }: any) =>
        list(
          [...s.invoices.values()]
            .filter((i) => (subscription ? i.parent?.subscription_details?.subscription === subscription : true))
            .filter((i) => (status ? i.status === status : true))
            .map((i) => structuredClone(i)),
        ),
      listLineItems: async (id: string) => list(s.invoiceLines.get(id) ?? []),
    },
    prices: {
      retrieve: async (id: string) => {
        const p = s.prices.get(id);
        if (!p) throw stripeError("StripeInvalidRequestError", "resource_missing");
        return structuredClone(p);
      },
    },
    invoicePayments: {
      list: async ({ invoice, payment }: any) => {
        const all = [...s.invoicePayments.values()].flat();
        return list(
          all
            .filter((p) => (invoice ? p.invoice === invoice : true))
            .filter((p) => (payment?.payment_intent ? p.payment.payment_intent === payment.payment_intent : true))
            .map((p) => structuredClone(p)),
        );
      },
    },
    refunds: {
      create: async (params: any, opts?: any) => {
        const key = opts?.idempotencyKey;
        if (key && s.refundKeys.has(key)) return { ...s.refundKeys.get(key)! };
        const charge = [...s.charges.values()].find((c) => c.payment_intent === params.payment_intent);
        if (!charge) throw stripeError("StripeInvalidRequestError", "resource_missing");
        const remaining = charge.amount - charge.amount_refunded;
        if (remaining <= 0) throw stripeError("StripeInvalidRequestError", "charge_already_refunded");
        const amount = Math.min(params.amount ?? remaining, remaining);
        charge.amount_refunded += amount;
        charge.refunded = charge.amount_refunded >= charge.amount;
        const refund = {
          id: nextId("re"),
          object: "refund",
          status: "succeeded",
          charge: charge.id,
          created: nowSec(),
          ...params,
          amount,
        };
        s.refunds.push(refund);
        if (key) s.refundKeys.set(key, refund);
        return { ...refund };
      },
      list: async ({ payment_intent }: any) =>
        list(s.refunds.filter((r) => r.payment_intent === payment_intent).map((r) => ({ ...r }))),
    },
    charges: {
      retrieve: async (id: string) => {
        const c = s.charges.get(id);
        if (!c) throw stripeError("StripeInvalidRequestError", "resource_missing");
        return { ...c };
      },
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

  // Every API call goes through the failure plan and the call log.
  function instrument(obj: Row, prefix: string) {
    for (const [name, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${name}` : name;
      if (typeof value === "function") {
        if (path === "webhooks.constructEvent") continue;
        obj[name] = async (...args: any[]) => {
          s.calls.push(path);
          const plan = failures.get(path);
          if (plan && plan.length > 0) {
            const next = plan[0];
            if (--next.times <= 0) plan.shift();
            throw next.error();
          }
          return (value as any)(...args);
        };
      } else if (value && typeof value === "object") {
        instrument(value, path);
      }
    }
  }
  instrument(stripe as Row, "");

  function endSubscription(sub: Row, at = nowSec()) {
    sub.status = "canceled";
    sub.canceled_at = at;
    sub.ended_at = at;
  }

  // ---- Scenario helpers (simulate what Stripe does on its side) ----

  /** An invoice for a subscription period, paid by card unless told otherwise. */
  function subscriptionInvoice(
    subId: string,
    opts: {
      id?: string;
      start: number;
      end: number;
      amount?: number;
      proration?: boolean;
      discount?: number;
      billingReason?: string;
      /** Extra lines (e.g. a negative proration credit) on the same invoice. */
      extraLines?: { amount: number; start: number; end: number }[];
      /** Credit applied from the customer's balance (cents, positive). */
      balanceApplied?: number;
      /** Leave it open (its payment failed). */
      unpaid?: boolean;
    },
  ) {
    const sub = s.subscriptions.get(subId)!;
    const id = opts.id ?? nextId("in");
    const amount = opts.amount ?? 800;
    const mk = (amt: number, start: number, end: number, proration: boolean, discount = 0) => ({
      id: nextId("il"),
      object: "line_item",
      amount: amt,
      discount_amounts: discount ? [{ amount: discount, discount: "di_1" }] : [],
      period: { start, end },
      parent: {
        type: "subscription_item_details",
        subscription_item_details: { proration, subscription: subId },
      },
    });
    const lines = [
      ...(opts.extraLines ?? []).map((l) => mk(l.amount, l.start, l.end, true)),
      mk(amount, opts.start, opts.end, opts.proration ?? false, opts.discount ?? 0),
    ];
    s.invoiceLines.set(id, lines);
    const total = lines.reduce((sum, l) => sum + l.amount - (l.discount_amounts[0]?.amount ?? 0), 0);
    const balanceApplied = Math.min(Math.max(0, total), opts.balanceApplied ?? 0);
    const due = Math.max(0, total - balanceApplied);
    const invoice = {
      id,
      object: "invoice",
      customer: sub.customer,
      status: opts.unpaid ? "open" : "paid",
      created: nowSec(),
      status_transitions: { paid_at: opts.unpaid ? null : nowSec() },
      billing_reason: opts.billingReason ?? "subscription_cycle",
      total,
      amount_due: due,
      amount_paid: opts.unpaid ? 0 : due,
      starting_balance: -balanceApplied,
      lines: { data: lines, has_more: false },
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: subId, metadata: { ...sub.metadata } },
      },
    };
    s.invoices.set(id, invoice);
    if (due > 0 && !opts.unpaid) payInvoice(id, sub.customer, due);
    return structuredClone(invoice);
  }

  /** Complete a checkout session as Stripe would after payment. */
  function completeSubscriptionCheckout(
    sessionId: string,
    opts: {
      status?: string;
      periodStart?: number;
      /** Explicit period end; default: one interval after the start (Stripe's rule). */
      periodEnd?: number;
      interval?: Interval;
      amount?: number;
    } = {},
  ) {
    const session = s.sessions.get(sessionId)!;
    if (session.status !== "open") throw stripeError("StripeInvalidRequestError", "session_not_open");
    const interval = opts.interval ?? (opts.periodStart && opts.periodEnd && opts.periodEnd - opts.periodStart > 300 * DAY ? "year" : "month");
    const start = opts.periodStart ?? ++clock;
    const end = opts.periodEnd ?? stripeAddMonths(start, intervalMonths(interval));
    const subId = nextId("sub");
    const invoiceId = nextId("in");
    const amount = opts.amount ?? (interval === "year" ? 8000 : 800);
    const priceId = session.line_items?.[0]?.price ?? (interval === "year" ? "price_year" : "price_month");
    s.subscriptions.set(subId, {
      id: subId,
      object: "subscription",
      created: nowSec(),
      customer: session.customer,
      status: opts.status ?? "active",
      metadata: { ...(session.subscription_data?.metadata ?? {}) },
      latest_invoice: invoiceId,
      billing_cycle_anchor: start,
      cancel_at_period_end: false,
      canceled_at: null,
      ended_at: null,
      items: { data: [item(subId, priceId, interval, start, end)] },
    });
    Object.assign(session, { status: "complete", payment_status: "paid", subscription: subId });
    const invoice = subscriptionInvoice(subId, { id: invoiceId, start, end, amount, billingReason: "subscription_create" });
    const paymentIntent = s.invoicePayments.get(invoiceId)?.[0]?.payment.payment_intent ?? null;
    return {
      session: { ...session },
      subscription: structuredClone(s.subscriptions.get(subId)!),
      invoice,
      paymentIntent,
      chargeId: paymentIntent ? `ch_${paymentIntent}` : null,
    };
  }

  /**
   * Renew a subscription into its next period (anchor-day arithmetic) and pay
   * the renewal: by card, or from the customer's credit balance.
   */
  function renewSubscription(subId: string, opts: { amount?: number; balanceApplied?: number } = {}) {
    const sub = s.subscriptions.get(subId)!;
    const it = sub.items.data[0];
    const months = intervalMonths(it.price.recurring.interval);
    // Count whole intervals from the anchor so the day never drifts.
    let n = 1;
    while (stripeAddMonths(sub.billing_cycle_anchor, n * months) <= it.current_period_end) n++;
    const start = it.current_period_end;
    const end = stripeAddMonths(sub.billing_cycle_anchor, n * months);
    it.current_period_start = start;
    it.current_period_end = end;
    const amount = opts.amount ?? (months === 12 ? 8000 : 800);
    const invoice = subscriptionInvoice(subId, { start, end, amount, balanceApplied: opts.balanceApplied });
    sub.latest_invoice = invoice.id;
    const paymentIntent = s.invoicePayments.get(invoice.id)?.[0]?.payment.payment_intent ?? null;
    return { invoice, subscription: structuredClone(sub), paymentIntent };
  }

  /**
   * Switch a subscription's price in the billing portal at `at` (seconds).
   * Changing the interval resets the billing anchor to `at`; the unused time
   * of the old period comes back as a proration credit on the same invoice,
   * and any excess goes to the customer's credit balance.
   */
  function switchPrice(subId: string, opts: { interval: Interval; at: number; amount?: number; unusedCredit: number }) {
    const sub = s.subscriptions.get(subId)!;
    const it = sub.items.data[0];
    const start = opts.at;
    const end = stripeAddMonths(start, intervalMonths(opts.interval));
    const amount = opts.amount ?? (opts.interval === "year" ? 8000 : 800);
    sub.billing_cycle_anchor = start;
    sub.items.data[0] = item(subId, opts.interval === "year" ? "price_year" : "price_month", opts.interval, start, end);
    const invoice = subscriptionInvoice(subId, {
      start,
      end,
      amount,
      billingReason: "subscription_update",
      extraLines: [{ amount: -opts.unusedCredit, start, end: it.current_period_end }],
    });
    sub.latest_invoice = invoice.id;
    return { invoice, subscription: structuredClone(sub) };
  }

  /** Complete a credit-pack checkout (paid now, or pending for async methods). */
  function completePackCheckout(sessionId: string, opts: { paid?: boolean } = {}) {
    const session = s.sessions.get(sessionId)!;
    const piId = nextId("pi");
    const amount = session.amount_total ?? 1000;
    s.charges.set(`ch_${piId}`, {
      id: `ch_${piId}`,
      object: "charge",
      payment_intent: piId,
      amount,
      amount_refunded: 0,
      refunded: false,
      customer: session.customer,
    });
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

  /**
   * Refund part or all of a charge on "Stripe" (by hand in the dashboard);
   * returns the charge.refunded payload. A `pending` refund (some payment
   * methods) can still fail later (failRefund).
   */
  function refundCharge(chargeId: string, amount?: number, opts: { status?: "succeeded" | "pending" } = {}) {
    const charge = s.charges.get(chargeId)!;
    const amt = Math.min(amount ?? charge.amount - charge.amount_refunded, charge.amount - charge.amount_refunded);
    charge.amount_refunded += amt;
    charge.refunded = charge.amount_refunded >= charge.amount;
    s.refunds.push({
      id: nextId("re"),
      object: "refund",
      status: opts.status ?? "succeeded",
      charge: chargeId,
      payment_intent: charge.payment_intent,
      amount: amt,
      created: nowSec(),
    });
    return { ...charge };
  }

  /** The latest refund of a charge (its Refund object). */
  function latestRefund(chargeId: string) {
    const r = [...s.refunds].reverse().find((x) => x.charge === chargeId);
    return r ? { ...r } : null;
  }

  /**
   * A refund fails (the bank returned it): Stripe gives the amount back to
   * the charge and sends charge.refund.updated with the Refund object, which
   * this returns.
   */
  function failRefund(refundId: string, failureReason = "expired_or_canceled_card") {
    const refund = s.refunds.find((r) => r.id === refundId)!;
    refund.status = "failed";
    refund.failure_reason = failureReason;
    const charge = s.charges.get(refund.charge);
    if (charge) {
      charge.amount_refunded -= refund.amount;
      charge.refunded = charge.amount_refunded >= charge.amount;
    }
    return { ...refund };
  }

  /** A dispute object for a charge (status as given). */
  function dispute(
    chargeId: string,
    opts: { id?: string; amount?: number; status?: string; reason?: string; created?: number } = {},
  ) {
    const charge = s.charges.get(chargeId)!;
    return {
      id: opts.id ?? nextId("dp"),
      object: "dispute",
      charge: chargeId,
      payment_intent: charge.payment_intent,
      amount: opts.amount ?? charge.amount,
      reason: opts.reason ?? "fraudulent",
      status: opts.status ?? "needs_response",
      created: opts.created ?? nowSec(),
    };
  }

  /**
   * A renewal whose card payment fails: Stripe advances the period anyway,
   * leaves the renewal invoice open and moves the subscription to past_due.
   * `payOpenInvoice` later pays it (the customer fixed their card).
   */
  function failRenewal(subId: string) {
    const sub = s.subscriptions.get(subId)!;
    const it = sub.items.data[0];
    const months = intervalMonths(it.price.recurring.interval);
    let n = 1;
    while (stripeAddMonths(sub.billing_cycle_anchor, n * months) <= it.current_period_end) n++;
    const start = it.current_period_end;
    const end = stripeAddMonths(sub.billing_cycle_anchor, n * months);
    it.current_period_start = start;
    it.current_period_end = end;
    const amount = months === 12 ? 8000 : 800;
    const invoice = subscriptionInvoice(subId, { start, end, amount, unpaid: true });
    sub.latest_invoice = invoice.id;
    sub.status = "past_due";
    return { invoice, subscription: structuredClone(sub) };
  }

  /** Pay a subscription's open invoice now (the retry succeeded): active again. */
  function payOpenInvoice(subId: string) {
    const sub = s.subscriptions.get(subId)!;
    const inv = s.invoices.get(sub.latest_invoice)!;
    inv.status = "paid";
    inv.amount_paid = inv.amount_due;
    inv.status_transitions = { paid_at: nowSec() };
    const paymentIntent = payInvoice(inv.id, sub.customer, inv.amount_due);
    sub.status = "active";
    return { invoice: structuredClone(inv), subscription: structuredClone(sub), paymentIntent };
  }

  return {
    stripe,
    state: s,
    completeSubscriptionCheckout,
    subscriptionInvoice,
    renewSubscription,
    switchPrice,
    completePackCheckout,
    markPackPaid,
    refundCharge,
    latestRefund,
    failRefund,
    dispute,
    failRenewal,
    payOpenInvoice,
    /** A Stripe Price (default: an active recurring monthly USD 5.00 price). */
    setPrice: (id: string, price: Row = {}) => {
      s.prices.set(id, {
        id,
        object: "price",
        active: true,
        type: "recurring",
        billing_scheme: "per_unit",
        currency: "usd",
        unit_amount: 500,
        recurring: { interval: "month", interval_count: 1 },
        ...price,
      });
    },
    /** Make the next `times` calls to `path` (e.g. "refunds.create") fail. */
    failNext: (path: string, opts: { error?: () => Error; times?: number } = {}) => {
      const plan = failures.get(path) ?? [];
      plan.push({ error: opts.error ?? (() => stripeConnectionError()), times: opts.times ?? 1 });
      failures.set(path, plan);
    },
    setSubscriptionStatus: (id: string, status: string) => {
      const sub = s.subscriptions.get(id)!;
      if (status === "canceled" || status === "incomplete_expired") endSubscription(sub);
      else sub.status = status;
    },
    /** Create a subscription directly (e.g. a legacy duplicate on another customer). */
    addSubscription: (sub: Row): Row => {
      const start = clock;
      const full: Row = {
        object: "subscription",
        created: clock,
        status: "active",
        metadata: {},
        latest_invoice: null,
        billing_cycle_anchor: start,
        canceled_at: null,
        ended_at: null,
        items: { data: [item(sub.id, "price_month", "month", start, stripeAddMonths(start, 1))] },
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
      failures.clear();
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
