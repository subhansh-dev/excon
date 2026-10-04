// Counterfactual analysis — HONEST port of the rival FOG-LAB CounterfactualEngine idea.
//
// The rival's backend/app/analytics/counterfactual.py lines 57-71 are theatre: a fixed
// `* 0.65` latency multiplier, a hardcoded `EARLY_DECOY_DISCOVERY_OPTIMAL_STRIKE`
// outcome, constant session ids, and a re-simulation whose result is discarded.
// None of that is copied. This module is a PURE FUNCTION of the recorded run
// (events.jsonl + views/*.jsonl + groundTruth.jsonl): no re-simulation, no randomness,
// no Date.now()/crypto — same inputs always give the same numbers.
//
//   basis: "recorded-run replay (no re-simulation)"
//   confidence: "derived-from-log"
//
// Formulas (each also documented at its call site):
//   clean_links (a) picture fidelity
//     actual_iis(seat, tick) = computeIIS(view, truth[tick])            (shared/metrics.ts)
//     degraded(e)            = e.status==="unknown" || e.age_s>=60 || e.confidence<0.5
//     cf_view                = view with every degraded entity repaired to truth[tick]
//                              (units: x,y,status; assets: status[,x,y])
//     cf_iis(seat, tick)     = computeIIS(cf_view, truth[tick])
//     per-seat mean          = arithmetic mean over that seat's snapshots
//     team mean              = unweighted mean of the per-seat means
//     time-weighted mean     = per-seat, weight(snapshot i) = t(i+1)-t(i) (last snapshot
//                              holds its previous gap); team = mean of per-seat values
//   clean_links (b) decision latency
//     latencyS               = max(latency_ms of the seat's links at the nearest stored
//                              snapshot with t <= decision.t) / 1000   (0 if none stored)
//     cf_ooda                = max(2.0, recorded ooda_latency_s - latencyS)
//                              2.0s = human floor (a person cannot beat 2.0s); the floor
//                              only BOUNDS reductions — a recorded latency already at or
//                              below 2.0s (instant demo answers log ooda=0) is kept
//                              exactly as recorded, because inventing extra latency the
//                              log doesn't show would be the rival's sin in reverse.
//   suppress_spoof
//     spoof injects          = events where type==="inject" && data.meta.origin==="spoof"
//     actual conflicted      = decisions with a degraded context link (active===false ||
//                              integrity<1) OR a spoof fired <=120s before (same 120s
//                              window room.ts keeps report/event flags hot)
//     cf conflicted          = same rule with the spoof term removed (link-based only)
//     hot burden             = mean(count of view.hot entries) over a seat's snapshots;
//                              cf drops ids named by a spoof inject (payload.asset/unit)
//                              inside that inject's 120s flag window
//     budget                 = shared/metrics.ts uncertaintyBudget(final-picture counts,
//                              identical counting to aar.ts) with spoof-attributable
//                              unresolved claims removed
import { computeIIS, uncertaintyBudget } from "../shared/metrics.js";
import type { DegradedView, GroundTruth, ViewAsset, ViewUnit } from "../shared/types.js";
import type { RunEvent, RunStore } from "./store.js";
import {
  discoverSeats,
  loadTruthRows,
  loadViews,
  pickTruth,
  trimRunEvents,
} from "./audit.js";

export type CounterfactualMode = "clean_links" | "suppress_spoof";

/** A person cannot close an OODA loop faster than this — the counterfactual floor. */
const HUMAN_FLOOR_S = 2.0;
/** room.ts keeps a report/event flag hot for 120 sim-seconds after the inject. */
const SPOOF_WINDOW_S = 120;
/** Degradation thresholds — the same ones aar.ts prices defects at. */
const STALE_AGE_S = 60;
const LOW_CONFIDENCE = 0.5;

interface Variable {
  label: string;
  value: string;
}

