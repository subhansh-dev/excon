// Comms degradation transforms — pure functions, shared by server + replay.
import type { LinkDef, LinkProfile, DegradMode } from "./types.js";
import type { Rng } from "./rng.js";

export const CLEAN_LINK: LinkProfile = {
  latency_ms: 300,
  jitter_ms: 60,
  loss_pct: 1,
  bandwidth_kbps: 128,
  integrity: 1.0,
  spoof_pct: 0,
  active: true,
};

/** Fold a link's scheduled timeline patches at sim time `t` (seconds). */
export function currentProfile(link: LinkDef, t: number): LinkProfile {
  const p: LinkProfile = { ...link.base };
  for (const step of link.timeline) {
    if (step.t <= t) Object.assign(p, step.patch);
  }
  return p;
}

export interface RouteOutcome {
  action: "deliver" | "drop";
  deliverAt: number; // sim-seconds (t_sent + delay)
  delay_s: number;
  degradedBy: DegradMode[];
  integrity: number; // 0..1 actual content integrity after corruption roll
}

/** Decide what happens to one message crossing one link. Deterministic given rng. */
export function routeMessage(profile: LinkProfile, tSent: number, rng: Rng): RouteOutcome {
  const degradedBy: DegradMode[] = [];
  if (!profile.active) return { action: "drop", deliverAt: -1, delay_s: -1, degradedBy: ["dropout"], integrity: 0 };
  if (rng.chance(profile.loss_pct / 100)) {
    return { action: "drop", deliverAt: -1, delay_s: -1, degradedBy: ["dropout"], integrity: 0 };
  }
  const jitter = (rng.next() * 2 - 1) * profile.jitter_ms;
  const delay_s = Math.max(0, (profile.latency_ms + jitter) / 1000);
  if (delay_s > 0.8) degradedBy.push("latency");
  const integrity = rng.chance(profile.integrity) ? 1 : rng.range(0.2, 0.7);
  if (integrity < 1) degradedBy.push("partial");
  return { action: "deliver", deliverAt: tSent + delay_s, delay_s, degradedBy, integrity };
}

/** Garble a numeric supply readout when integrity is low (partial mode). */
export function degradeNumber(value: number, integrity: number, rng: Rng): number | string {
  if (integrity >= 0.85) return value;
  if (integrity >= 0.55) return Math.round(value + rng.range(-8, 8)); // plausible-wrong
  return "???";
}

/** Offset a position fix when integrity is low — stale + wrong, not just hidden. */
export function degradePosition(x: number, y: number, integrity: number, rng: Rng): { x: number; y: number; confidence: number } {
  if (integrity >= 0.9) return { x, y, confidence: 0.95 };
  const err = (1 - integrity) * 25;
  return {
    x: Math.round((x + rng.range(-err, err)) * 10) / 10,
    y: Math.round((y + rng.range(-err, err)) * 10) / 10,
    confidence: Math.round(integrity * 100) / 100,
  };
}
