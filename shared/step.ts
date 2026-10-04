// Deterministic fixed-tick world step + per-seat view projection.
// Pure + seeded: same scenario + same seed + same inputs = bit-identical run.
import type {
  GroundTruth, LinkDef, LinkProfile, ScenarioDef, DegradedView,
  PublicDecision,
} from "./types.js";
import type { Rng } from "./rng.js";
import { currentProfile, degradeNumber, degradePosition } from "./degrad.js";

export interface SimWorld {
  truth: GroundTruth;
  links: Record<string, LinkProfile>;
  time_s: number;
  tick: number;
}

export function initWorld(scenario: ScenarioDef): SimWorld {
  // Deep-clone ground truth so runs never mutate the loaded scenario.
  const truth: GroundTruth = JSON.parse(JSON.stringify(scenario.groundTruth));
  truth.events ??= [];
  truth.units ??= [];
  truth.assets ??= [];
  truth.supplies ??= {};
  const links: Record<string, LinkProfile> = {};
  for (const l of scenario.links) links[l.id] = { ...l.base };
  return { truth, links, time_s: 0, tick: 0 };
}

/** Advance the world by dt seconds. No Date.now, no Math.random — rng only. */
export function stepWorld(world: SimWorld, scenario: ScenarioDef, rng: Rng, dt: number): void {
  world.tick += 1;
  world.time_s = Math.round((world.time_s + dt) * 1000) / 1000;

  // Scheduled link degradation (the "mid-exercise injection" backbone).
  for (const link of scenario.links) {
    world.links[link.id] = currentProfile(link, world.time_s);
  }

  // Convoy movement along waypoints.
  for (const u of world.truth.units) {
    if (!u.wp || u.wp.length === 0 || u.status === "halted") continue;
    const speed = u.speed ?? 0.02;
    let remaining = speed * dt;
    while (remaining > 0 && u.wp.length > 0) {
      const [tx, ty] = u.wp[0];
      const dx = tx - u.x;
      const dy = ty - u.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= remaining) {
        u.x = tx; u.y = ty;
        u.wp.shift();
        remaining -= dist;
      } else {
        // Full float precision in state — rounding every tick would quantize
        // slow movement to zero (0.005 u/tick < 0.01 display quantum).
        u.x = u.x + (dx / dist) * remaining;
        u.y = u.y + (dy / dist) * remaining;
        remaining = 0;
      }
    }
    void rng; // movement itself is analytic; rng reserved for stochastic layers
  }
}

/**
 * Project ground truth into what one seat perceives, through that seat's links.
 * linkFor(seatId) resolves which profile governs each feed for the seat (v1: seat's
 * worst link to HQ/ISR degrades everything it sees; refined per-feed in v2).
 */
export function projectView(
  world: SimWorld,
  seat: string,
  linkProfiles: LinkProfile[],
  rng: Rng,
  opts: { tick: number; phase: string; nextDecision?: (PublicDecision & { openTick: number }) | undefined },
): DegradedView {
  const worst = linkProfiles.length
    ? linkProfiles.reduce((a, b) => (a.integrity <= b.integrity ? a : b))
    : { integrity: 1 } as LinkProfile;
  const integ = worst.integrity ?? 1;

  const units = world.truth.units
    .filter((u) => u.side !== "opfor" || integ > 0.45) // hidden OPFOR only surfaces on good links
    .map((u) => {
      const p = degradePosition(u.x, u.y, integ, rng);
      return {
        id: u.id, side: u.side, type: u.type,
        x: p.x, y: p.y, status: u.status, sidc: u.sidc,
        confidence: p.confidence, age_s: Math.round((1 - integ) * 120),
      };
    });

  const assets = world.truth.assets.map((a) => ({
    id: a.id, kind: a.kind,
    // Low integrity: stale status (report the *opposite* only via contradiction injects;
    // here we mark unknown so spoof stays a distinct, attributable mechanism).
    status: integ >= 0.6 ? a.status : "unknown",
    x: a.x, y: a.y,
    confidence: integ >= 0.6 ? 0.9 : 0.4,
    age_s: Math.round((1 - integ) * 120),
  }));

  const supplies: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(world.truth.supplies)) {
    supplies[k] = degradeNumber(v, integ, rng);
  }

  return {
    seat, tick: opts.tick, t: world.time_s,
    units, assets, supplies,
    iis: 0, // filled by server via metrics.computeIIS (needs both truths)
    nextDecision: opts.nextDecision,
    phase: opts.phase,
  };
}