interface IisStats {
  perSeat: Record<string, number | null>;
  teamMean: number | null;
  timeWeightedMean: number | null;
  snapshots: number;
  /** Snapshots whose tick had no exact ground-truth row (nearest-earlier row used). */
  truthTickFallbacks: number;
}

interface OodaStats {
  meanS: number | null;
  n: number;
}

interface OodaRow {
  seat: string;
  decisionId: string;
  actual_s: number;
  cf_s: number;
  delta_s: number;
}

interface HotBurdenStats {
  perSeat: Record<string, number | null>;
  teamMean: number | null;
  snapshots: number;
}

interface ConflictStats {
  n: number;
  total: number;
}

interface CounterfactualBase {
  runId: string;
  basis: string;
  variables: Variable[];
  narrative: string;
  confidence: "derived-from-log";
}

export type CounterfactualResult =
  | (CounterfactualBase & {
      mode: "clean_links";
      actual: { iis: IisStats; ooda: OodaStats };
      counterfactual: { iis: IisStats; ooda: OodaStats & { decisions: OodaRow[] } };
      delta: {
        iis: { perSeat: Record<string, number | null>; teamMean: number | null; timeWeightedMean: number | null };
        ooda: { meanS: number | null; n: number };
      };
    })
  | (CounterfactualBase & {
      mode: "suppress_spoof";
      actual: {
        spoofInjects: number;
        conflictedDecisions: ConflictStats;
        hotBurden: HotBurdenStats;
        uncertaintyBudget: number | null;
      };
      counterfactual: {
        spoofInjects: number;
        conflictedDecisions: ConflictStats;
        hotBurden: HotBurdenStats;
        uncertaintyBudget: number | null;
      };
      delta: {
        conflictedDecisions: number | null;
        hotBurden: { perSeat: Record<string, number | null>; teamMean: number | null };
        uncertaintyBudget: number | null;
        spoofAttributableHotIds: number;
      };
    });

export async function runCounterfactual(
  runId: string,
  store: RunStore,
  mode: CounterfactualMode,
): Promise<CounterfactualResult> {
  return mode === "suppress_spoof" ? suppressSpoof(runId, store) : cleanLinks(runId, store);
}

// ---------------------------------------------------------------------------
// mode: clean_links — "what if every link had been clean"
// ---------------------------------------------------------------------------

