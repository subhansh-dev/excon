// Cross-run analytics index — one events pass per run, no view loading.
// Serves GET /api/analytics so the Analytics page makes ONE request instead of
// N+1 AAR fetches (a full AAR pulls every seat's view file just to read scores).
import type { RunStore, RunEvent, RunMeta } from "./store.js";
import { trimRunEvents, discoverSeats } from "./audit.js";
import { isVerifyRequest, verificationRate, meanWords } from "../shared/metrics.js";
import type { DecisionRecord } from "../shared/types.js";

export interface SeatSummary {
  seat: string;
  decisions: number;
  /** 0..1, null when the seat never answered a decision */
  accuracy: number | null;
  /** seconds, null when the seat has no scored decision */
  oodaMean: number | null;
  rationaleWords: number | null;
}

export interface RunSummary {
  id: string;
  scenario: string;
  seed: number;
  startedAt: string;
  status: string;
  decisions: number;
  /** 0..1, null when the run scored no decisions */
  accuracy: number | null;
  ooda: number | null;
  /** percent 0..100 — same denominator as the AAR (verifications / decisions) */
  verify: number;
  perSeat: SeatSummary[];
}

/** Single run → one summary row. Returns null when the trail cannot be read. */
export async function summarizeRun(meta: RunMeta, store: RunStore): Promise<RunSummary | null> {
  let events: RunEvent[];
  try {
    events = trimRunEvents(await store.getEvents(meta.id));
  } catch {
    return null;
  }

  const decisions = events.filter((e) => e.type === "decision" && e.data?.choice).map((e) => e.data as DecisionRecord);
  const scored = decisions.filter((d) => d.choice);

  // Same counting rule as the AAR's discipline table: dropped traffic is not a verification.
  let verifications = 0;
  for (const e of events) {
    if (e.type !== "chat") continue;
    const d = e.data ?? {};
    if (!d.dropped && isVerifyRequest(d.text)) verifications += 1;
  }

  const seats = discoverSeats(meta.id, events);
  const perSeat: SeatSummary[] = seats.map((seat) => {
    const ds = decisions.filter((d) => d.seat === seat);
    const mean = ds.length ? ds.reduce((s, d) => s + (d.ooda_latency_s ?? 0), 0) / ds.length : null;
    return {
      seat,
      decisions: ds.length,
      accuracy: ds.length ? ds.filter((d) => d.correct).length / ds.length : null,
      oodaMean: mean,
      rationaleWords: ds.length ? meanWords(ds.map((d) => d.rationale)) : null,
    };
  });

  const n = scored.length;
  return {
    id: meta.id,
    scenario: meta.scenarioId,
    seed: meta.seed,
    startedAt: meta.startedAt ?? "",
    status: meta.status ?? "unknown",
    decisions: n,
    accuracy: n ? scored.filter((d) => d.correct).length / n : null,
    ooda: n ? scored.reduce((s, d) => s + (d.ooda_latency_s ?? 0), 0) / n : null,
    verify: verificationRate(verifications, n),
    perSeat,
  };
}

/** Newest-first summaries for the analytics table. */
export async function summarizeRuns(store: RunStore, limit = 50): Promise<RunSummary[]> {
  const metas = await store.listRuns();
  const out: RunSummary[] = [];
  for (const meta of metas.slice(-limit)) {
    const row = await summarizeRun(meta, store);
    if (row) out.push(row);
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
