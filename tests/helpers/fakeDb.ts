// tests/helpers/fakeDb.ts — minimal in-memory stand-in for a Supabase client.
// Covers the PostgREST builder subset our collectors/libs use: insert/update/
// delete/select with eq/in/lte/gte/gt/lt/is filters, order, limit, maybeSingle,
// single. Auto-assigns integer ids and enforces configurable unique columns
// (returns error code 23505, like Postgres). Reusable across module tests.
type Row = Record<string, any>;

interface Opts {
  unique?: Record<string, string[]>; // table -> columns that must be unique
}

export interface FakeDb {
  from(table: string): QueryBuilder;
  _rows(table: string): Row[];
}

export function createFakeDb(seed: Record<string, Row[]> = {}, opts: Opts = {}): FakeDb {
  const store: Record<string, Row[]> = {};
  const seq: Record<string, number> = {};
  for (const [t, rows] of Object.entries(seed)) store[t] = rows.map((r) => ({ ...r }));

  const db: FakeDb = {
    from: (table) => new QueryBuilder(table, store, seq, opts),
    _rows: (table) => store[table] ?? [],
  };
  return db;
}

type FilterOp = "eq" | "in" | "lte" | "gte" | "gt" | "lt" | "is";

class QueryBuilder implements PromiseLike<{ data: any; error: any }> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private values: Row | Row[] | null = null;
  private filters: [FilterOp, string, any][] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private wantSingle = false;
  private wantMaybe = false;

  constructor(
    private table: string,
    private store: Record<string, Row[]>,
    private seq: Record<string, number>,
    private opts: Opts
  ) {
    if (!this.store[table]) this.store[table] = [];
  }

  insert(v: Row | Row[]) { this.op = "insert"; this.values = v; return this; }
  update(v: Row) { this.op = "update"; this.values = v; return this; }
  delete() { this.op = "delete"; return this; }
  select(_cols?: string) { return this; }
  eq(col: string, val: any) { this.filters.push(["eq", col, val]); return this; }
  in(col: string, val: any[]) { this.filters.push(["in", col, val]); return this; }
  lte(col: string, val: any) { this.filters.push(["lte", col, val]); return this; }
  gte(col: string, val: any) { this.filters.push(["gte", col, val]); return this; }
  gt(col: string, val: any) { this.filters.push(["gt", col, val]); return this; }
  lt(col: string, val: any) { this.filters.push(["lt", col, val]); return this; }
  is(col: string, val: any) { this.filters.push(["is", col, val]); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.orderBy = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.limitN = n; return this; }
  maybeSingle() { this.wantMaybe = true; return this.run(); }
  single() { this.wantSingle = true; return this.run(); }
  then<R1 = any, R2 = never>(
    onOk?: ((v: { data: any; error: any }) => R1 | PromiseLike<R1>) | null,
    onErr?: ((r: any) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> { return this.run().then(onOk, onErr); }

  private match(row: Row): boolean {
    return this.filters.every(([f, col, val]) => {
      const v = row[col];
      switch (f) {
        case "eq": return v === val;
        case "in": return (val as any[]).includes(v);
        case "lte": return v <= val;
        case "gte": return v >= val;
        case "gt": return v > val;
        case "lt": return v < val;
        case "is": return val === null ? v == null : v === val;
      }
    });
  }

  private async run(): Promise<{ data: any; error: any }> {
    const rows = this.store[this.table];
    const uniques = this.opts.unique?.[this.table] ?? [];

    if (this.op === "insert") {
      const toInsert = (Array.isArray(this.values) ? this.values : [this.values]) as Row[];
      const inserted: Row[] = [];
      for (const raw of toInsert) {
        for (const u of uniques) {
          if (raw[u] != null && rows.some((r) => r[u] === raw[u])) {
            return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${u}` } };
          }
        }
        this.seq[this.table] = (this.seq[this.table] ?? 0) + 1;
        const row = { id: this.seq[this.table], ...raw };
        rows.push(row);
        inserted.push(row);
      }
      const data = this.wantSingle || this.wantMaybe ? inserted[0] ?? null : inserted;
      return { data, error: null };
    }

    const selected = rows.filter((r) => this.match(r));

    if (this.op === "update") {
      for (const r of selected) Object.assign(r, this.values);
      const data = this.wantSingle || this.wantMaybe ? selected[0] ?? null : selected;
      return { data, error: null };
    }
    if (this.op === "delete") {
      this.store[this.table] = rows.filter((r) => !this.match(r));
      return { data: null, error: null };
    }

    // select
    let out = [...selected];
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.limitN != null) out = out.slice(0, this.limitN);
    if (this.wantSingle) return { data: out[0] ?? null, error: out.length ? null : { code: "PGRST116" } };
    if (this.wantMaybe) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
}
