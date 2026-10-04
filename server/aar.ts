// AAR builder — reads the run's JSONL trail, emits the report JSON.
// Client renders it (views/AARView) and prints to PDF. R5 acceptance: individual +
// team timelines, verbatim rationale, IIS curves, confidence-vs-accuracy, CAST.
import type { RunStore, RunEvent } from "./store.js";
import { buildAuditLog } from "./audit.js";
import type { CounterfactualResult } from "./counterfactual.js";
import { deckTruth, entityList, labelMap, type EntityRef } from "./scenario.js";
import {
  calibrationDivergence,
  brierScore,
  uncertaintyBudget,
  adaptationScore,
  isVerifyRequest,
  verificationRate,
  resilienceTier,
  contradictionAwareness,
  meanWords,
  perSeatResponseTimes,
} from "../shared/metrics.js";
import type { DecisionRecord, GroundTruth } from "../shared/types.js";

export async function buildAAR(runId: string, store: RunStore) {
  const meta = await store.getRun(runId);
  const events: RunEvent[] = await store.getEvents(runId);

  const decisions = events.filter((e) => e.type === "decision" && e.data.choice).map((e) => e.data as DecisionRecord);
  const probes = events.filter((e) => e.type === "probe" && e.data.answers).map((e) => e.data);
  const seats = [...new Set(events.map((e) => e.actor).filter((a) => !["server", "router", "timeline", "instructor"].includes(a)))];

  // IIS series per seat (server stamped iis on every stored view).
  const iisSeries: Record<string, { tick: number; t: number; iis: number }[]> = {};
  for (const seat of seats) {
    const views = await store.getViews(runId, seat);
    iisSeries[seat] = views.filter((v) => typeof v.iis === "number").map((v) => ({ tick: v.tick, t: v.t, iis: v.iis }));
  }

  // Confidence vs accuracy per seat.
  const calibration: Record<string, { meanConf: number; accuracy: number; divergence: number; brier: number; n: number }> = {};
  for (const seat of seats) {
    const ds = decisions.filter((d) => d.seat === seat);
    const meanConf = ds.length ? ds.reduce((s, d) => s + d.confidence, 0) / ds.length : 0;
    const accuracy = ds.length ? ds.filter((d) => d.correct).length / ds.length : 0;
    calibration[seat] = {
      meanConf: r2(meanConf), accuracy: r2(accuracy),
      divergence: calibrationDivergence(ds), brier: brierScore(ds), n: ds.length,
    };
  }
  const brierOverall = brierScore(decisions);

  // NASA-TLX post-exercise workload ratings (average when a seat submits more than once).
  type TlxRow = { mental: number; physical: number; temporal: number; performance: number; effort: number; frustration: number; avg: number; n: number };
  const tlx: Record<string, TlxRow> = {};
  for (const e of events.filter((ev) => ev.type === "tlx" && ev.data && typeof ev.data.mental === "number")) {
    const cur = tlx[e.actor];
    const n = (cur?.n ?? 0) + 1;
    const mix = (k: keyof TlxRow) =>
      Math.round((((cur ? (cur[k] as number) * cur.n : 0) + Number(e.data[k] ?? 0)) / n) * 10) / 10;
    const row: TlxRow = {
      mental: mix("mental"), physical: mix("physical"), temporal: mix("temporal"),
      performance: mix("performance"), effort: mix("effort"), frustration: mix("frustration"),
      avg: 0, n,
    };
    row.avg = Math.round(((row.mental + row.physical + row.temporal + row.performance + row.effort + row.frustration) / 6) * 10) / 10;
    tlx[e.actor] = row;
  }

  // CAST heuristic per comms glitch (link blackout / dropout inject).
  const glitches = events.filter(
    (e) => (e.type === "inject" && (e.data.patch?.active === false || (e.data.patch?.loss_pct ?? 0) > 30)) || e.type === "link_change",
  );
  const cast = glitches.map((g) => {
    const window = events.filter((e) => Math.abs(e.t - g.t) <= 120);
    const chats = window.filter((e) => e.type === "chat");
    const chatters = new Set(chats.map((c) => c.actor));
    const noticed = chats.length > 0;
    const discussed = chatters.size >= 2 && chats.length >= 2;
    const circumvented = window.some(
      (e) => e.type === "link_change" || (e.type === "chat" && /verify|reroute|switch|alternate/i.test(JSON.stringify(e.data))),
    );
    const postDecisions = events.filter((e) => e.type === "decision" && e.data.choice && e.t > g.t && e.t <= g.t + 300);
    const overcame = postDecisions.some((d) => d.data.correct);
    const score = [noticed, discussed, circumvented, overcame].filter(Boolean).length;
    return { t: g.t, kind: g.type, detail: g.data, noticed, discussed, circumvented, overcame, score };
  });

  // Comms discipline per seat: sent / received / dropped / verifications.
  const discipline: Record<string, { sent: number; received: number; dropped: number; verifications: number }> = {};
  const bump = (s: string) =>
    (discipline[s] ??= { sent: 0, received: 0, dropped: 0, verifications: 0 });
  for (const e of events) {
    if (e.type === "chat") {
      const d = e.data ?? {};
      const b = bump(e.actor);
      b.sent += 1;
      if (d.dropped) b.dropped += 1;
      else if (isVerifyRequest(d.text)) b.verifications += 1;
    } else if (e.type === "message" && e.data?.to) {
      const b = bump(e.data.to);
      if (e.data.dropped) b.dropped += 1;
      else b.received += 1;
    }
  }

  // Asymmetry matrix: each seat's final picture vs truth (match / miss / unknown).
  const truthSnaps = await store.getTruth(runId);
  const labels = labelMap(meta.scenarioId);
  const entities: EntityRef[] = entityList(
    [{ truth: deckTruth(meta.scenarioId) }, ...truthSnaps],
    labels,
  );
  const asymmetry: { seat: string; cells: Record<string, string> }[] = [];
  for (const seat of Object.keys(iisSeries)) {
    const views = await store.getViews(runId, seat);
    const last = views[views.length - 1];
    if (!last) continue;
    const snap = [...truthSnaps].reverse().find((s) => s.tick <= last.tick) ?? truthSnaps[truthSnaps.length - 1];
    const truth = snap?.truth as GroundTruth | undefined;
    const vunits = new Map<string, any>((last.units ?? []).map((u: any): [string, any] => [u.id, u]));
    const tunits = new Map<string, any>((truth?.units ?? []).map((u): [string, any] => [u.id, u]));
    const vassets = new Map<string, any>((last.assets ?? []).map((a: any): [string, any] => [a.id, a]));
    const tassets = new Map<string, any>((truth?.assets ?? []).map((a): [string, any] => [a.id, a]));
    const cells: Record<string, string> = {};
    for (const ent of entities) {
      if (ent.kind === "asset") {
        const va = vassets.get(ent.id);
        const ta = tassets.get(ent.id);
        cells[ent.id] = !va || !ta || va.status === "unknown" ? "?" : va.status === ta.status ? "✓" : "✗";
      } else {
        const vu = vunits.get(ent.id);
        const tu = tunits.get(ent.id);
        if (!vu || !tu) {
          cells[ent.id] = "?";
        } else {
          const posOk = Math.hypot(vu.x - tu.x, vu.y - tu.y) <= 15;
          cells[ent.id] = vu.status === tu.status && posOk ? "✓" : "✗";
        }
      }
    }
    asymmetry.push({ seat, cells });
  }

  // Inject markers for the IIS chart.
  const injects = events
    .filter((e) => e.type === "inject" || e.type === "link_change")
    .map((e) => ({ t: e.t, label: e.type === "inject" ? String(e.data?.type ?? "inject") : "link" }));

  // Auto-flagged debrief moments.
  const flags: string[] = [];
  let worstDrop = { seat: "", drop: 0, t: 0 };
  for (const [seat, series] of Object.entries(iisSeries)) {
    for (let i = 1; i < series.length; i++) {
      const drop = series[i - 1].iis - series[i].iis;
      if (drop > worstDrop.drop) worstDrop = { seat, drop: r2(drop), t: series[i].t };
    }
  }
  if (worstDrop.seat) flags.push(`Largest IIS drop: ${worstDrop.seat} −${worstDrop.drop} at t=${worstDrop.t}s`);
  const slowest = decisions.length
    ? decisions.reduce((a, b) => (a.ooda_latency_s >= b.ooda_latency_s ? a : b))
    : null;
  if (slowest) flags.push(`Longest OODA latency: ${slowest.seat} ${slowest.ooda_latency_s}s on ${slowest.decisionId}`);
  const certainWrong = decisions.filter((d) => d.confidence >= 0.8 && !d.correct);
  for (const d of certainWrong) flags.push(`Certain-and-wrong: ${d.seat} chose "${d.choice}" @${d.confidence} confidence on ${d.decisionId}`);

  // ---- uncertainty budget: defects still present in each seat's FINAL picture ----
  // Counts are team-wide distinct items — the budget is a property of the shared
  // situation, not inflated once per seat.
  const unresolvedClaims = new Set<string>();
  const staleItems = new Set<string>();
  const unavailableItems = new Set<string>();
  const lowConfidenceItems = new Set<string>();
  for (const seat of seats) {
    const views = await store.getViews(runId, seat);
    const last = views[views.length - 1];
    if (!last) continue;
    for (const id of last.hot ?? []) unresolvedClaims.add(String(id));
    for (const u of last.units ?? []) {
      if ((u.age_s ?? 0) >= 60) staleItems.add(String(u.id));
      if (u.status === "unknown") unavailableItems.add(String(u.id));
      if ((u.confidence ?? 1) < 0.5) lowConfidenceItems.add(String(u.id));
    }
    for (const a of last.assets ?? []) {
      if ((a.age_s ?? 0) >= 60) staleItems.add(String(a.id));
      if (a.status === "unknown") unavailableItems.add(String(a.id));
      if ((a.confidence ?? 1) < 0.5) lowConfidenceItems.add(String(a.id));
    }
    for (const l of last.links ?? []) if (l.active === false) unavailableItems.add(String(l.id));
  }

  // ---- comms delivery → adaptation + resilience ----
  const commsEvents = events.filter((e) => e.type === "chat" || e.type === "message");
  const droppedMessages = commsEvents.filter((e) => e.data?.dropped).length;
  const deliveredMessages = commsEvents.length - droppedMessages;
  const deliveredRate = commsEvents.length ? r2((deliveredMessages / commsEvents.length) * 100) : 100;
  const totalVerifications = Object.values(discipline).reduce((s, d) => s + d.verifications, 0);

  // ---- contradiction awareness: was live conflicting evidence present at decision time? ----
  // (a) decision context link dark or corrupted, or (b) a spoofed claim fired ≤120s before —
  // the same 120s window room.ts keeps a report/event flagged "hot".
  const spoofTimes = events
    .filter((e) => e.type === "inject" && e.data?.meta?.origin === "spoof")
    .map((e) => e.t);
  const conflictedDecisions = decisions.filter((d) => {
    const links = d.context?.links ?? [];
    if (links.some((l) => l.active === false || (l.integrity ?? 1) < 1)) return true;
    return spoofTimes.some((t) => d.t >= t && d.t <= t + 120);
  }).length;

  const budget = uncertaintyBudget({
    unresolved: unresolvedClaims.size,
    stale: staleItems.size,
    unavailable: unavailableItems.size,
    lowConfidence: lowConfidenceItems.size,
  });
  // FOG-LAB research rule: budget > 5.0 is red.
  const budgetBand = budget > 5 ? "HIGH" : budget > 2 ? "ELEVATED" : "LOW";

  const scores = {
    uncertaintyBudget: budget,
    budgetBand,
    adaptation: adaptationScore({ droppedMessages, decisionsMade: decisions.length }),
    verificationRate: verificationRate(totalVerifications, decisions.length),
    resilience: { deliveredRate, tier: resilienceTier(deliveredRate) },
    contradictionAwareness: contradictionAwareness(conflictedDecisions, decisions.length),
    disclaimer: "Training indicators — process measures, not a verdict on leadership quality.",
  };

  // ---- per-seat roll-up ----
  const responseTimes = perSeatResponseTimes(decisions);
  const perSeat = seats.map((seat) => {
    const ds = decisions.filter((d) => d.seat === seat);
    const dis = discipline[seat] ?? { sent: 0, received: 0, dropped: 0, verifications: 0 };
    return {
      seat,
      decisions: ds.length,
      accuracy: r2(ds.length ? ds.filter((d) => d.correct).length / ds.length : 0),
      meanConfidence: r2(ds.length ? ds.reduce((s, d) => s + d.confidence, 0) / ds.length : 0),
      brier: brierScore(ds),
      oodaMean: responseTimes[seat] ?? 0,
      rationaleWords: meanWords(ds.map((d) => d.rationale)),
      responses: dis.sent + dis.received,
      discipline: dis,
    };
  });

  // ---- narrative: every line below is a threshold rule over the numbers above ----
  const narrative = buildNarrative({
    scores, decisions, conflictedDecisions, certainWrong: certainWrong.length,
    calibration, perSeat, cast, probes, commsEvents, droppedMessages, asymmetry,
  });

  // ADDITIVE: contradiction/conflict audit log (server/audit.ts) — derived from the
  // same trail; empty entries + zero summary for runs where nothing fired.
  const audit = await buildAuditLog(runId, store);

  return {
    header: {
      scenario: meta.scenarioId, seed: meta.seed, runId,
      deceptionObjective: meta.deceptionObjective ?? null,
      startedAt: meta.startedAt, seats,
    },
    timeline: events.map((e) => ({ seq: e.seq, t: e.t, type: e.type, actor: e.actor, summary: summarize(e) })),
    decisions,
    probes,
    iisSeries,
    calibration,
    brier: brierOverall,
    tlx,
    cast,
    flags,
    injects,
    asymmetry,
    entities,
    discipline,
    scores,
    perSeat,
    narrative,
    audit,
    // ADDITIVE: never computed here — the route calls
    // runCounterfactual(runId, store, "clean_links" | "suppress_spoof") on demand
    // and attaches the result; this slot exists so the payload shape is stable.
    counterfactual: null as CounterfactualResult | null,
  };
}

