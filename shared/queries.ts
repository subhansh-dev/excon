// SAGAT scorer functions for the §34 query battery (Scenario 1).
// YAML holds text/options; THIS file holds truth. Each scorer returns the CORRECT
// option string given the scoring context. Double scoring: scoreTruth (objective SA)
// and scoreAsShown (did the seat read its own feed correctly).
import type { GroundTruth, DegradedView, WireMessage, LinkProfile } from "./types.js";

export interface JournalEntry {
  t: number;
  from: string;
  kind: string;
  text: string;
}

export interface ScoreCtx {
  truth: GroundTruth;
  view: DegradedView;
  journal: JournalEntry[];
  views: Record<string, DegradedView>; // all seats, for cross-seat queries
  links: Record<string, LinkProfile>;
}

const unit = (truth: GroundTruth, id: string) => truth.units.find((u) => u.id === id);
const asset = (truth: GroundTruth, id: string) => truth.assets.find((a) => a.id === id);
const lastHeard = (journal: JournalEntry[], from: string): number | null => {
  const hits = journal.filter((j) => j.from === from).map((j) => j.t);
  return hits.length ? Math.max(...hits) : null;
};
const lastIsr = (journal: JournalEntry[]): string => {
  const kinds = journal.filter((j) => j.kind === "report");
  if (!kinds.length) return "none";
  const last = kinds[kinds.length - 1];
  if (last.from === "isr") return "drone feed";
  if (last.from === "hq") return "HQ broadcast";
  return "patrol";
};

/** Most-divergent seat picture vs truth (shared by q13/h9/m9). */
const mostDivergentSeat = (ctx: ScoreCtx): string => {
  let worst = "cdr";
  let worstScore = Infinity;
  for (const [seat, v] of Object.entries(ctx.views)) {
    let s = 0;
    for (const vu of v.units) {
      const tu = ctx.truth.units.find((u) => u.id === vu.id);
      if (tu && tu.status === vu.status) s += 1;
    }
    if (s < worstScore) { worstScore = s; worst = seat; }
  }
  return worst;
};