async function cleanLinks(runId: string, store: RunStore): Promise<CounterfactualResult> {
  const events = trimRunEvents(await store.getEvents(runId));
  const seats = discoverSeats(runId, events);
  const viewsBySeat = await loadViews(runId, store, seats);
  const truthRows = await loadTruthRows(runId, store);

  // (a) picture fidelity -----------------------------------------------------
  const actualPerSeat: Record<string, number | null> = {};
  const cfPerSeat: Record<string, number | null> = {};
  const actualTw: Record<string, number | null> = {};
  const cfTw: Record<string, number | null> = {};
  let snapshots = 0;
  let truthFallbacks = 0;
  let snapshotsNoTruth = 0;
  let repairedEntries = 0;

  for (const seat of seats) {
    const views = viewsBySeat.get(seat) ?? [];
    const aSamples: { t: number; v: number }[] = [];
    const cSamples: { t: number; v: number }[] = [];
    for (const v of views) {
      const hit = pickTruth(truthRows, v.tick);
      let a: number | null = null;
      let c: number | null = null;
      if (hit) {
        if (!hit.exact) truthFallbacks += 1;
        a = computeIIS(v, hit.row.truth);
        const repaired = repairView(v, hit.row.truth);
        repairedEntries += repaired.repaired;
        c = computeIIS(repaired.view, hit.row.truth);
        snapshots += 1;
      } else {
        // No ground truth at all for this run: only the stamped iis exists, and a
        // repaired series cannot be derived — actual === counterfactual here.
        snapshotsNoTruth += 1;
        if (typeof v.iis === "number") {
          a = v.iis;
          c = v.iis;
          snapshots += 1;
        }
      }
      if (a === null || c === null) continue;
      aSamples.push({ t: v.t, v: a });
      cSamples.push({ t: v.t, v: c });
    }
    actualPerSeat[seat] = aSamples.length ? r3(mean(aSamples.map((s) => s.v))) : null;
    cfPerSeat[seat] = cSamples.length ? r3(mean(cSamples.map((s) => s.v))) : null;
    actualTw[seat] = timeWeighted(aSamples);
    cfTw[seat] = timeWeighted(cSamples);
  }

  const iisActual: IisStats = {
    perSeat: actualPerSeat,
    teamMean: teamMean(actualPerSeat),
    timeWeightedMean: teamMean(actualTw),
    snapshots,
    truthTickFallbacks: truthFallbacks,
  };
  const iisCf: IisStats = {
    perSeat: cfPerSeat,
    teamMean: teamMean(cfPerSeat),
    timeWeightedMean: teamMean(cfTw),
    snapshots,
    truthTickFallbacks: truthFallbacks,
  };

  // (b) decision latency -----------------------------------------------------
  const rows: OodaRow[] = [];
  for (const e of events) {
    if (e.type !== "decision") continue;
    const d = e.data;
    if (!d?.choice || typeof d.ooda_latency_s !== "number" || !Number.isFinite(d.ooda_latency_s)) continue;
    const seat = String(d.seat ?? e.actor);
    const actualS = d.ooda_latency_s;
    const snap = lastViewAtOrBefore(viewsBySeat.get(seat) ?? [], e.t);
    const latMs = snap ? Math.max(0, ...(snap.links ?? []).map((l) => Number(l.latency_ms) || 0)) : 0;
    const cfS = r1(
      actualS <= HUMAN_FLOOR_S ? actualS : Math.max(HUMAN_FLOOR_S, actualS - latMs / 1000),
    );
    rows.push({
      seat,
      decisionId: String(d.decisionId ?? d.id ?? "?"),
      actual_s: r1(actualS),
      cf_s: cfS,
      delta_s: r1(cfS - r1(actualS)),
    });
  }
  const oodaActual: OodaStats = {
    meanS: rows.length ? r1(mean(rows.map((r) => r.actual_s))) : null,
    n: rows.length,
  };
  const oodaCf: OodaStats & { decisions: OodaRow[] } = {
    meanS: rows.length ? r1(mean(rows.map((r) => r.cf_s))) : null,
    n: rows.length,
    decisions: rows,
  };

  const deltaIis = {
    perSeat: mapValues(actualPerSeat, (a, k) => (a === null || cfPerSeat[k] === null ? null : r3((cfPerSeat[k] as number) - a))),
    teamMean: diff(iisCf.teamMean, iisActual.teamMean, r3),
    timeWeightedMean: diff(iisCf.timeWeightedMean, iisActual.timeWeightedMean, r3),
  };
  const deltaOoda = {
    meanS: diff(oodaCf.meanS, oodaActual.meanS, r1),
    n: rows.length,
  };

  // (c) narrative — threshold/plain-text rendering of the deltas above only.
  const narrative = [
    narrativeIis(iisActual, iisCf, seats.filter((s) => (viewsBySeat.get(s) ?? []).length > 0).length, repairedEntries),
    narrativeOoda(oodaActual, oodaCf),
    `Basis: recorded-run replay of ${snapshots} stored snapshot(s) and ${rows.length} recorded decision(s); mission outcome beyond these quantities is not derivable from log.`,
  ].join(" ");

  return {
    runId,
    mode: "clean_links",
    basis:
      "recorded-run replay (no re-simulation): IIS recomputed from stored view snapshots against the ground-truth tick via shared/metrics.computeIIS, with degraded entries (status=unknown | age_s>=60 | confidence<0.5) repaired to truth for the counterfactual series; OODA latency is the recorded value minus the seat's recorded max link latency at the nearest earlier snapshot (2.0s human floor, and a recorded latency already <=2.0s is kept as recorded). Quantities absent from the log are reported as not derivable, never invented.",
    variables: [
      { label: "Modified variable", value: "seat-feed link degradation as recorded (latency, loss, staleness in views/*.jsonl)" },
      { label: "Counterfactual rule", value: "degraded view entries repaired to the ground-truth value at the same tick; cf_ooda = max(2.0, ooda - maxLinkLatency_s), with recorded latencies <=2.0s kept as recorded" },
      { label: "Held constant", value: "every recorded decision, its timing, and the run's ground-truth evolution" },
    ],
    actual: { iis: iisActual, ooda: oodaActual },
    counterfactual: { iis: iisCf, ooda: oodaCf },
    delta: { iis: deltaIis, ooda: deltaOoda },
    narrative,
    confidence: "derived-from-log",
  };
}

