// Scoring metrics — server-side, per §14 of the brief.
import type { DegradedView, GroundTruth, DecisionRecord } from "./types.js";

/** Information Integrity Score: 0..1 divergence of a seat's picture from truth. */
export function computeIIS(view: DegradedView, truth: GroundTruth): number {
  let num = 0;
  let den = 0;
  const truthUnits = new Map(truth.units.map((u) => [u.id, u]));
  for (const vu of view.units) {
    const tu = truthUnits.get(vu.id);
    if (!tu) continue;
    const w = vu.side === "blue" && vu.type === "convoy" ? 2 : 1;
    const dist = Math.hypot(vu.x - tu.x, vu.y - tu.y);
    const posMatch = 1 / (1 + dist / 50);
    const statusMatch = vu.status === tu.status ? 1 : 0;
    num += w * (0.6 * posMatch + 0.4 * statusMatch);
    den += w;
  }
  const truthAssets = new Map(truth.assets.map((a) => [a.id, a]));
  for (const va of view.assets) {
    const ta = truthAssets.get(va.id);
    if (!ta) continue;
    num += va.status === ta.status ? 1 : 0;
    den += 1;
  }
  if (den === 0) return 0;
  return Math.round((num / den) * 1000) / 1000;
}

/** OODA latency in seconds: decision receipt minus stimulus (decision-open) time. */
export function oodaLatency(tDecision: number, tStimulus: number): number {
  return Math.round((tDecision - tStimulus) * 10) / 10;
}

/** Confidence–accuracy divergence over a window ("certain and wrong" detector). */
export function calibrationDivergence(decisions: DecisionRecord[]): number {
  if (decisions.length === 0) return 0;
  const meanConf = decisions.reduce((s, d) => s + d.confidence, 0) / decisions.length;
  const meanAcc = decisions.reduce((s, d) => s + (d.correct ? 1 : 0), 0) / decisions.length;
  return Math.round((meanConf - meanAcc) * 1000) / 1000;
}

/**
 * Mean Brier score over binary decision outcomes: mean((confidence − correctness)^2).
 * Range 0..1 — 0 is perfect, 0.25 is an unconfident coin flip. Lower is better.
 */
export function brierScore(decisions: DecisionRecord[]): number {
  if (decisions.length === 0) return 0;
  const sum = decisions.reduce((s, d) => {
    const p = Math.max(0, Math.min(1, d.confidence));
    const o = d.correct ? 1 : 0;
    return s + (p - o) * (p - o);
  }, 0);
  return Math.round((sum / decisions.length) * 1000) / 1000;
}

// ---- research-grade AAR depth (ported from the rival SIH implementations) ----

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Weighted index of how much un-checked uncertainty the team was deciding under —
 * each defect class is priced by how badly it corrupts a decision (FOG-LAB UBI:
 * unresolved contradictions cost most because acting on a live contradiction is
 * the dominant failure mode; stale > unavailable > low-confidence follow).
 */
export function uncertaintyBudget(counts: {
  unresolved: number;
  stale: number;
  unavailable: number;
  lowConfidence: number;
}): number {
  return round1(
    counts.unresolved * 2.5 + counts.stale * 1.5 + counts.unavailable * 2.0 + counts.lowConfidence * 1.0,
  );
}

/**
 * Process score for adapting under degradation: dropped traffic punishes harder than
 * each decision rewards (Sentinel-X formula), clamped to 40..95 so one dead link can
 * never zero the team and no run can look "perfect".
 */
export function adaptationScore(input: { droppedMessages: number; decisionsMade: number }): number {
  const raw = 100 - input.droppedMessages * 8 + input.decisionsMade * 5;
  return round1(Math.max(40, Math.min(95, raw)));
}

/**
 * Traffic text that counts as an explicit verification request. The protocol prefix
 * the room emits is "VERIFY REQUEST"; "VERIFY REPORT" is accepted too because the
 * seat's quick-SOP button and older recorded runs used that wording — both mean the
 * same thing to the metric, and both must count or the rate silently under-reports.
 */
export function isVerifyRequest(text: unknown): boolean {
  if (typeof text !== "string") return false;
  return /^VERIFY (REQUEST|REPORT)\b/i.test(text.trim());
}

/**
 * Share of decisions preceded by an explicit VERIFY REQUEST — acts on the debrief
 * teaching point "confirm before you commit", so it is measured against decisions, not messages.
 */
export function verificationRate(verifications: number, totalDecisions: number): number {
  if (totalDecisions <= 0) return 0;
  return round1((verifications / totalDecisions) * 100);
}

/**
 * Delivery-rate tier of the comms net (Sentinel-X thresholds): above 80% the net is
 * usable, 50–80% workable, below 50% the team is effectively isolated.
 */
export function resilienceTier(deliveredRate: number): "HIGH" | "MODERATE" | "CRITICAL" {
  if (deliveredRate > 80) return "HIGH";
  if (deliveredRate > 50) return "MODERATE";
  return "CRITICAL";
}

/**
 * Share of decisions made while contradictory evidence was live (FOG-LAB
 * conflicts_acknowledged): awareness only counts if it happened at decision time.
 */
export function contradictionAwareness(conflictedDecisions: number, totalDecisions: number): number {
  if (totalDecisions <= 0) return 0;
  return round1((conflictedDecisions / totalDecisions) * 100);
}

/** Mean rationale length in words — rationales under ~15 words are near-useless for debrief (Sentinel-X). */
export function meanWords(texts: string[]): number {
  if (texts.length === 0) return 0;
  const total = texts.reduce((s, t) => s + (t.trim() ? t.trim().split(/\s+/).length : 0), 0);
  return round1(total / texts.length);
}

/** Per-seat mean decision response time in seconds — outlier seats are the debrief targets. */
export function perSeatResponseTimes(decisions: DecisionRecord[]): Record<string, number> {
  const sums: Record<string, { total: number; n: number }> = {};
  for (const d of decisions) {
    const b = (sums[d.seat] ??= { total: 0, n: 0 });
    b.total += d.ooda_latency_s;
    b.n += 1;
  }
  const out: Record<string, number> = {};
  for (const [seat, b] of Object.entries(sums)) out[seat] = b.n ? round1(b.total / b.n) : 0;
  return out;
}
