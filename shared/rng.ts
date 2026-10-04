// Seeded RNG — the determinism primitive. One instance per run, created from the
// scenario seed. NEVER call Math.random() inside the sim step.
import seedrandom from "seedrandom";

export interface Rng {
  next(): number;
  range(a: number, b: number): number;
  int(a: number, b: number): number;
  pick<T>(arr: T[]): T;
  chance(p: number): boolean;
}

export function makeRng(seed: number | string): Rng {
  const r = seedrandom(String(seed), { entropy: false });
  return {
    next: () => r(),
    range: (a, b) => a + r() * (b - a),
    int: (a, b) => Math.floor(a + r() * (b - a + 1)),
    pick: <T>(arr: T[]): T => arr[Math.floor(r() * arr.length)],
    chance: (p: number) => r() < p,
  };
}