// ---------------------------------------------------------------------------
// mode: suppress_spoof — "what if spoofed/false injects never fired"
// ---------------------------------------------------------------------------

interface SpoofWindow {
  id: string;
  start: number;
  end: number;
}

async function suppressSpoof(runId: string, store: RunStore): Promise<CounterfactualResult> {
  const events = trimRunEvents(await store.getEvents(runId));
  const seats = discoverSeats(runId, events);
  const viewsBySeat = await loadViews(runId, store, seats);

  const spoofEvents = events.filter((e) => e.type === "inject" && e.data?.meta?.origin === "spoof");
  const spoofTimes = spoofEvents.map((e) => e.t);
  // Ids a spoof actually named (room.ts only flags payload.asset/payload.unit).
  const spoofWindows: SpoofWindow[] = [];
  for (const e of spoofEvents) {
    const id = e.data?.payload?.asset ?? e.data?.payload?.unit;
    if (typeof id === "string" && id) spoofWindows.push({ id, start: e.t, end: e.t + SPOOF_WINDOW_S });
  }
  const spoofCovers = (id: string, t: number) =>
    spoofWindows.some((w) => w.id === id && t >= w.start && t <= w.end);

  // Conflicted decisions (same rule aar.ts scores contradictionAwareness with).
  const decisions = events.filter(
    (e) => e.type === "decision" && e.data?.choice && typeof e.data.ooda_latency_s === "number",
  );
  const linksDegraded = (d: Record<string, any>) =>
    ((d.context?.links ?? []) as { active?: boolean; integrity?: number }[]).some(
      (l) => l.active === false || (l.integrity ?? 1) < 1,
    );
  const actualConflicted = decisions.filter(
    (d) => linksDegraded(d.data) || spoofTimes.some((t) => d.data.t >= t && d.data.t <= t + SPOOF_WINDOW_S),
  ).length;
  const cfConflicted = decisions.filter((d) => linksDegraded(d.data)).length;

  // Hot burden: mean count of flagged items per snapshot, per seat.
  const actualHot: Record<string, number | null> = {};
  const cfHot: Record<string, number | null> = {};
  let hotSnapshots = 0;
  for (const seat of seats) {
    const views = viewsBySeat.get(seat) ?? [];
    if (!views.length) {
      actualHot[seat] = null;
      cfHot[seat] = null;
      continue;
    }
    let aSum = 0;
    let cSum = 0;
    for (const v of views) {
      const hot = v.hot ?? [];
      aSum += hot.length;
      cSum += hot.filter((id) => !spoofCovers(String(id), v.t)).length;
      hotSnapshots += 1;
    }
    actualHot[seat] = r2(aSum / views.length);
    cfHot[seat] = r2(cSum / views.length);
  }
  const actualHotBurden: HotBurdenStats = { perSeat: actualHot, teamMean: teamMean(actualHot), snapshots: hotSnapshots };
  const cfHotBurden: HotBurdenStats = { perSeat: cfHot, teamMean: teamMean(cfHot), snapshots: hotSnapshots };

  // Uncertainty budget — identical counting to aar.ts (final picture per seat).
  const actualBudget = finalBudget(viewsBySeat, seats, () => true);
  const cfBudget = finalBudget(viewsBySeat, seats, (v, id) => !spoofCovers(id, v.t));

  const deltaConflicted = cfConflicted - actualConflicted;
  const deltaBudget =
    actualBudget.value === null || cfBudget.value === null ? null : r1(cfBudget.value - actualBudget.value);

  const narrative = narrativeSpoof({
    spoofCount: spoofEvents.length,
    actualConflicted,
    cfConflicted,
    totalDecisions: decisions.length,
    actualHot: actualHotBurden.teamMean,
    cfHot: cfHotBurden.teamMean,
    actualBudget: actualBudget.value,
    cfBudget: cfBudget.value,
    attributableIds: spoofWindows.length,
    hasViews: actualBudget.value !== null,
  });

  return {
    runId,
    mode: "suppress_spoof",
    basis:
      "recorded-run replay (no re-simulation): spoof injects are events with data.meta.origin === 'spoof'; the counterfactual drops them and re-derives conflicted decisions, hot burden and uncertainty budget from the same trail. Hot/uncertainty spoof attribution is per-item ONLY for ids named by a spoof inject (payload.asset/payload.unit) inside its 120s flag window — a spoof that named no id contributes no attributable hot entry, so those entries are retained unchanged (approximation: unattributable hot flags are kept, not guessed away). Mission outcome beyond these quantities is not derivable from log.",
    variables: [
      { label: "Modified variable", value: "injects with data.meta.origin === 'spoof' removed from the trail" },
      { label: "Counterfactual rule", value: `conflicted decisions lose the spoof-within-${SPOOF_WINDOW_S}s term; hot entries and unresolved claims named by a spoof are dropped; all other recorded data unchanged` },
      { label: "Held constant", value: "link degradation, recorded decisions, stored views and ground truth" },
    ],
    actual: {
      spoofInjects: spoofEvents.length,
      conflictedDecisions: { n: actualConflicted, total: decisions.length },
      hotBurden: actualHotBurden,
      uncertaintyBudget: actualBudget.value,
    },
    counterfactual: {
      spoofInjects: 0,
      conflictedDecisions: { n: cfConflicted, total: decisions.length },
      hotBurden: cfHotBurden,
      uncertaintyBudget: cfBudget.value,
    },
    delta: {
      conflictedDecisions: deltaConflicted,
      hotBurden: {
        perSeat: mapValues(actualHot, (a, k) => (a === null || cfHot[k] === null ? null : r2((cfHot[k] as number) - a))),
        teamMean: diff(cfHotBurden.teamMean, actualHotBurden.teamMean, r2),
      },
      uncertaintyBudget: deltaBudget,
      spoofAttributableHotIds: spoofWindows.length,
    },
    narrative,
    confidence: "derived-from-log",
  };
}

