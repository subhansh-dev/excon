// Replay scrubber payload — served by GET /api/runs/:id/replay (route wired by
// the owner in server/index.ts). Complements aar.ts: the AAR is the after-action
// report, this is the raw scrubable timeline — events, per-seat view snapshots
// and ground-truth snapshots, slimmed + downsampled so the client can fetch it
// in one shot and drag a playhead across the whole run.
import { existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import type { RunStore, RunEvent } from "./store.js";
import type { DecisionRecord } from "../shared/types.js";
import { deckTruth, entityList, labelMap, type EntityRef } from "./scenario.js";

export interface ReplayEvent {
  seq: number;
  t: number;
  type: string;
  actor: string;
  summary: string;
}

export interface ReplayUnit {
  id: string;
  x: number;
  y: number;
  status: string;
}

export interface ReplayAsset {
  id: string;
  status: string;
  x?: number;
  y?: number;
}

export interface ReplayLink {
  id: string;
  latency_ms: number;
  loss_pct: number;
  integrity: number;
  active: boolean;
}

export interface ReplayViewPoint {
  tick: number;
  t: number;
  iis: number;
  links: ReplayLink[];
  hot: string[];
  units: ReplayUnit[];
  assets: ReplayAsset[];
}

export interface ReplayTruthPoint {
  tick: number;
  t: number;
  units: ReplayUnit[];
  assets: ReplayAsset[];
}

export interface ReplayInject {
  t: number;
  label: string;
}

export interface ReplayDecision {
  t: number;
  seat: string;
  decisionId: string;
  choice: string;
  correct: boolean;
  ooda_latency_s: number;
}

export interface ReplayPayload {
  runId: string;
  scenario: string;
  seed: number;
  durationS: number;
  events: ReplayEvent[];
  seats: string[];
  views: Record<string, ReplayViewPoint[]>;
  truth: ReplayTruthPoint[];
  injects: ReplayInject[];
  decisions: ReplayDecision[];
  /** Entity universe for the divergence grid — deck labels, not raw ids. */
  entities: EntityRef[];
}

/** Per-series cap. Must-keep points (iis / truth-status changes) are never dropped. */
const MAX_POINTS = 240;
/** Fallback when a snapshot carries no `t`: scenarios run tick_ms=250 → 4 ticks/s. */
const TICK_S = 0.25;
/** Actors that never own a lane. */
const INFRA = new Set(["server", "router", "timeline", "instructor"]);

export async function buildReplay(runId: string, store: RunStore): Promise<ReplayPayload> {
  const meta = await store.getRun(runId);
  const events: RunEvent[] = await store.getEvents(runId);
  const truthRaw = await store.getTruth(runId);
  const seats = seatList(runId, events);

  let durationS = 0;
  for (const e of events) durationS = Math.max(durationS, Number(e.t) || 0);

  const views: Record<string, ReplayViewPoint[]> = {};
  for (const seat of seats) {
    const raw = await store.getViews(runId, seat);
    const slim = raw.map(slimView);
    for (const v of slim) durationS = Math.max(durationS, v.t);
    // Keep every iis change (the collapse IS the story), fill the rest evenly.
    views[seat] = downsample(slim, (v) => v.iis);
  }

  const truthSlim = truthRaw.map(slimTruth);
  for (const p of truthSlim) durationS = Math.max(durationS, p.t);
  const truth = downsample(truthSlim, statusSignature);

  const slimEvents: ReplayEvent[] = events.map((e) => ({
    seq: e.seq,
    t: e.t,
    type: e.type,
    actor: e.actor,
    summary: summarize(e),
  }));

  // Inject markers for the lane chart — injects and link patches both span lanes.
  const injects: ReplayInject[] = events
    .filter((e) => e.type === "inject" || e.type === "link_change")
    .map((e) => ({
      t: e.t,
      label: e.type === "inject" ? String(e.data?.type ?? "inject") : "link",
    }));

  // Answered decisions only — the server's "opened" bookkeeping rows have no seat.
  const decisions: ReplayDecision[] = events
    .filter((e) => e.type === "decision" && e.data?.choice)
    .map((e) => {
      const d = e.data as DecisionRecord;
      return {
        t: e.t,
        seat: String(d.seat ?? e.actor),
        decisionId: String(d.decisionId ?? d.id ?? ""),
        choice: String(d.choice ?? ""),
        correct: Boolean(d.correct),
        ooda_latency_s: Number(d.ooda_latency_s ?? 0),
      };
    });

  return {
    runId,
    scenario: meta.scenarioId,
    seed: meta.seed,
    durationS,
    events: slimEvents,
    seats,
    views,
    truth,
    injects,
    decisions,
    entities: entityList([{ truth: deckTruth(meta.scenarioId) }, ...truthRaw], labelMap(meta.scenarioId)),
  };
}

/** Lanes: every seat with stored view files, plus any seat that spoke/acted. */
function seatList(runId: string, events: RunEvent[]): string[] {
  const found = new Set<string>();
  try {
    // Same path rule as store.ts — filesystem view files own the lanes.
    const dir = join(resolve(process.env.RUNS_DIR || "./runs"), runId, "views");
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) if (f.endsWith(".jsonl")) found.add(f.slice(0, -".jsonl".length));
    }
  } catch {
    // Non-filesystem store: fall back to the event trail below.
  }
  for (const e of events) if (!INFRA.has(e.actor)) found.add(e.actor);
  return [...found].sort();
}

