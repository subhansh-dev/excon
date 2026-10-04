/** Link-status visuals for degraded-comms telemetry: signal bars, jam/blackout badges, age-of-information. */

export function SignalBars({ integrity }: { integrity: number }) {
  const safe = Number.isFinite(integrity) ? Math.max(0, Math.min(1, integrity)) : 1;
  const bars = Math.max(1, Math.round(safe * 5));
  const tone = safe >= 0.9 ? "ok" : safe >= 0.6 ? "warn" : "bad";
  return (
    <span className={`sb sb-${tone}`} title={`Signal integrity ${Math.round(safe * 100)}%`} aria-label={`signal integrity ${Math.round(safe * 100)} percent`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={i < bars ? "on" : ""} />
      ))}
    </span>
  );
}

export function linkStatus(l: { active?: boolean; integrity?: number; latency_ms?: number; loss_pct?: number }): { word: string; cls: "ok" | "warn" | "bad" } {
  if (l?.active === false) return { word: "BLACKOUT", cls: "bad" };
  const int = l?.integrity ?? 1;
  const lat = l?.latency_ms ?? 0;
  const loss = l?.loss_pct ?? 0;
  if (int < 0.6 || lat > 3000 || loss > 40) return { word: "JAM", cls: "bad" };
  if (int < 0.9 || lat > 1200 || loss > 15) return { word: "DEGRADED", cls: "warn" };
  return { word: "CLEAN", cls: "ok" };
}

/** Age of information: seconds since the link last carried traffic (server-stamped). */
export function AoIChip({ ageS, active }: { ageS?: number; active?: boolean }) {
  if (active) return <span className="aoi aoi-ok" title="Link is live — information is current">AoI 0s</span>;
  if (typeof ageS !== "number") return null;
  const cls = ageS > 120 ? "aoi-bad" : ageS > 30 ? "aoi-warn" : "aoi-ok";
  return <span className={`aoi ${cls}`} title="Seconds since this link last carried traffic">{ageS}s</span>;
}
