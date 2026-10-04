// Shared link-health rules for every map surface (2D tactical map + 3D globe),
// so "blackout" and "degraded" mean the same thing in both views and in SeatView.

export interface LinkSum {
  id: string;
  latency_ms: number;
  loss_pct: number;
  integrity: number;
  active: boolean;
}

/** Health of one link for ordering: a down link sinks below every live one. */
export const linkScore = (l: LinkSum): number => (l.active ? l.integrity - l.loss_pct / 500 : -1);

export interface LinkHealth {
  /** Worst-scoring link in the set (null when the seat has no feeds at all). */
  worst: LinkSum | null;
  /** 0..1 — worst link's integrity, zeroed while that link is down; 1 when there are no links. */
  reliability: number;
  blackout: boolean;
  degraded: boolean;
}

export function summarizeLinks(links: LinkSum[]): LinkHealth {
  const worst = links.length ? links.reduce((a, b) => (linkScore(a) <= linkScore(b) ? a : b)) : null;
  const reliability = worst ? Math.max(0, worst.integrity) * (worst.active ? 1 : 0) : 1;
  return {
    worst,
    reliability,
    blackout: links.some((l) => !l.active),
    degraded: reliability < 0.65,
  };
}
