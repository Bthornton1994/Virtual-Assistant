// Test-only in-memory stand-in for the subset of the supabase-js query builder
// that SupabaseWorkspaceRepository uses. Not a general Supabase fake.
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export type FakeDb = {
  tables: Record<string, Row[]>;
  inserts: Array<{ table: string; rows: Row[] }>;
  from(table: string): Builder;
};

class Builder implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row[] = [];
  private patch: Row = {};
  private mode: "many" | "single" | "maybe" = "many";
  private max = Infinity;
  constructor(private db: FakeDb, private table: string) {}
  private rows() { return (this.db.tables[this.table] ??= []); }
  select() { return this; }
  insert(v: Row | Row[]) {
    this.op = "insert";
    this.payload = (Array.isArray(v) ? v : [v]).map((r) => ({ id: r.id ?? crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
    return this;
  }
  upsert(v: Row | Row[]) { this.insert(v); this.op = "upsert"; return this; }
  update(p: Row) { this.op = "update"; this.patch = p; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  order() { return this; }
  limit(n: number) { this.max = n; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  private run() {
    const t = this.rows();
    let out: Row[];
    if (this.op === "insert" || this.op === "upsert") {
      t.push(...this.payload);
      this.db.inserts.push({ table: this.table, rows: this.payload });
      out = this.payload;
    } else {
      const hit = t.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") hit.forEach((r) => Object.assign(r, this.patch));
      if (this.op === "delete") this.db.tables[this.table] = t.filter((r) => !hit.includes(r));
      out = hit.slice(0, this.max);
    }
    const data = this.mode === "many" ? out : (out[0] ?? null);
    return { data, error: null, count: out.length };
  }
  then<A, B>(ok?: (v: { data: unknown; error: null }) => A | PromiseLike<A>, bad?: (e: unknown) => B | PromiseLike<B>) {
    return Promise.resolve().then(() => this.run()).then(ok, bad);
  }
}

export function createFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = {
    tables: structuredClone(seed),
    inserts: [],
    from: (table: string) => new Builder(db, table),
  };
  return db;
}
