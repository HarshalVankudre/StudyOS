/**
 * Test helper: an in-memory stand-in for the Prisma client, only what
 * lib/workspace/store.ts and version-service.ts use. Text columns reject what
 * Postgres rejects (NUL, lone surrogates), so a write that would fail in
 * production fails here too. Transactions roll back on throw.
 */
type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

function matches(row: Row, where: Where = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "deletedAt") {
      const at = row.deletedAt as Date | null | undefined;
      if (v === null) {
        if (at != null) return false;
      } else if (typeof v === "object" && v !== null) {
        const cond = v as { not?: null; gte?: Date; lt?: Date };
        if ("not" in cond && cond.not === null && at == null) return false;
        if (cond.gte && !(at && at >= cond.gte)) return false;
        if (cond.lt && !(at && at < cond.lt)) return false;
      }
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function pick(row: Row, select?: Record<string, unknown>): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const k of Object.keys(select)) out[k] = row[k];
  return out;
}

function checkText(v: unknown) {
  if (typeof v !== "string") return;
  if (v.includes("\u0000")) throw new Error("invalid byte sequence for encoding UTF8: 0x00");
  const wellFormed = (v as { isWellFormed?: () => boolean }).isWellFormed;
  if (typeof wellFormed === "function" && !wellFormed.call(v)) throw new Error("lone surrogate");
}

export interface MemoryTable {
  rows: Row[];
  findFirst(args?: { where?: Where; select?: Record<string, unknown> }): Promise<Row | null>;
  findMany(args?: { where?: Where }): Promise<Row[]>;
  create(args: { data: Row; select?: Record<string, unknown> }): Promise<Row>;
  update(args: { where: Where; data: Row }): Promise<Row>;
  updateMany(args: { where: Where; data: Row }): Promise<{ count: number }>;
  deleteMany(args: { where: Where }): Promise<{ count: number }>;
}

export interface MemoryPrisma {
  /** Called after every write of a workspace's document (tests record versions). */
  onWrite: ((row: Row) => void) | null;
  workspace: MemoryTable;
  workspaceChange: MemoryTable;
  $transaction<T>(fn: (tx: MemoryPrisma) => Promise<T>): Promise<T>;
}

function table(name: string, owner: () => MemoryPrisma): MemoryTable {
  const rows: Row[] = [];
  let n = 0;
  return {
    rows,
    async findFirst({ where, select } = {}) {
      const r = rows.find((x) => matches(x, where));
      return r ? pick(r, select) : null;
    },
    async findMany({ where } = {}) {
      return rows.filter((x) => matches(x, where)).map((r) => ({ ...r }));
    },
    async create({ data, select }) {
      n += 1;
      const row: Row = { id: data.id ?? `${name}-${n}`, version: 1, deletedAt: null, createdAt: new Date(), ...data };
      checkText(row.name);
      checkText(row.icon);
      rows.push(row);
      return pick(row, select);
    },
    async update({ where, data }) {
      const r = rows.find((x) => matches(x, where));
      if (!r) throw new Error("not found");
      Object.assign(r, data);
      return { ...r };
    },
    async updateMany({ where, data }) {
      let count = 0;
      for (const r of rows) {
        if (!matches(r, where)) continue;
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in v) {
            r[k] = (r[k] as number) + (v as { increment: number }).increment;
          } else {
            if (k === "name" || k === "icon") checkText(v);
            r[k] = v;
          }
        }
        count += 1;
        if (name === "workspace" && "data" in data) owner().onWrite?.(r);
      }
      return { count };
    },
    async deleteMany({ where }) {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (matches(rows[i], where)) {
          rows.splice(i, 1);
          count += 1;
        }
      }
      return { count };
    },
  };
}

export function createMemoryPrisma(): MemoryPrisma {
  const db: MemoryPrisma = {
    onWrite: null,
    workspace: table("workspace", () => db),
    workspaceChange: table("change", () => db),
    async $transaction(fn) {
      const snap = {
        ws: db.workspace.rows.map((r) => ({ ...r })),
        ch: db.workspaceChange.rows.map((r) => ({ ...r })),
      };
      try {
        return await fn(db);
      } catch (error) {
        db.workspace.rows.splice(0, Infinity, ...snap.ws);
        db.workspaceChange.rows.splice(0, Infinity, ...snap.ch);
        throw error;
      }
    },
  };
  return db;
}
