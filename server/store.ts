// Run store: JSONL files are the replay source of truth (always on).
// Postgres (when DATABASE_URL is set) adds queryable rows alongside — never instead.
// Server boots fine with no database at all.
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { resolve, join } from "path";

export interface RunEvent {
  seq: number;
  t: number;
  type: "inject" | "message" | "decision" | "state" | "chat" | "link_change" | "probe" | "sart" | "tlx" | "run";
  actor: string;
  data: any;
}

export interface RunMeta {
  id: string;
  scenarioId: string;
  seed: number;
  deceptionObjective?: string;
  startedAt: string;
  status: string;
}

export interface RunStore {
  readonly kind: string;
  createRun(meta: Omit<RunMeta, "id" | "startedAt" | "status">): Promise<string>;
  appendEvent(runId: string, evt: Omit<RunEvent, "seq">): Promise<void>;
  appendView(runId: string, seat: string, tick: number, view: any): Promise<void>;
  appendTruth(runId: string, tick: number, truth: any): Promise<void>;
  getEvents(runId: string): Promise<RunEvent[]>;
  getViews(runId: string, seat: string): Promise<any[]>;
  getTruth(runId: string): Promise<any[]>;
  getRun(runId: string): Promise<RunMeta>;
  listRuns(): Promise<RunMeta[]>;
  close(): Promise<void>;
}

const RUNS_DIR = resolve(process.env.RUNS_DIR || "./runs");

function runDir(runId: string): string {
  return join(RUNS_DIR, runId);
}

export class JsonlStore implements RunStore {
  readonly kind = "jsonl";
  private seq = new Map<string, number>();

  async createRun(meta: Omit<RunMeta, "id" | "startedAt" | "status">): Promise<string> {
    const id = `${meta.scenarioId}-${Date.now().toString(36)}`;
    const dir = runDir(id);
    mkdirSync(join(dir, "views"), { recursive: true });
    const full: RunMeta = { ...meta, id, startedAt: new Date().toISOString(), status: "running" };
    writeFileSync(join(dir, "meta.json"), JSON.stringify(full, null, 2));
    writeFileSync(join(dir, "events.jsonl"), "");
    writeFileSync(join(dir, "groundTruth.jsonl"), "");
    this.seq.set(id, 0);
    return id;
  }

  async appendEvent(runId: string, evt: Omit<RunEvent, "seq">): Promise<void> {
    const seq = (this.seq.get(runId) ?? 0) + 1;
    this.seq.set(runId, seq);
    appendFileSync(join(runDir(runId), "events.jsonl"), JSON.stringify({ ...evt, seq }) + "\n");
  }

  async appendView(runId: string, seat: string, _tick: number, view: any): Promise<void> {
    appendFileSync(join(runDir(runId), "views", `${seat}.jsonl`), JSON.stringify(view) + "\n");
  }

  async appendTruth(runId: string, _tick: number, truth: any): Promise<void> {
    appendFileSync(join(runDir(runId), "groundTruth.jsonl"), JSON.stringify(truth) + "\n");
  }

  async getEvents(runId: string): Promise<RunEvent[]> {
    const f = join(runDir(runId), "events.jsonl");
    if (!existsSync(f)) throw new Error(`unknown run ${runId}`);
    return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }

  async getViews(runId: string, seat: string): Promise<any[]> {
    const f = join(runDir(runId), "views", `${seat}.jsonl`);
    if (!existsSync(f)) return [];
    return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }

  async getTruth(runId: string): Promise<any[]> {
    const f = join(runDir(runId), "groundTruth.jsonl");
    if (!existsSync(f)) return [];
    return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }

  async getRun(runId: string): Promise<RunMeta> {
    return JSON.parse(readFileSync(join(runDir(runId), "meta.json"), "utf8"));
  }