interface NarrativeInput {
  scores: {
    uncertaintyBudget: number; budgetBand: string; adaptation: number; verificationRate: number;
    resilience: { deliveredRate: number; tier: string }; contradictionAwareness: number;
  };
  decisions: DecisionRecord[];
  conflictedDecisions: number;
  certainWrong: number;
  calibration: Record<string, { meanConf: number; accuracy: number; divergence: number; brier: number; n: number }>;
  perSeat: { seat: string; decisions: number; accuracy: number; oodaMean: number; rationaleWords: number }[];
  cast: { t: number; kind: string; score: number }[];
  probes: any[];
  commsEvents: RunEvent[];
  droppedMessages: number;
  asymmetry: { seat: string; cells: Record<string, string> }[];
}

/** Deterministic debrief prose — pure threshold rules over this run's own numbers. */
function buildNarrative(n: NarrativeInput): { strengths: string[]; challenges: string[]; patterns: string[]; focus: string[] } {
  const strengths: string[] = [];
  const challenges: string[] = [];
  const patterns: string[] = [];
  const focus: string[] = [];
  const { scores, decisions } = n;
  const pct = (x: number) => `${Math.round(x)}%`;

  // Strengths — only claimed when the run actually cleared the bar.
  if (decisions.length > 0 && scores.verificationRate >= 60) {
    strengths.push(`Verification discipline held at ${scores.verificationRate}% of decisions — confirm-before-act was the default.`);
  }
  if (scores.resilience.tier === "HIGH") {
    strengths.push(
      n.droppedMessages > 0
        ? `Message delivery held at ${scores.resilience.deliveredRate}% despite ${n.droppedMessages} dropped messages (HIGH resilience tier).`
        : `Message delivery held at ${scores.resilience.deliveredRate}% (HIGH resilience tier).`,
    );
  }
  if (decisions.length > 0 && scores.adaptation >= 80) {
    strengths.push(`Adaptation score ${scores.adaptation}/95: decisions kept flowing while the net degraded.`);
  }
  if (decisions.length > 0 && decisions.filter((d) => d.correct).length / decisions.length >= 0.7) {
    strengths.push(`Decision accuracy ${pct((decisions.filter((d) => d.correct).length / decisions.length) * 100)} across ${decisions.length} recorded decisions.`);
  }
  if (decisions.length > 0 && n.certainWrong === 0) {
    strengths.push("No certain-and-wrong decisions: stated confidence tracked the evidence.");
  }
  const castBest = n.cast.find((c) => c.score === 4);
  if (castBest) {
    strengths.push(`Full CAST recovery (4/4) on the ${castBest.kind} glitch at t=${Math.round(castBest.t)}s.`);
  }
  if (decisions.length > 0 && scores.contradictionAwareness >= 50) {
    strengths.push(`${scores.contradictionAwareness}% of decisions were taken with contradictory evidence still live — the conflict was seen, not missed.`);
  }

  // Challenges — the mirror image, plus per-seat outliers.
  if (scores.uncertaintyBudget > 5) {
    challenges.push(`Uncertainty budget ${scores.uncertaintyBudget} (${scores.budgetBand}): unresolved, stale or unavailable information survived to the final picture.`);
  }
  const decided = n.perSeat.filter((p) => p.decisions > 0);
  const oodaMeans = decided.map((p) => p.oodaMean).sort((a, b) => a - b);
  const medianOoda = oodaMeans.length
    ? oodaMeans.length % 2
      ? oodaMeans[(oodaMeans.length - 1) / 2]
      : (oodaMeans[oodaMeans.length / 2 - 1] + oodaMeans[oodaMeans.length / 2]) / 2
    : 0;
  for (const p of decided) {
    if (medianOoda > 0 && p.oodaMean > 2 * medianOoda) {
      challenges.push(`${p.seat} decision time ${p.oodaMean}s vs team median ${medianOoda}s — more than twice the team.`);
    }
  }
  if (decisions.length >= 3 && scores.verificationRate < 30) {
    challenges.push(`Verification discipline ${scores.verificationRate}% — most decisions committed without a confirmation request.`);
  }
  if (n.certainWrong > 0) {
    challenges.push(`${n.certainWrong} certain-and-wrong decision(s): confidence outran the evidence.`);
  }
  if (scores.resilience.tier === "CRITICAL") {
    challenges.push(`Delivery fell to ${scores.resilience.deliveredRate}% (CRITICAL): the blackout segment was not worked around.`);
  }
  for (const [seat, c] of Object.entries(n.calibration)) {
    if (c.n > 0 && c.divergence > 0.3) {
      challenges.push(`${seat} over-confident by ${c.divergence} (mean confidence ${c.meanConf} vs accuracy ${c.accuracy}).`);
    }
  }

  // Patterns — descriptive, never judgemental.
  if (decisions.length > 0) {
    const words = meanWords(decisions.map((d) => d.rationale));
    patterns.push(`Rationales averaged ${words} words across ${decisions.length} decisions.`);
  }
  if (n.droppedMessages > 0 && n.commsEvents.length > 0) {
    const droppedPct = Math.round((n.droppedMessages / n.commsEvents.length) * 100);
    patterns.push(`${n.droppedMessages} of ${n.commsEvents.length} messages dropped (${droppedPct}%) — traffic loss shaped the decision window.`);
  }
  if (decided.length >= 2) {
    const slowest = decided.reduce((a, b) => (a.oodaMean >= b.oodaMean ? a : b));
    const fastest = decided.reduce((a, b) => (a.oodaMean <= b.oodaMean ? a : b));
    if (slowest.oodaMean > fastest.oodaMean) {
      patterns.push(`Response times ran from ${fastest.oodaMean}s (${fastest.seat}) to ${slowest.oodaMean}s (${slowest.seat}).`);
    }
  }
  if (n.probes.length > 0) {
    const total = n.probes.reduce((s, p) => s + (p.total ?? 0), 0);
    const hit = n.probes.reduce((s, p) => s + (p.score ?? 0), 0);
    patterns.push(`SA probes averaged ${total ? Math.round((hit / total) * 100) : 0}% across ${n.probes.length} freezes.`);
  }
  if (n.cast.length > 0) {
    const meanCast = n.cast.reduce((s, c) => s + c.score, 0) / n.cast.length;
    patterns.push(`Team coordination averaged ${Math.round(meanCast * 10) / 10}/4 across ${n.cast.length} glitch window(s).`);
  }
  if (n.asymmetry.length > 0) {
    const cells = n.asymmetry.flatMap((a) => Object.values(a.cells));
    const matched = cells.filter((c) => c === "✓").length;
    patterns.push(`Final pictures: ${matched} of ${cells.length} entity checks matched ground truth.`);
  }

  // Recommended training focus — one drill per observed weakness, omitted when healthy.
  if (decisions.length >= 3 && scores.verificationRate < 60) {
    focus.push("Verification-first messaging: raise VERIFY REQUEST use before committing units.");
  }
  if (scores.uncertaintyBudget > 5) {
    focus.push("Contradiction closure: clear flagged reports before acting on them.");
  }
  if (medianOoda > 0) {
    const slowest = decided.reduce((a, b) => (a.oodaMean >= b.oodaMean ? a : b));
    if (slowest && slowest.oodaMean > medianOoda) {
      focus.push(`Timed decision drills for ${slowest.seat} — ${slowest.oodaMean}s mean against a ${medianOoda}s team median.`);
    }
  }
  if (scores.resilience.tier !== "HIGH") {
    focus.push("Alternate-net drills: keep a fallback channel ready when the primary link drops.");
  }
  if (n.certainWrong > 0) {
    focus.push("Confidence calibration: justify each confidence number against observed evidence.");
  }
  if (n.cast.some((c) => c.score <= 2)) {
    focus.push("Glitch-response rehearsal: noticed → discussed → circumvented → overcame within the first two minutes.");
  }
  if (Object.values(n.calibration).some((c) => c.n > 0 && c.divergence > 0.3)) {
    focus.push("Confidence-gap exercises: close the distance between stated confidence and observed accuracy.");
  }

  return { strengths, challenges, patterns, focus };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

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
