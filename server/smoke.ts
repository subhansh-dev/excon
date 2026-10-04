// G2 gate — determinism smoke: same seed twice = bit-identical; different seed differs.
// `npm run smoke`
import { loadScenario } from "./scenario.js";
import { initWorld, stepWorld, projectView } from "../shared/step.js";
import { makeRng } from "../shared/rng.js";
import { routeMessage } from "../shared/degrad.js";
import { computeIIS } from "../shared/metrics.js";

function runOnce(seed: number): { trace: string; moved: boolean; iis: number } {
  const scenario = loadScenario("reach");
  const world = initWorld(scenario);
  const rng = makeRng(seed);
  const dt = scenario.tick_ms / 1000;
  const trace: unknown[] = [];
  const startX = world.truth.units.find((u) => u.id === "u1")?.x;
  for (let i = 0; i < 400; i++) {
    stepWorld(world, scenario, rng, dt);
    // Exercise the stochastic routing layer deterministically too.
    const link = scenario.links[0];
    const prof = { ...link.base };
    const r = routeMessage(prof, world.time_s, rng);
    if (i % 50 === 0) {
      const view = projectView(world, "cdr", [prof], rng, { tick: world.tick, phase: "running" });
      view.iis = computeIIS(view, world.truth);
      trace.push({ tick: world.tick, t: world.time_s, units: world.truth.units, route: r.action, iis: view.iis });
    }
  }
  const endX = world.truth.units.find((u) => u.id === "u1")?.x;
  // IIS under a degraded link must show divergence (in [0, 1)).
  const badLink = { ...scenario.links[0].base, integrity: 0.5 };
  const badView = projectView(world, "cdr", [badLink], rng, { tick: world.tick, phase: "running" });
  const iis = computeIIS(badView, world.truth);
  return { trace: JSON.stringify(trace), moved: startX !== endX, iis };
}

const a = runOnce(42);
const b = runOnce(42);
const c = runOnce(43);

let fail = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) fail += 1;
};
check("same seed => identical run", a.trace === b.trace);
check("different seed => different run", a.trace !== c.trace);
check("world actually evolves (convoy moves)", a.moved && b.moved);
check("degraded link => IIS shows divergence", a.iis >= 0 && a.iis < 1);
console.log(`trace bytes: ${a.trace.length}, final IIS under degradation: ${a.iis}`);
process.exit(fail ? 1 : 0);