// ---------------------------------------------------------------------------
// helpers (pure, deterministic)
// ---------------------------------------------------------------------------

function isDegraded(status: string, ageS: number | undefined, confidence: number | undefined): boolean {
  return status === "unknown" || (ageS ?? 0) >= STALE_AGE_S || (confidence ?? 1) < LOW_CONFIDENCE;
}

/** Counterfactual view: every degraded entry replaced by the truth value at that tick. */
function repairView(view: DegradedView, truth: GroundTruth): { view: DegradedView; repaired: number } {
  let repaired = 0;
  const tunits = new Map((truth.units ?? []).map((u) => [u.id, u]));
  const units: ViewUnit[] = (view.units ?? []).map((u) => {
    if (!isDegraded(u.status, u.age_s, u.confidence)) return u;
    const tu = tunits.get(u.id);
    if (!tu) return u;
    repaired += 1;
    return { ...u, x: tu.x, y: tu.y, status: tu.status };
  });
  const tassets = new Map((truth.assets ?? []).map((a) => [a.id, a]));
  const assets: ViewAsset[] = (view.assets ?? []).map((a) => {
    if (!isDegraded(a.status, a.age_s, a.confidence)) return a;
    const ta = tassets.get(a.id);
    if (!ta) return a;
    repaired += 1;
    const fixed: ViewAsset = { ...a, status: ta.status };
    if (typeof ta.x === "number" && typeof ta.y === "number") {
      fixed.x = ta.x;
      fixed.y = ta.y;
    }
    return fixed;
  });
  return { view: { ...view, units, assets }, repaired };
}

