import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { TopMark } from "./TopMark";
import { downloadAarHtml } from "./aarExport";
import "./aar.css";

/** After-Action Report: dual timelines, IIS curves, calibration, CAST, counterfactual simulator. Print to PDF. */

const f1 = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? "—" : n.toFixed(1));
const f3 = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? "—" : n.toFixed(3));
const signed = (n: number | null | undefined, d: number) =>
  n == null || Number.isNaN(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}`;

export function AARView({ runId }: { runId: string }) {
  const [aar, setAar] = useState<any>(null);
  const [error, setError] = useState("");
  const [cfMode, setCfMode] = useState<"clean_links" | "suppress_spoof">("clean_links");
  const [cf, setCf] = useState<any>(null);
  const [cfLoading, setCfLoading] = useState(false);
  const [cfError, setCfError] = useState("");
  const [notes, setNotes] = useState(() => {
    try { return localStorage.getItem(`aar-notes:${runId}`) ?? ""; } catch { return ""; }
  });

  useEffect(() => {
    if (!runId) { setError("No run ID specified — open from a finished exercise (?view=aar&run=…)"); return; }
    fetch(`/api/runs/${runId}/aar`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setAar)
      .catch((e) => setError(e.message));

    fetch(`/api/runs/${runId}/notes`)
      .then((r) => (r.ok ? r.json() : { notes: "" }))
      .then((d) => { if (d.notes) setNotes(d.notes); })
      .catch(() => {
        try { setNotes(localStorage.getItem(`aar-notes:${runId}`) ?? ""); } catch { setNotes(""); }
      });
  }, [runId]);

  // The counterfactual is computed on demand from the recorded trail — never
  // pre-attached to the AAR, so the panel follows the mode pill that is showing.
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    setCf(null);
    setCfError("");
    setCfLoading(true);
    fetch(`/api/runs/${runId}/counterfactual?mode=${cfMode}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (alive) setCf(d); })
      .catch((e) => { if (alive) setCfError(String(e?.message ?? e)); })
      .finally(() => { if (alive) setCfLoading(false); });
    return () => { alive = false; };
  }, [runId, cfMode]);

  if (error) return <div className="panel" style={{ margin: 20, borderLeft: "4px solid var(--danger)" }}>AAR error: {error}</div>;
  if (!aar) return <div className="panel" style={{ margin: 20 }}>Generating comprehensive After-Action Report…</div>;

  const seats: string[] = aar.header.seats ?? [];
  const series = aar.iisSeries ?? {};
  const W = 680, H = 190;
  const tMax = Math.max(1, ...Object.values(series).flatMap((s: any) => s.map((p: any) => p.t)));
  const colors = ["#9e6f18", "#287834", "#ba6d12", "#b82839", "#1c5b88", "#5c6b73"];
  const path = (pts: any[]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${(p.t / tMax) * W},${H - p.iis * H}`).join(" ");

  const scores = aar.scores ?? null;
  const narrative = aar.narrative ?? { strengths: [], challenges: [], patterns: [], focus: [] };
  const flags: string[] = aar.flags ?? [];
  const decisionCount: number = (aar.decisions ?? []).length;

  // Running divergence = cumulative confidence - accuracy
  const divergence = (() => {
    const bySeat = new Map<string, { t: number; div: number }[]>();
    const run = new Map<string, { c: number; n: number; k: number }>();
    [...(aar.decisions ?? [])]
      .sort((a: any, b: any) => a.t - b.t)
      .forEach((d: any) => {
        const s = run.get(d.seat) ?? { c: 0, n: 0, k: 0 };
        s.n += 1; s.c += Number(d.confidence ?? 0); s.k += d.correct ? 1 : 0;
        run.set(d.seat, s);
        const arr = bySeat.get(d.seat) ?? [];
        arr.push({ t: d.t, div: s.c / s.n - s.k / s.n });
        bySeat.set(d.seat, arr);
      });
    return bySeat;
  })();
  const divergenceMaxT = Math.max(1, ...[...divergence.values()].flat().map((p) => p.t));

  const wentWell: string[] = [];
  const toReview: string[] = [...flags];
  if (scores) {
    if (scores.budgetBand === "LOW") wentWell.push(`Uncertainty budget ${scores.uncertaintyBudget} — LOW band, the final operating picture remained coherent.`);
    else toReview.push(`Uncertainty budget ${scores.uncertaintyBudget} — ${scores.budgetBand} band.`);
    if (scores.verificationRate >= 60) wentWell.push(`Verification discipline ${scores.verificationRate}% — confirm-before-act was habitual.`);
    else if (decisionCount > 0) toReview.push(`Verification discipline ${scores.verificationRate}% — orders were issued without cross-verification.`);
    if (scores.resilience.tier === "HIGH") wentWell.push(`Traffic delivery ${scores.resilience.deliveredRate}% — communications held under stress.`);
    else toReview.push(`Traffic delivery ${scores.resilience.deliveredRate}% — ${scores.resilience.tier} resilience tier.`);
    if (decisionCount > 0 && scores.adaptation >= 80) wentWell.push(`Adaptation score ${scores.adaptation}/95 under degraded communications.`);
    else if (decisionCount > 0) toReview.push(`Adaptation score ${scores.adaptation}/95 — slow OODA loops or unverified traffic degraded performance.`);
    if (decisionCount > 0) {
      if (scores.contradictionAwareness >= 50) wentWell.push(`Contradiction awareness ${scores.contradictionAwareness}% at critical decision moments.`);
      else toReview.push(`Contradiction awareness ${scores.contradictionAwareness}% — conflicting reports were accepted without dispute.`);
    }
  }
  if (wentWell.length === 0) wentWell.push("Standard exercise completed without major benchmark clearance.");

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1160, margin: "0 auto" }}>
      <div className="topbar" style={{ position: "static", borderRadius: 12, marginBottom: 16 }}>
        <TopMark title={`AFTER-ACTION REVIEW · ${aar.header.scenario.toUpperCase()}`} />
        <span className="stat">EXERCISE RUN <b>{aar.header.runId}</b></span>
        <span className="stat">SEED <b>{aar.header.seed}</b></span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => downloadAarHtml(aar, cf, cfMode, notes)}>
          📄 EXPORT HTML DOSSIER
        </button>
        <button className="btn primary" onClick={() => window.print()}>
          🖨️ PRINT / PDF DOSSIER
        </button>
      </div>

      {aar.header.deceptionObjective && (
        <div className="panel" style={{ borderLeft: "4px solid var(--danger)", background: "#fff5f5" }}>
          <h2 style={{ color: "var(--danger)", borderLeft: "none", paddingLeft: 0 }}>
            RED TEAM DECEPTION VECTOR &amp; INTENT
          </h2>
          <p style={{ margin: 0, fontSize: 13.5, color: "#7f1d1d" }}>{aar.header.deceptionObjective}</p>
        </div>
      )}

      {scores && (
        <div className="panel">
          <h2>EXERCISE PERFORMANCE INDICATORS — SCORE MATRIX</h2>
          <div className="aar-strip">
            <Gauge value={scores.adaptation} label="ADAPTATION SCORE" sub="40–95 DOCTRINAL SCALE" display={String(scores.adaptation)} />
            <Gauge value={scores.verificationRate} label="VERIFICATION RATE" sub="OF COMMITTED ORDERS" display={`${scores.verificationRate}%`} />
            <Gauge value={scores.resilience.deliveredRate} label="NET RESILIENCE" sub={scores.resilience.tier} display={`${Math.round(scores.resilience.deliveredRate)}%`} />
            <Gauge value={scores.contradictionAwareness} label="CONTRADICTION DETECT" sub="OF DECISION POINTS" display={`${scores.contradictionAwareness}%`} />
            <Gauge
              value={scores.uncertaintyBudget} max={20}
              label="UNCERTAINTY BUDGET"
              display={`${scores.uncertaintyBudget}`}
              sub={<span className={`lvl ${scores.budgetBand === "LOW" ? "l1" : scores.budgetBand === "ELEVATED" ? "l2" : "l3"}`}>{scores.budgetBand}</span>}
              tone={scores.budgetBand === "LOW" ? "var(--ok)" : scores.budgetBand === "ELEVATED" ? "var(--warn)" : "var(--danger)"}
            />
          </div>
          <p className="aar-disclaimer">{scores.disclaimer ?? "Performance indicators reflect cognitive and procedural agility under synthetic warfare degradation."}</p>
        </div>
      )}

      {/* Counterfactual Decision Simulator */}
      <div className="panel" style={{ background: "linear-gradient(180deg, #faf7f0, #eae4d6)", border: "1px solid var(--line-hi)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0, borderLeftColor: "var(--accent-hi)" }}>
            COUNTERFACTUAL DECISION RE-EVALUATION SIMULATOR
          </h2>
          <div className="nav-pills">
            <button
              className={`btn ghost ${cfMode === "clean_links" ? "primary" : ""}`}
              style={{ padding: "3px 10px", fontSize: 11 }}
              onClick={() => setCfMode("clean_links")}
            >
              CLEAN COMMS BASELINE
            </button>
            <button
              className={`btn ghost ${cfMode === "suppress_spoof" ? "primary" : ""}`}
              style={{ padding: "3px 10px", fontSize: 11 }}
              onClick={() => setCfMode("suppress_spoof")}
            >
              SUPPRESS ADVERSARY SPOOFS
            </button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
          Evaluates what the staff appointment picture and response times would have been without EW disruptions.
        </p>
        <div className="grid2">
          <div className="panel-recessed">
            <b style={{ color: "var(--accent-hi)", fontSize: 12 }}>ACTUAL RECORDED RUN</b>
            <div style={{ marginTop: 6, fontSize: 12 }}>
              <div>Mean Decision Accuracy: <b>{Math.round(((aar.decisions ?? []).filter((d: any) => d.correct).length / Math.max(1, decisionCount)) * 100)}%</b></div>
              <div>Mean OODA Latency: <b>{decisionCount ? (aar.decisions.reduce((a: any, b: any) => a + b.ooda_latency_s, 0) / decisionCount).toFixed(1) : 0}s</b></div>
              <div>Uncertainty Defects: <b>{scores?.uncertaintyBudget ?? 0} pts</b></div>
              {cf && cfMode === "clean_links" && (
                <div>Picture fidelity (IIS team mean): <b>{f3(cf.actual?.iis?.teamMean)}</b></div>
              )}
              {cf && cfMode === "suppress_spoof" && (
                <>
                  <div>Conflicted decisions: <b>{cf.actual?.conflictedDecisions?.n ?? 0} of {cf.actual?.conflictedDecisions?.total ?? 0}</b></div>
                  <div>Hot-picture burden (team mean): <b>{f1(cf.actual?.hotBurden?.teamMean)}</b></div>
                </>
              )}
            </div>
          </div>
          <div className="panel-recessed" style={{ background: "#f0fdf4", borderColor: "#86efac" }}>
            <b style={{ color: "var(--ok)", fontSize: 12 }}>
              COUNTERFACTUAL PREDICTION: {cfMode === "clean_links" ? "PRISTINE LINKS" : "ZERO SPOOFS"}
            </b>
            {cfLoading && <div style={{ marginTop: 6, fontSize: 12, color: "#166534" }}>Recomputing from the recorded trail…</div>}
            {!cfLoading && !cf && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#166534" }}>
                Unavailable{cfError ? ` — ${cfError}` : " for this run."}
              </div>
            )}
            {cf && cfMode === "clean_links" && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#166534" }}>
                <div>Picture fidelity (IIS team mean): <b>{f3(cf.counterfactual?.iis?.teamMean)}</b> <span style={{ opacity: 0.8 }}>({signed(cf.delta?.iis?.teamMean, 3)} vs recorded)</span></div>
                <div>Mean OODA latency: <b>{f1(cf.counterfactual?.ooda?.meanS)}s</b> <span style={{ opacity: 0.8 }}>({signed(cf.delta?.ooda?.meanS, 1)}s over {cf.delta?.ooda?.n ?? 0} decisions)</span></div>
                <div>Decision accuracy: <b>not derivable</b> — the log is replayed, not re-simulated.</div>
              </div>
            )}
            {cf && cfMode === "suppress_spoof" && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#166534" }}>
                <div>Conflicted decisions: <b>{cf.counterfactual?.conflictedDecisions?.n ?? 0} of {cf.counterfactual?.conflictedDecisions?.total ?? 0}</b> <span style={{ opacity: 0.8 }}>({signed(cf.delta?.conflictedDecisions, 0)} vs recorded)</span></div>
                <div>Hot-picture burden (team mean): <b>{f1(cf.counterfactual?.hotBurden?.teamMean)}</b> <span style={{ opacity: 0.8 }}>({signed(cf.delta?.hotBurden?.teamMean, 2)} vs recorded)</span></div>
                <div>Uncertainty budget: <b>{cf.counterfactual?.uncertaintyBudget ?? "—"}</b> <span style={{ opacity: 0.8 }}>({signed(cf.delta?.uncertaintyBudget, 1)} vs recorded)</span></div>
                <div>Spoof-attributable hot ids removed: <b>{cf.delta?.spoofAttributableHotIds ?? 0}</b></div>
              </div>
            )}
          </div>
        </div>
        {cf && (
          <div style={{ marginTop: 12, fontSize: 12 }}>
            <p style={{ margin: "0 0 6px", color: "#3f3a2e" }}>{cf.narrative}</p>
            <div className="muted" style={{ fontSize: 11 }}>
              Basis: {cf.basis} · confidence: {cf.confidence}
            </div>
            <ul style={{ margin: "6px 0 0 18px", fontSize: 11, color: "#575244" }}>
              {(cf.variables ?? []).map((v: any) => (
                <li key={v.label}><b>{v.label}:</b> {v.value}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Per Seat Breakdown */}
      <div className="panel">
        <h2>PER-APPOINTMENT PERFORMANCE METRICS</h2>
        {(aar.perSeat ?? []).length === 0 ? (
          <p className="muted">No appointment data recorded for this run.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>APPOINTMENT</th><th className="num">DECISIONS</th><th className="num">ACCURACY</th>
                <th className="num">MEAN CONF</th><th className="num">OODA MEAN</th>
                <th className="num">RATIONALE WORDS</th><th className="num">RESPONSES</th>
                <th className="num">SENT</th><th className="num">DROPPED</th><th className="num">VERIFICATIONS</th>
              </tr>
            </thead>
            <tbody>
              {aar.perSeat.map((p: any) => (
                <tr key={p.seat}>
                  <td className="mono"><b>{p.seat.toUpperCase()}</b></td>
                  <td className="num">{p.decisions}</td>
                  <td className="num">{p.accuracy}</td>
                  <td className="num">{p.meanConfidence}</td>
                  <td className="num">{p.oodaMean}s</td>
                  <td className="num">{p.rationaleWords}</td>
                  <td className="num">{p.responses}</td>
                  <td className="num">{p.discipline?.sent ?? 0}</td>
                  <td className="num">{p.discipline?.dropped ?? 0}</td>
                  <td className="num">{p.discipline?.verifications ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>DOCTRINAL OBSERVATIONS &amp; PATTERNS</h2>
        <div className="grid2">
          {narrativeBlock("OBSERVED STRENGTHS", narrative.strengths)}
          {narrativeBlock("OBSERVED CHALLENGES", narrative.challenges)}
          {narrativeBlock("DECISION PATTERNS", narrative.patterns)}
          {narrativeBlock("RECOMMENDED TRAINING FOCUS", narrative.focus)}
        </div>
      </div>

      {flags.length > 0 && (
        <div className="panel">
          <h2>CRITICAL DEBRIEF MOMENTS (AUTO-FLAGGED)</h2>
          {flags.map((f: string, i: number) => (
            <div key={i} style={{ padding: "6px 12px", borderLeft: "3px solid var(--accent)", background: "var(--bg-deep)", borderRadius: 4, margin: "6px 0", fontSize: 13 }}>
              {f}
            </div>
          ))}
        </div>
      )}

      {/* IIS Chart */}
      <Section title="INFORMATION INTEGRITY SCORE (IIS) TIMELINE CURVES">
        <div style={{ background: "var(--bg-deep)", padding: 12, borderRadius: 8, border: "1px solid var(--line)" }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }}>
            {[0.25, 0.5, 0.75].map((g) => (
              <line key={g} x1={0} x2={W} y1={H - g * H} y2={H - g * H} stroke="rgba(135,120,95,0.2)" strokeWidth={1} />
            ))}
            {(aar.injects ?? []).map((inj: any, i: number) => (
              <g key={i}>
                <line x1={(inj.t / tMax) * W} x2={(inj.t / tMax) * W} y1={0} y2={H} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.8} />
                <text x={(inj.t / tMax) * W + 4} y={12} fill="var(--accent-hi)" fontSize={9.5} fontFamily="var(--mono)">{inj.label}</text>
              </g>
            ))}
            {seats.map((s, i) => (
              <polyline
                key={s} points={path(series[s] ?? [])} fill="none"
                stroke={colors[i % colors.length]} strokeWidth={2.5}
              />
            ))}
          </svg>
          <div className="row" style={{ marginTop: 8 }}>
            {seats.map((s, i) => (
              <span key={s} className="chip" style={{ borderColor: colors[i % colors.length], color: colors[i % colors.length], fontWeight: 600 }}>
                ● {s.toUpperCase()}
              </span>
            ))}
          </div>
        </div>
      </Section>

      <div className="grid2">
        <Section title="CONFIDENCE vs ACCURACY (CERTAIN-AND-WRONG DETECTOR)">
          {decisionCount > 0 ? (
            <div style={{ background: "var(--bg-deep)", padding: 12, borderRadius: 8, border: "1px solid var(--line)" }}>
              <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", marginBottom: 8 }}>
                {[1, 0.5, -0.5, -1].map((g) => (
                  <line key={g} x1={0} x2={W} y1={H / 2 - (g * (H / 2 - 14))} y2={H / 2 - (g * (H / 2 - 14))} stroke="rgba(135,120,95,0.2)" strokeWidth={1} />
                ))}
                <rect x={0} y={0} width={W} height={H / 2} fill="rgba(184,40,57,0.06)" />
                <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="rgba(135,120,95,0.4)" strokeWidth={1.5} />
                <text x={6} y={13} fontSize={9.5} fontFamily="var(--mono)" fill="var(--danger)" fontWeight="600">OVERCONFIDENT / SPOOF DRIFT ↑</text>
                <text x={6} y={H - 6} fontSize={9.5} fontFamily="var(--mono)" fill="var(--muted)">CALIBRATED ACCURACY ↓</text>
                {[...divergence.entries()].map(([seat, pts], i) => (
                  <polyline
                    key={seat}
                    points={pts.map((p) => `${((p.t / divergenceMaxT) * (W - 8) + 4).toFixed(1)},${(H / 2 - p.div * (H / 2 - 14)).toFixed(1)}`).join(" ")}
                    fill="none" stroke={colors[i % colors.length]} strokeWidth={2}
                  />
                ))}
              </svg>
            </div>
          ) : (
            <p className="muted">No decision records available.</p>
          )}
        </Section>

        <Section title="CAST — ADAPTATION UNDER STRESS (/4)">
          <table className="data">
            <thead><tr><th className="num">TIME</th><th>NOTICED</th><th>DISCUSSED</th><th>CIRCUMVENTED</th><th>OVERCAME</th><th className="num">SCORE</th></tr></thead>
            <tbody>
              {(aar.cast ?? []).map((c: any, i: number) => (
                <tr key={i}>
                  <td className="num">{Math.round(c.t)}s</td>
                  <td>{c.noticed ? "✓" : "—"}</td><td>{c.discussed ? "✓" : "—"}</td>
                  <td>{c.circumvented ? "✓" : "—"}</td><td>{c.overcame ? "✓" : "—"}</td>
                  <td className="num"><b>{c.score}/4</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>

      <Section title="DECISION TABLE (VERBATIM RATIONALE AT COMMITMENT TIME)">
        <table className="data">
          <thead><tr><th className="num">TIME</th><th>SEAT</th><th>DECISION ID</th><th>CHOICE</th><th>CORRECT</th><th className="num">OODA</th><th className="num">CONF</th><th>OPERATIONAL RATIONALE</th></tr></thead>
          <tbody>
            {(aar.decisions ?? []).map((d: any) => (
              <tr key={d.id}>
                <td className="num">{Math.round(d.t)}s</td>
                <td className="mono"><b>{d.seat.toUpperCase()}</b></td>
                <td className="mono">{d.decisionId}</td>
                <td><b>{d.choice}</b></td>
                <td style={{ color: d.correct ? "var(--ok)" : "var(--danger)", fontWeight: 700 }}>{d.correct ? "✓ OPTIMAL" : "✗ MISLEADING"}</td>
                <td className="num">{d.ooda_latency_s}s</td>
                <td className="num">{Math.round(d.confidence * 100)}%</td>
                <td><i>"{d.rationale}"</i></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div className="panel">
        <h2>EXCON INSTRUCTOR DEBRIEF NOTES</h2>
        <textarea
          value={notes}
          placeholder="Enter formal coaching feedback, tactical lessons identified, and doctrinal guidance for the debriefing session…"
          onChange={(e) => {
            const v = e.target.value;
            setNotes(v);
            try { localStorage.setItem(`aar-notes:${runId}`, v); } catch {}
            fetch(`/api/runs/${runId}/notes`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ notes: v }),
            }).catch(() => {});
          }}
        />
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>
          ✓ Notes are stored persistently on the server for Run {runId}.
        </div>
      </div>
    </div>
  );
}

function Gauge({
  value, max = 100, label, sub, display, tone,
}: {
  value: number; max?: number; label: string;
  sub: ReactNode; display: string; tone?: string;
}) {
  const ratio = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const C = 2 * Math.PI * 36;
  const offset = C - ratio * C;
  const stroke = tone ?? (ratio * 100 >= 85 ? "var(--ok)" : ratio * 100 >= 70 ? "var(--warn)" : "var(--danger)");
  return (
    <div className="aar-gauge">
      <div className="aar-gauge-ring">
        <svg viewBox="0 0 96 96" aria-hidden="true">
          <circle cx="48" cy="48" r={36} fill="none" stroke="rgba(135,120,95,0.2)" strokeWidth={7} />
          <circle
            className="aar-arc" cx="48" cy="48" r={36} fill="none"
            stroke={stroke} strokeWidth={7} strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={offset}
            transform="rotate(-90 48 48)"
          />
        </svg>
        <span className="aar-gauge-val mono">{display}</span>
      </div>
      <span className="aar-gauge-label">{label}</span>
      <span className="aar-gauge-sub mono">{sub}</span>
    </div>
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    if (bodyRef.current) setHeight(bodyRef.current.scrollHeight);
  }, [open, children]);

  return (
    <div className="panel aar-section">
      <h2>
        <button type="button" className="aar-sec-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span>{title}</span>
          <svg className={`aar-chev${open ? " on" : ""}`} width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
            <path d="M2 4 L5.5 7.5 L9 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h2>
      <div className="aar-sec-body" ref={bodyRef} style={{ maxHeight: open ? height : 0 }}>
        {children}
      </div>
    </div>
  );
}

function narrativeBlock(title: string, items: string[] | undefined) {
  const list = items ?? [];
  return (
    <div className="brief-block">
      <h3>{title}</h3>
      <ul className="aar-list">
        {list.length
          ? list.map((s, i) => <li key={i}>{s}</li>)
          : <li className="muted">No entries for this run.</li>}
      </ul>
    </div>
  );
}
