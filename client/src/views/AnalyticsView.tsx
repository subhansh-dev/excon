import { useEffect, useMemo, useState } from "react";
import { TopMark, Disclaimer } from "./TopMark";
import "./analytics.css";

interface Row {
  id: string; scenario: string; startedAt: number;
  accuracy: number | null; ooda: number | null; /** percent 0..100 from the server */
  verify: number | null; decisions: number;
}
interface RoleAgg {
  seat: string; runs: number; decisions: number; accuracy: number | null;
  ooda: number | null; words: number | null;
}

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
/** verificationRate arrives already in percent — multiplying it again showed 6670%. */
const pct100 = (n: number | null) => (n === null ? "—" : `${Math.round(n)}%`);
const one = (n: number | null) => (n === null ? "—" : n.toFixed(1));

export function AnalyticsView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [roles, setRoles] = useState<RoleAgg[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");
  const [err, setErr] = useState("");

  // ONE request: the server summarises every run from its event trail.
  // (Was N+1 AAR fetches, each pulling every seat's view file.)
  useEffect(() => {
    let alive = true;
    fetch("/api/analytics")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((payload: { runs?: any[] }) => {
        if (!alive) return;
        const summaries: any[] = payload.runs ?? [];

        const out: Row[] = summaries.map((r) => ({
          id: r.id, scenario: r.scenario,
          startedAt: Date.parse(r.startedAt ?? "") || 0,
          accuracy: r.accuracy ?? null, ooda: r.ooda ?? null,
          verify: r.verify ?? null, decisions: r.decisions ?? 0,
        }));
        out.sort((a, b) => a.startedAt - b.startedAt);

        const roleMap = new Map<string, { runs: Set<string>; decisions: number; correct: number; ooda: number[]; words: number[] }>();
        for (const r of summaries) {
          for (const p of r.perSeat ?? []) {
            const e = roleMap.get(p.seat) ?? { runs: new Set<string>(), decisions: 0, correct: 0, ooda: [], words: [] };
            e.runs.add(r.id);
            e.decisions += p.decisions ?? 0;
            e.correct += Math.round((p.accuracy ?? 0) * (p.decisions ?? 0));
            if (p.oodaMean != null) e.ooda.push(p.oodaMean);
            if (p.rationaleWords != null) e.words.push(p.rationaleWords);
            roleMap.set(p.seat, e);
          }
        }
        const roleRows: RoleAgg[] = [...roleMap.entries()].map(([seat, e]) => ({
          seat, runs: e.runs.size, decisions: e.decisions,
          accuracy: e.decisions ? e.correct / e.decisions : null,
          ooda: e.ooda.length ? e.ooda.reduce((a, b) => a + b, 0) / e.ooda.length : null,
          words: e.words.length ? e.words.reduce((a, b) => a + b, 0) / e.words.length : null,
        })).sort((a, b) => b.decisions - a.decisions);

        setRows(out);
        setRoles(roleRows);
        setState(out.length ? "ready" : "empty");
      })
      .catch((e) => { if (alive) { setErr(String(e?.message ?? e)); setState("empty"); } });
    return () => { alive = false; };
  }, []);

  const kpis = useMemo(() => {
    const acc = rows.map((r) => r.accuracy).filter((n): n is number => n !== null);
    const ood = rows.map((r) => r.ooda).filter((n): n is number => n !== null);
    const ver = rows.map((r) => r.verify).filter((n): n is number => n !== null);
    const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const first = acc.slice(0, Math.ceil(acc.length / 2));
    const last = acc.slice(Math.ceil(acc.length / 2));
    const drift = first.length && last.length
      ? last.reduce((x, y) => x + y, 0) / last.length - first.reduce((x, y) => x + y, 0) / first.length
      : null;
    return { runs: rows.length, acc: mean(acc), ooda: mean(ood), verify: mean(ver), drift };
  }, [rows]);

  const byScenario = useMemo(() => {
    const m = new Map<string, { runs: number; acc: number[]; ooda: number[] }>();
    rows.forEach((r) => {
      const e = m.get(r.scenario) ?? { runs: 0, acc: [], ooda: [] };
      e.runs++;
      if (r.accuracy !== null) e.acc.push(r.accuracy);
      if (r.ooda !== null) e.ooda.push(r.ooda);
      m.set(r.scenario, e);
    });
    return [...m.entries()].map(([scenario, e]) => ({
      scenario, runs: e.runs,
      acc: e.acc.length ? e.acc.reduce((a, b) => a + b, 0) / e.acc.length : null,
      ooda: e.ooda.length ? e.ooda.reduce((a, b) => a + b, 0) / e.ooda.length : null,
    })).sort((a, b) => b.runs - a.runs);
  }, [rows]);

  const curve = rows.filter((r) => r.accuracy !== null);

  return (
    <div>
      <div className="topbar">
        <TopMark title="LONGITUDINAL ANALYTICS" sub="Cross-exercise trends · Defence Services Staff College" />
        <span className="stat">runs indexed <b>{rows.length}</b></span>
        <span style={{ flex: 1 }} />
        <a className="btn ghost" href="?view=lobby">LOBBY</a>
        <a className="btn ghost" href="?view=instructor">EXCON</a>
      </div>

      <div style={{ padding: 14 }}>
        {state === "loading" && <div className="panel"><span className="muted">Indexing run trails…</span></div>}
        {state === "empty" && (
          <div className="panel">
            <span className="muted">{err ? `Could not reach the store: ${err}` : "No completed runs yet — run an exercise first."}</span>
          </div>
        )}

        {state === "ready" && (
          <>
            <div className="panel an-kpis">
              <div className="an-kpi">
                <span className="an-kpi-label">RUNS</span>
                <span className="an-kpi-val">{kpis.runs}</span>
              </div>
              <div className="an-kpi">
                <span className="an-kpi-label">MEAN DECISION ACCURACY</span>
                <span className="an-kpi-val">{pct(kpis.acc)}</span>
              </div>
              <div className="an-kpi">
                <span className="an-kpi-label">MEAN OODA LATENCY</span>
                <span className="an-kpi-val">{one(kpis.ooda)}<i>s</i></span>
              </div>
              <div className="an-kpi">
                <span className="an-kpi-label">VERIFICATION RATE</span>
                <span className="an-kpi-val">{pct100(kpis.verify)}</span>
              </div>
              <div className="an-kpi">
                <span className="an-kpi-label">ACCURACY DRIFT</span>
                <span className="an-kpi-val" style={{ color: kpis.drift === null ? undefined : kpis.drift >= 0 ? "var(--ok)" : "var(--danger)" }}>
                  {kpis.drift === null ? "—" : `${kpis.drift >= 0 ? "+" : ""}${Math.round(kpis.drift * 100)}%`}
                </span>
              </div>
            </div>

            <div className="panel">
              <h2>LEARNING CURVE — DECISION ACCURACY ACROSS EXERCISES</h2>
              {curve.length >= 2 ? (
                <LineChart
                  points={curve.map((r) => ({ label: r.id.slice(-6), v: r.accuracy! * 100 }))}
                  color="var(--accent)" unit="%" max={100}
                />
              ) : (
                <span className="muted">Needs at least two scored runs.</span>
              )}
              <p className="muted" style={{ marginTop: 8 }}>
                Each point is one completed exercise, oldest to newest. Accuracy = share of decisions matching the
                course-of-action the scenario designer scored as optimal; it measures decision quality against a
                benchmark, not the trainee.
              </p>
            </div>

            <div className="grid2">
              <div className="panel">
                <h2>OODA LATENCY BY RUN (SECONDS)</h2>
                {rows.some((r) => r.ooda !== null) ? (
                  <BarChart
                    points={rows.filter((r) => r.ooda !== null).map((r) => ({ label: r.id.slice(-6), v: r.ooda! }))}
                    color="var(--warn)"
                  />
                ) : <span className="muted">No scored decisions.</span>}
              </div>
              <div className="panel">
                <h2>SCENARIO BREAKDOWN</h2>
                <table className="data">
                  <thead>
                    <tr><th>SCENARIO</th><th className="num">RUNS</th><th className="num">ACCURACY</th><th className="num">OODA</th></tr>
                  </thead>
                  <tbody>
                    {byScenario.map((s) => (
                      <tr key={s.scenario}>
                        <td>{s.scenario}</td>
                        <td className="num">{s.runs}</td>
                        <td className="num">{pct(s.acc)}</td>
                        <td className="num">{one(s.ooda)}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel">
              <h2>PER-APPOINTMENT AGGREGATE</h2>
              <table className="data">
                <thead>
                  <tr>
                    <th>APPOINTMENT</th><th className="num">RUNS</th><th className="num">DECISIONS</th>
                    <th className="num">ACCURACY</th><th className="num">OODA</th><th className="num">RATIONALE WORDS</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.seat}>
                      <td className="mono">{r.seat.toUpperCase()}</td>
                      <td className="num">{r.runs}</td>
                      <td className="num">{r.decisions}</td>
                      <td className="num">{pct(r.accuracy)}</td>
                      <td className="num">{one(r.ooda)}s</td>
                      <td className="num">{one(r.words)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted" style={{ marginTop: 8 }}>
                Aggregated across every stored exercise. Rationale length is a proxy for how much reasoning the seat
                externalised before acting — short answers make debrief harder, not decisions better.
              </p>
            </div>
          </>
        )}
      </div>
      <Disclaimer />
    </div>
  );
}

function LineChart({ points, color, unit, max }: { points: { label: string; v: number }[]; color: string; unit: string; max: number }) {
  const W = 760, H = 190, P = 34;
  const step = (W - P * 2) / Math.max(1, points.length - 1);
  const y = (v: number) => H - P - (Math.max(0, Math.min(max, v)) / max) * (H - P * 2);
  const d = points.map((p, i) => `${i ? "L" : "M"}${(P + i * step).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="trend chart">
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1={P} x2={W - P} y1={y(g * max / 100)} y2={y(g * max / 100)} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          <text x={4} y={y(g * max / 100) + 3} fontSize="9" fill="var(--muted)" fontFamily="var(--mono)">{g * max / 100}{unit}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={p.label + i}>
          <circle cx={P + i * step} cy={y(p.v)} r="3" fill="var(--bg)" stroke={color} strokeWidth="1.6" />
          <title>{p.label}: {Math.round(p.v)}{unit}</title>
          {i % Math.ceil(points.length / 8 || 1) === 0 && (
            <text x={P + i * step} y={H - 12} fontSize="8.5" fill="var(--muted)" fontFamily="var(--mono)" textAnchor="middle">{p.label}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

function BarChart({ points, color }: { points: { label: string; v: number }[]; color: string }) {
  const W = 360, H = 170, P = 30;
  const max = Math.max(1, ...points.map((p) => p.v)) * 1.15;
  const bw = (W - P * 2) / points.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="latency bars">
      <line x1={P} x2={W - P} y1={H - P} y2={H - P} stroke="rgba(255,255,255,0.12)" />
      {points.map((p, i) => {
        const h = (p.v / max) * (H - P * 2);
        return (
          <g key={p.label + i}>
            <rect x={P + i * bw + 2} y={H - P - h} width={Math.max(2, bw - 4)} height={h} fill={color} opacity={0.75} rx="1">
              <title>{p.label}: {p.v.toFixed(1)}s</title>
            </rect>
          </g>
        );
      })}
      <text x={4} y={P - 8} fontSize="9" fill="var(--muted)" fontFamily="var(--mono)">{max.toFixed(0)}s</text>
      <text x={W - P} y={H - 8} fontSize="8.5" fill="var(--muted)" fontFamily="var(--mono)" textAnchor="end">
        {points.length} runs
      </text>
    </svg>
  );
}