/** Correct answers keyed by query id. */
export const SCORE: Record<string, (ctx: ScoreCtx) => string> = {
  q1: ({ truth }) => String(truth.units.filter((u) => u.side === "blue" && u.status === "moving").length),
  q2: ({ truth }) => {
    const open = truth.assets.find((a) => a.kind === "bridge" && a.status === "open");
    if (!open) return "Neither";
    return open.id === "bridge-7" ? "Bridge-7" : "Bridge-3";
  },
  q3: ({ journal, view }) => {
    const t = lastHeard(journal, "hq");
    if (t === null) return "Never";
    const age = view.t - t;
    if (age < 120) return "<2 min ago";
    if (age < 300) return "2–5 min ago";
    return ">5 min ago";
  },
  q4: ({ truth }) => unit(truth, "u2")?.status ?? "unknown",
  q5: ({ journal }) => lastIsr(journal),
  q6: ({ truth }) => (asset(truth, "bridge-7")?.status === "open" ? "yes" : "no"),
  q7: ({ truth }) => ((truth.supplies.fuel_pct ?? 0) >= 60 ? "yes" : "no"),
  q8: () => "most recent", // calibrated scorer: lowest-integrity of last 3; v1 heuristic
  q9: ({ truth }) => (unit(truth, "u2")?.status === "moving" ? "yes" : "no"),
  q10: () => "speed", // v1: EW-onset profile degrades latency first (scenario timeline)
  q11: ({ truth }) => {
    const u = unit(truth, "u1");
    if (!u) return "NW quadrant";
    // Project analytic motion: quadrants of the 200x200 map.
    const q = u.x >= 100 ? (u.y >= 100 ? "SE quadrant" : "NE quadrant") : u.y >= 100 ? "SW quadrant" : "NW quadrant";
    return q;
  },
  q12: () => "route", // v1: d1 route window closes first per scenario design
  q13: ({ views, truth }) => {
    // Most divergent seat picture vs truth (fewest matching unit statuses).
    let worst = "cdr";
    let worstScore = Infinity;
    for (const [seat, v] of Object.entries(views)) {
      let s = 0;
      for (const vu of v.units) {
        const tu = truth.units.find((u) => u.id === vu.id);
        if (tu && tu.status === vu.status) s += 1;
      }
      if (s < worstScore) { worstScore = s; worst = seat; }
    }
    return worst;
  },
  q14: ({ truth }) => {
    const o = unit(truth, "o1");
    if (!o || o.status === "withdrawn") return "nothing";
    if (o.status === "attacking") return "ambush";
    return "harass";
  },
  q15: ({ links }) => {
    const cdr = links["cdr-hq"];
    if (!cdr || !cdr.active) return "lost";
    if (cdr.integrity < 0.8 || cdr.loss_pct > 20) return "degraded";
    return "intact";
  },
  // ---- hvt-watch (HVT near Compound North; drone insists East) ----
  h1: ({ truth }) => {
    const o = unit(truth, "o1");
    if (!o) return "Unknown";
    if (o.x >= 150) return "Compound East";
    if (o.x >= 100) return "Compound North";
    return "On the road";
  },
  h2: ({ truth }) => {
    const n = asset(truth, "compound-north");
    const e = asset(truth, "compound-east");
    if (n?.status === "occupied" && e?.status === "occupied") return "Both";
    if (n?.status === "occupied") return "Compound North";
    if (e?.status === "occupied") return "Compound East";
    return "Unknown";
  },
  h3: ({ journal, view }) => {
    const t = lastHeard(journal, "hum");
    if (t === null) return "Never";
    const age = view.t - t;
    if (age < 120) return "<2 min ago";
    if (age < 300) return "2–5 min ago";
    return ">5 min ago";
  },
  h4: () => "HUMINT",
  h5: () => "yes", // the two drone passes agree with each other (both wrong about truth)
  h6: ({ truth }) => unit(truth, "u1")?.status ?? "unknown",
  h7: () => "East coverage", // the drone watches East; HUMINT covers North
  h8: ({ truth }) => {
    const o = unit(truth, "o1");
    if (!o || o.status !== "moving") return "staying put";
    return o.x >= 120 ? "moving east" : "moving north";
  },
  h9: (ctx) => mostDivergentSeat(ctx),
  // ---- medevac-jam (LZ Alpha open, fuel adequate, log feed corrupted early) ----
  m1: ({ truth }) => {
    const a = asset(truth, "lz-alpha");
    const b = asset(truth, "lz-bravo");
    if (a?.status === "open" && b?.status === "open") return "Both";
    if (a?.status === "open") return "LZ Alpha";
    if (b?.status === "open") return "LZ Bravo";
    return "Unknown";
  },
  m2: ({ truth }) => ((truth.supplies.fuel_pct ?? 0) >= 50 ? "adequate (>50%)" : "critical (<20%)"),
  m3: ({ truth }) => unit(truth, "u2")?.status ?? "unknown",
  m4: () => "no", // the 12% reading was spoofed against 58% truth
  m5: ({ links }) => {
    if (links["ops-net"]?.active) return "ops net";
    if (links["log-net"]?.active) return "log net";
    if (links["cdr-hq"]?.active) return "HQ net";
    return "none";
  },
  m6: ({ truth }) => {
    const ev = truth.events.find((e) => e.kind === "casualties");
    return ev ? "6" : "unknown";
  },
  m7: () => "fuel",
  m8: () => "all three",
  m9: (ctx) => mostDivergentSeat(ctx),
  // ---- thar-vigil (Jaisalmer–Pokhran axis; western post, fuel band, orbiting ISR) ----
  t1: ({ truth }) => String(truth.units.filter((u) => u.side === "blue" && u.status === "moving").length),
  t2: ({ truth }) => asset(truth, "western-bp")?.status ?? "unknown",
  t3: ({ journal, view }) => {
    const t = lastHeard(journal, "hq");
    if (t === null) return "Never";
    const age = view.t - t;
    if (age < 120) return "<2 min ago";
    if (age < 300) return "2–5 min ago";
    return ">5 min ago";
  },
  t4: ({ truth }) => {
    const f = truth.supplies.fuel_pct ?? 0;
    return f >= 60 ? "above 60%" : f >= 40 ? "40–60%" : "below 40%";
  },
  t5: ({ journal }) => lastIsr(journal),
  t6: ({ truth }) => unit(truth, "isr")?.status ?? "unknown",
  t7: ({ truth }) => ((truth.supplies.fuel_pct ?? 0) >= 60 ? "yes" : "no"),
  t8: () => "most recent",
  t9: ({ truth }) => (unit(truth, "u2")?.status === "moving" ? "yes" : "no"),
  t10: () => "speed",
  t11: ({ truth }) => {
    const u = unit(truth, "u1");
    if (!u) return "NW quadrant";
    return u.x >= 100 ? (u.y >= 100 ? "SE quadrant" : "NE quadrant") : u.y >= 100 ? "SW quadrant" : "NW quadrant";
  },
  t12: () => "route",
  t13: (ctx) => mostDivergentSeat(ctx),
  t14: ({ truth }) => {
    const o = unit(truth, "o1");
    if (!o || o.status === "withdrawn") return "nothing";
    if (o.status === "attacking") return "ambush";
    return "harass";
  },
  t15: ({ links }) => {
    const cdr = links["cdr-hq"];
    if (!cdr || !cdr.active) return "lost";
    if (cdr.integrity < 0.8 || cdr.loss_pct > 20) return "degraded";
    return "intact";
  },
};

/** "As shown" scorer: what SHOULD the seat answer given only its own feed? v1 reuses
 *  truth scorers for truth-derived queries; journal/view-derived ones (q3,q5,q8,q13)
 *  are inherently as-shown. Callers compare answer vs both. */
export function scoreAnswer(queryId: string, ctx: ScoreCtx): { truth: string } {
  const fn = SCORE[queryId];
  if (!fn) throw new Error(`no scorer for ${queryId}`);
  return { truth: fn(ctx) };
}

export type { WireMessage };