  async listRuns(): Promise<RunMeta[]> {
    if (!existsSync(RUNS_DIR)) return [];
    return readdirSync(RUNS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        try {
          return JSON.parse(readFileSync(join(RUNS_DIR, d.name, "meta.json"), "utf8")) as RunMeta;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as RunMeta[];
  }

  async close(): Promise<void> {}
}

/** Postgres mirror: dual-writes queryable rows; JSONL stays the source of truth.
 *  Any PG failure degrades to log-and-continue — the run never dies for the DB. */
export class PgStore implements RunStore {
  readonly kind = "jsonl+postgres";
  constructor(private readonly inner: JsonlStore, private readonly pool: any) {}

  async createRun(meta: Omit<RunMeta, "id" | "startedAt" | "status">): Promise<string> {
    const id = await this.inner.createRun(meta);
    try {
      await this.pool.query(
        "INSERT INTO runs(id, scenario_id, seed, deception_objective, status) VALUES($1,$2,$3,$4,'running')",
        [id, meta.scenarioId, meta.seed, meta.deceptionObjective ?? null],
      );
    } catch (e) {
      console.warn("[store] pg createRun failed, JSONL only:", (e as Error).message);
    }
    return id;
  }

  async appendEvent(runId: string, evt: Omit<RunEvent, "seq">): Promise<void> {
    await this.inner.appendEvent(runId, evt);
    try {
      if (evt.type === "message" || evt.type === "chat") {
        const m = evt.data;
        await this.pool.query(
          "INSERT INTO messages(run_id, t, from_seat, to_seat, kind, payload, origin, integrity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [runId, evt.t, m.from ?? evt.actor, m.to ?? null, m.kind ?? evt.type, m, m.meta?.origin ?? "truth", m.meta?.integrity ?? 1],
        );
      } else if (evt.type === "decision") {
        const d = evt.data;
        await this.pool.query(
          "INSERT INTO decisions(run_id, t, seat, decision_id, choice, rationale, confidence, ooda_s, correct) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [runId, evt.t, d.seat, d.decisionId, d.choice, d.rationale, d.confidence, d.ooda_latency_s, d.correct],
        );
      } else if (evt.type === "probe") {
        await this.pool.query("INSERT INTO probes(run_id, t, seat, freeze_id, score, total) VALUES($1,$2,$3,$4,$5,$6)", [
          runId, evt.t, evt.data.seat, evt.data.freezeId, evt.data.score, evt.data.total,
        ]);
      }
    } catch (e) {
      console.warn("[store] pg append failed, JSONL only:", (e as Error).message);
    }
  }

  async appendView(runId: string, seat: string, tick: number, view: any): Promise<void> {
    await this.inner.appendView(runId, seat, tick, view);
    try {
      if (tick % 40 === 0) {
        await this.pool.query("INSERT INTO metrics_snapshots(run_id, tick, t, seat, iis) VALUES($1,$2,$3,$4,$5)", [
          runId, tick, view.t, seat, view.iis,
        ]);
      }
    } catch (e) {
      console.warn("[store] pg snapshot failed:", (e as Error).message);
    }
  }

  async appendTruth(runId: string, tick: number, truth: any): Promise<void> {
    await this.inner.appendTruth(runId, tick, truth);
  }
  getEvents(runId: string) { return this.inner.getEvents(runId); }
  getViews(runId: string, seat: string) { return this.inner.getViews(runId, seat); }
  getTruth(runId: string) { return this.inner.getTruth(runId); }
  getRun(runId: string) { return this.inner.getRun(runId); }
  listRuns() { return this.inner.listRuns(); }
  async close(): Promise<void> { await this.pool.end(); }
}

export async function openStore(): Promise<RunStore> {
  const inner = new JsonlStore();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[store] no DATABASE_URL — JSONL-only mode (runs/ directory)");
    return inner;
  }
  try {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: url });
    await pool.query("SELECT 1");
    console.log("[store] postgres connected — dual-write mode");
    return new PgStore(inner, pool);
  } catch (e) {
    console.warn("[store] postgres unreachable, JSONL-only:", (e as Error).message);
    return inner;
  }
}