function lastViewAtOrBefore(views: DegradedView[], t: number): DegradedView | null {
  let best: DegradedView | null = null;
  for (const v of views) {
    if (v.t <= t) best = v;
    else break;
  }
  return best;
}

function finalBudget(
  viewsBySeat: Map<string, DegradedView[]>,
  seats: string[],
  keepUnresolved: (v: DegradedView, id: string) => boolean,
): { value: number | null } {
  const unresolved = new Set<string>();
  const stale = new Set<string>();
  const unavailable = new Set<string>();
  const lowConfidence = new Set<string>();
  let anyView = false;
  for (const seat of seats) {
    const views = viewsBySeat.get(seat) ?? [];
    const last = views[views.length - 1];
    if (!last) continue;
    anyView = true;
    for (const raw of last.hot ?? []) {
      const id = String(raw);
      if (keepUnresolved(last, id)) unresolved.add(id);
    }
    for (const u of last.units ?? []) {
      if ((u.age_s ?? 0) >= STALE_AGE_S) stale.add(String(u.id));
      if (u.status === "unknown") unavailable.add(String(u.id));
      if ((u.confidence ?? 1) < LOW_CONFIDENCE) lowConfidence.add(String(u.id));
    }
    for (const a of last.assets ?? []) {
      if ((a.age_s ?? 0) >= STALE_AGE_S) stale.add(String(a.id));
      if (a.status === "unknown") unavailable.add(String(a.id));
      if ((a.confidence ?? 1) < LOW_CONFIDENCE) lowConfidence.add(String(a.id));
    }
    for (const l of last.links ?? []) if (l.active === false) unavailable.add(String(l.id));
  }
  if (!anyView) return { value: null };
  return {
    value: uncertaintyBudget({
      unresolved: unresolved.size,
      stale: stale.size,
      unavailable: unavailable.size,
      lowConfidence: lowConfidence.size,
    }),
  };
}

// ---- narrative -------------------------------------------------------------

function narrativeIis(actual: IisStats, cf: IisStats, seatCount: number, repaired: number): string {
  if (actual.teamMean === null || cf.teamMean === null || actual.snapshots === 0) {
    return "Seat picture fidelity: not derivable from log (no stored views/ground truth).";
  }
  const direction = phraseDelta(cf.teamMean - actual.teamMean, "rise", "fall");
  const tw =
    actual.timeWeightedMean !== null && cf.timeWeightedMean !== null
      ? ` (time-weighted ${fmt(actual.timeWeightedMean, 3)} → ${fmt(cf.timeWeightedMean, 3)})`
      : "";
  return (
    `Mean seat picture fidelity would ${direction} from ${fmt(actual.teamMean, 3)} → ` +
    `${fmt(cf.teamMean, 3)} (${signed(cf.teamMean - actual.teamMean, 3)}) across ${seatCount} seat(s)${tw}; ` +
    `${repaired} degraded snapshot-entries repaired against ground truth.`
  );
}

function narrativeOoda(actual: OodaStats, cf: OodaStats & { decisions: OodaRow[] }): string {
  if (actual.meanS === null || cf.meanS === null || actual.n === 0) {
    return "Decision latency: not derivable from log (no recorded decisions with ooda_latency_s).";
  }
  const direction = phraseDelta(cf.meanS - actual.meanS, "rise", "fall");
  return (
    `mean decision latency would ${direction} ${fmt(actual.meanS, 1)}s → ${fmt(cf.meanS, 1)}s ` +
    `(${signed(cf.meanS - actual.meanS, 1)}s) across ${actual.n} recorded decision(s).`
  );
}