function slimView(v: any): ReplayViewPoint {
  return {
    tick: Number(v?.tick ?? 0),
    t: typeof v?.t === "number" ? v.t : Number(v?.tick ?? 0) * TICK_S,
    iis: typeof v?.iis === "number" ? v.iis : 0,
    links: (v?.links ?? []).map((l: any) => ({
      id: String(l?.id ?? ""),
      latency_ms: Number(l?.latency_ms ?? 0),
      loss_pct: Number(l?.loss_pct ?? 0),
      integrity: Number(l?.integrity ?? 1),
      active: l?.active !== false,
    })),
    hot: Array.isArray(v?.hot) ? v.hot.map((h: unknown) => String(h)) : [],
    units: (v?.units ?? []).map((u: any) => slimUnit(u)),
    assets: (v?.assets ?? []).map((a: any) => slimAsset(a)),
  };
}

function slimTruth(s: any): ReplayTruthPoint {
  const truth = s?.truth ?? {};
  return {
    tick: Number(s?.tick ?? 0),
    t: typeof s?.t === "number" ? s.t : Number(s?.tick ?? 0) * TICK_S,
    units: (truth.units ?? []).map((u: any) => slimUnit(u)),
    assets: (truth.assets ?? []).map((a: any) => ({ id: String(a?.id ?? ""), status: String(a?.status ?? "unknown") })),
  };
}

function slimUnit(u: any): ReplayUnit {
  return {
    id: String(u?.id ?? ""),
    x: Number(u?.x ?? 0),
    y: Number(u?.y ?? 0),
    status: String(u?.status ?? "unknown"),
  };
}

function slimAsset(a: any): ReplayAsset {
  const out: ReplayAsset = { id: String(a?.id ?? ""), status: String(a?.status ?? "unknown") };
  if (typeof a?.x === "number") out.x = a.x;
  if (typeof a?.y === "number") out.y = a.y;
  return out;
}

function statusSignature(p: ReplayTruthPoint): string {
  return (
    p.units.map((u) => `${u.id}:${u.status}`).join("|") +
    "#" +
    p.assets.map((a) => `${a.id}:${a.status}`).join("|")
  );
}

/**
 * Downsample to ~max points: always keep the first, last and every point where
 * the key changes (iis collapse, truth status flip); fill the budget evenly.
 * If must-keep points alone exceed max they are all kept — that shape is the
 * reason the scrubber exists.
 */
function downsample<T>(arr: T[], key: (p: T) => unknown, max = MAX_POINTS): T[] {
  if (arr.length <= max) return arr;
  const keep = new Array<boolean>(arr.length).fill(false);
  keep[0] = true;
  keep[arr.length - 1] = true;
  for (let i = 1; i < arr.length; i++) if (key(arr[i]) !== key(arr[i - 1])) keep[i] = true;
  let kept = 0;
  for (const k of keep) if (k) kept++;
  const budget = max - kept;
  if (budget > 0) {
    const stride = arr.length / (budget + 1);
    for (let k = 1; k <= budget && kept < max; k++) {
      let idx = Math.min(arr.length - 1, Math.max(0, Math.floor(k * stride)));
      while (idx < arr.length && keep[idx]) idx++;
      if (idx >= arr.length) break;
      keep[idx] = true;
      kept++;
    }
  }
  return arr.filter((_, i) => keep[i]);
}

/** Same rules as aar.ts summarize() — duplicated so aar.ts stays untouched. */
function summarize(e: RunEvent): string {
  const d = e.data ?? {};
  const arrow = "->";
  if (e.type === "inject") return "inject " + d.type + (d.link ? " " + d.link : "") + (d.from ? " " + d.from + arrow + d.to : "");
  if (e.type === "message") return d.from + arrow + d.to + ": " + String(d.text ?? "").slice(0, 80) + (d.dropped ? " [DROPPED]" : "");
  if (e.type === "decision") {
    if (!d.choice) return "opened " + d.opened;
    return d.seat + ": " + d.choice + " (" + (d.correct ? "correct" : "off-optimal") + "), OODA " + d.ooda_latency_s + "s";
  }
  if (e.type === "chat") return d.from + arrow + d.to + ": " + String(d.text ?? "").slice(0, 80);
  if (e.type === "link_change") return "link " + d.link + " patched";
  if (e.type === "probe") {
    if (!d.answers) return "freeze " + d.opened + " opened";
    return d.seat + " scored " + d.score + "/" + d.total + " (" + d.freezeId + ")";
  }
  if (e.type === "sart") return e.actor + " SART d=" + d.demand + " s=" + d.supply + " u=" + d.understanding;
  if (e.type === "run") return d.status ?? d.scenario ?? "run";
  return e.type;
}