function narrativeSpoof(n: {
  spoofCount: number;
  actualConflicted: number;
  cfConflicted: number;
  totalDecisions: number;
  actualHot: number | null;
  cfHot: number | null;
  actualBudget: number | null;
  cfBudget: number | null;
  attributableIds: number;
  hasViews: boolean;
}): string {
  if (n.spoofCount === 0) {
    return (
      `The run recorded no spoof injects (data.meta.origin === 'spoof'), so suppressing none changes nothing: ` +
      `conflicted decisions stay ${n.actualConflicted}/${n.totalDecisions}` +
      (n.hasViews
        ? `, hot burden stays ${fmt(n.actualHot, 2)} items/seat, uncertainty budget stays ${fmt(n.actualBudget, 1)}.`
        : "; hot burden and uncertainty budget: not derivable from log (no stored views).")
    );
  }
  const parts: string[] = [];
  const conflictDelta = n.cfConflicted - n.actualConflicted;
  parts.push(
    `Suppressing ${n.spoofCount} spoof inject: conflicted decisions ${n.actualConflicted} → ${n.cfConflicted} ` +
      `(${conflictDelta === 0 ? "unchanged" : signedInt(conflictDelta)}) of ${n.totalDecisions} recorded decision(s).`,
  );
  if (n.actualHot === null || n.cfHot === null || !n.hasViews) {
    parts.push("Hot burden and uncertainty budget: not derivable from log (no stored views).");
  } else {
    const hotNote =
      n.attributableIds === 0
        ? "unchanged — the spoof(s) named no unit/asset id, so no hot entry is attributable to them (approximation: unattributable flags retained)"
        : "with spoof-attributable flags removed";
    parts.push(
      `Mean hot burden ${fmt(n.actualHot, 2)} → ${fmt(n.cfHot, 2)} items/seat (${hotNote}); ` +
        `uncertainty budget ${fmt(n.actualBudget, 1)} → ${fmt(n.cfBudget, 1)}.`,
    );
  }
  return parts.join(" ");
}

function phraseDelta(delta: number, upWord: string, downWord: string): string {
  if (Math.abs(delta) < 1e-9) return "stay unchanged";
  return delta > 0 ? upWord : downWord;
}

// ---- math -----------------------------------------------------------------

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/** Time-weighted mean: weight(snapshot i) = gap to the next snapshot (last holds its previous gap). */
function timeWeighted(samples: { t: number; v: number }[]): number | null {
  if (!samples.length) return null;
  if (samples.length === 1) return r3(samples[0].v);
  let num = 0;
  let den = 0;
  for (let i = 0; i < samples.length; i++) {
    const w = i < samples.length - 1 ? samples[i + 1].t - samples[i].t : samples[i].t - samples[i - 1].t;
    if (!(w > 0)) continue;
    num += w * samples[i].v;
    den += w;
  }
  return den > 0 ? r3(num / den) : r3(samples[0].v);
}

function teamMean(perSeat: Record<string, number | null>): number | null {
  const vals = Object.values(perSeat).filter((v): v is number => v !== null);
  return vals.length ? r3(mean(vals)) : null;
}

function mapValues(src: Record<string, number | null>, fn: (v: number, k: string) => number | null): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const k of Object.keys(src).sort()) {
    const v = src[k];
    out[k] = v === null ? null : fn(v, k);
  }
  return out;
}

function diff(cf: number | null, actual: number | null, round: (n: number) => number): number | null {
  return cf === null || actual === null ? null : round(cf - actual);
}

function fmt(n: number | null, digits: number): string {
  return n === null ? "not derivable from log" : n.toFixed(digits);
}

function signed(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return n > 0 ? `+${s}` : s;
}

function signedInt(n: number): string {
  return n > 0 ? `+${String(n)}` : String(n);
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
