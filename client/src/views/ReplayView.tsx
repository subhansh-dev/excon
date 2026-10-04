import { useEffect, useMemo, useRef, useState } from "react";
import { TopMark } from "./TopMark";
import "./replay.css";

/* ------------------------------------------------------------------ types
   Mirrors server/replay.ts — the payload served by GET /api/runs/:id/replay. */
interface REvent {
  seq: number;
  t: number;
  type: string;
  actor: string;
  summary: string;
}
interface RUnit {
  id: string;
  x: number;
  y: number;
  status: string;
}
interface RAsset {
  id: string;
  status: string;
  x?: number;
  y?: number;
}
interface RViewPoint {
  tick: number;
  t: number;
  iis: number;
  links: { id: string; latency_ms: number; loss_pct: number; integrity: number; active: boolean }[];
  hot: string[];
  units: RUnit[];
  assets: RAsset[];
}
interface RTruthPoint {
  tick: number;
  t: number;
  units: RUnit[];
  assets: RAsset[];
}
interface RInject {
  t: number;
  label: string;
}
interface RDecision {
  t: number;
  seat: string;
  decisionId: string;
  choice: string;
  correct: boolean;
  ooda_latency_s: number;
}
interface REntity {
  id: string;
  label: string;
  kind: "unit" | "asset";
}
interface ReplayData {
  runId: string;
  scenario: string;
  seed: number;
  durationS: number;
  events: REvent[];
  seats: string[];
  views: Record<string, RViewPoint[]>;
  truth: RTruthPoint[];
  injects: RInject[];
  decisions: RDecision[];
  /** Entity universe with deck labels — server derives it from ground truth + deck. */
  entities?: REntity[];
}

const SPEEDS = [0.5, 1, 2, 4];

/* ------------------------------------------------------------------ icons */
function IconPlay() {
  return (
    <svg className="rp-ico" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.2 12.6 8 5 12.8Z" />
    </svg>
  );
}
function IconPause() {
  return (
    <svg className="rp-ico" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.6 3.2h2.5v9.6H4.6zM8.9 3.2h2.5v9.6H8.9z" />
    </svg>
  );
}
function IconBack() {
  return (
    <svg className="rp-ico" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M7.9 3.4 2.7 8l5.2 4.6ZM13.5 3.4 8.3 8l5.2 4.6Z" />
    </svg>
  );
}
function IconFwd() {
  return (
    <svg className="rp-ico" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 3.4 7.7 8l-5.2 4.6ZM8.1 3.4 13.3 8l-5.2 4.6Z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ view */
export function ReplayView({ runId }: { runId: string }) {
  const [data, setData] = useState<ReplayData | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [recent, setRecent] = useState<any[]>([]);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!runId) {
      setPhase("loading");
      setData(null);
      fetch("/api/runs")
        .then((r) => (r.ok ? r.json() : []))
        .then((list: any[]) => setRecent(Array.isArray(list) ? list : []))
        .catch(() => setRecent([]));
      return;
    }
    let alive = true;
    setPhase("loading");
    setData(null);
    setPlaying(false);
    setNow(0);
    fetch(`/api/runs/${encodeURIComponent(runId)}/replay`)
      .then((r) => {
        if (r.status === 404) throw new Error("404");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: ReplayData) => {
        if (!alive) return;
        setData(d);
        // Start at the end so the whole run is visible; PLAY rewinds and runs it.
        setNow(Math.max(0, d.durationS ?? 0));
        setPhase("ready");
      })
      .catch((e: Error) => {
        if (!alive) return;
        setErrMsg(e.message);
        setPhase(e.message === "404" ? "missing" : "error");
      });
    return () => {
      alive = false;
    };
  }, [runId]);

  const durS = Math.max(0, Math.ceil(data?.durationS ?? 0));
  const sliderMax = Math.max(1, durS);
  const t = data ? Math.min(now, data.durationS) : 0;

  /* Playback: the interval scales with speed, the step stays 1s (speed × dt).
     FOG-LAB scales BOTH the interval and the step → rate becomes speed². */
  useEffect(() => {
    if (!playing || !data) return;
    const intervalMs = 1000 / speed;
    const stepS = speed * (intervalMs / 1000); // === 1s exactly
    const id = setInterval(() => {
      setNow((prev) => Math.min(data.durationS, prev + stepS));
    }, intervalMs);
    return () => clearInterval(id);
  }, [playing, speed, data]);

  // Auto-stop at the end — kept out of the interval updater so it stays pure.
  useEffect(() => {
    if (playing && data && now >= data.durationS) setPlaying(false);
  }, [playing, now, data]);

  // Newest event sits on top: keep it there while playing, leave the reader
  // alone when paused (they may have scrolled to an earlier moment).
  useEffect(() => {
    if (playing && logRef.current) logRef.current.scrollTop = 0;
  }, [now, playing]);

  const visible = useMemo(() => (data ? data.events.filter((e) => e.t <= t) : []), [data, t]);
  const divergence = useMemo(() => (data ? computeDivergence(data, t) : null), [data, t]);

  const seek = (v: number) => {
    if (!data) return;
    setNow(Math.max(0, Math.min(data.durationS, v)));
  };
  const togglePlay = () => {
    if (!data) return;
    if (!playing && now >= data.durationS) setNow(0);
    setPlaying((p) => !p);
  };

  /* ------------------------------------------------------------ no run id */
  if (!runId) {
    const runs = recent
      .slice()
      .sort((a: any, b: any) => String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? "")))
      .slice(0, 14);
    return (
      <div className="rp">
        <div className="topbar" style={{ position: "static", borderRadius: 10, marginBottom: 12 }}>
          <TopMark title="REPLAY — TIMELINE SCRUBBER" sub="Deterministic event trajectory · ground truth vs seat lanes" />
          <span style={{ flex: 1 }} />
          <nav className="nav-pills">
            <a href="?view=lobby">LOBBY</a>
            <a href="?view=analytics">ANALYTICS</a>
          </nav>
        </div>
        <div className="panel">
          <h2>PICK A RUN TO REPLAY</h2>
          {runs.length === 0 ? (
            <p className="muted">No runs recorded yet — run an exercise from the lobby first.</p>
          ) : (
            <div className="rp-runs">
              {runs.map((r: any) => (
                <div key={r.id} className="rp-run">
                  <span className="rp-run-id mono">{r.id}</span>
                  <span className="muted">{r.scenarioId}</span>
                  <span className="mono muted">seed {r.seed}</span>
                  <span style={{ flex: 1 }} />
                  <span className={`rp-run-state ${r.status === "done" ? "ok" : ""}`}>{r.status}</span>
                  <a className="btn seatbtn" href={`?view=replay&run=${encodeURIComponent(r.id)}`}>
                    OPEN
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* --------------------------------------------------------- empty states */
  if (phase === "loading") {
    return (
      <div className="rp">
        <div className="panel rp-note">Loading replay trajectory for {runId}…</div>
      </div>
    );
  }
  if (phase === "missing" || phase === "error") {
    return (
      <div className="rp">
        <div className="panel rp-empty">
          <h2>{phase === "missing" ? "NO REPLAY DATA" : "REPLAY UNAVAILABLE"}</h2>
          <p className="mono rp-empty-sub">
            GET /api/runs/{runId}/replay → {phase === "missing" ? "404 NOT FOUND" : errMsg}
          </p>
          <p className="muted">
            {phase === "missing"
              ? "The run does not exist, or this route is not wired on the server yet."
              : "The server did not answer. Check that it is running on :2567."}
          </p>
          <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
            <a className="btn" href="?view=lobby">BACK TO LOBBY</a>
            <a className="btn ghost" href="?view=replay">PICK ANOTHER RUN</a>
          </div>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const percent = durS > 0 ? Math.round((t / durS) * 100) : 0;

  /* ---------------------------------------------------------------- main */
  return (
    <div className="rp">
      <div className="topbar" style={{ position: "static", borderRadius: 10, marginBottom: 12 }}>
        <TopMark title={`REPLAY · ${data.scenario}`} sub="Deterministic event trajectory · ground truth vs seat lanes" />
        <span className="stat">run <b>{data.runId}</b></span>
        <span className="stat">seed <b>{data.seed}</b></span>
        <span className="stat">duration <b>{durS}s</b></span>
        <span style={{ flex: 1 }} />
        <nav className="nav-pills">
          <a href="?view=lobby">LOBBY</a>
          <a href={`?view=aar&run=${encodeURIComponent(data.runId)}`}>AAR</a>
        </nav>
      </div>

      {/* -------- scrubber & transport controls -------- */}
      <div className="panel rp-controls">
        <div className="rp-ctl-row">
          <span className="rp-readout mono">
            PLAYHEAD T+{Math.round(t)}s / T+{durS}s <i>{percent}%</i>
          </span>
          <div className="rp-btns">
            <button type="button" className="rp-btn" onClick={() => seek(t - 5)} aria-label="step back 5 seconds">
              <IconBack />
              <span>5S</span>
            </button>
            <button
              type="button"
              className={`rp-btn rp-play${playing ? " on" : ""}`}
              onClick={togglePlay}
              aria-pressed={playing}
            >
              {playing ? <IconPause /> : <IconPlay />}
              <span>{playing ? "PAUSE" : "PLAY"}</span>
            </button>
            <button type="button" className="rp-btn" onClick={() => seek(t + 5)} aria-label="step forward 5 seconds">
              <IconFwd />
              <span>5S</span>
            </button>
            <span className="rp-sep" />
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={`rp-btn rp-speed${speed === s ? " on" : ""}`}
                onClick={() => setSpeed(s)}
                aria-pressed={speed === s}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
        <input
          className="rp-scrub"
          type="range"
          min={0}
          max={sliderMax}
          step={1}
          value={Math.min(Math.round(t), sliderMax)}
          aria-label="playhead scrubber"
          onChange={(e) => {
            setPlaying(false);
            seek(Number(e.target.value));
          }}
        />
      </div>

      <div className="rp-main">
        <div className="rp-col">
          {/* -------- lane chart: ground truth + one lane per seat -------- */}
          <div className="panel">
            <h2>GROUND TRUTH + SEAT LANES</h2>
            <LaneChart data={data} now={t} onSeek={(v) => { setPlaying(false); seek(v); }} />
            <div className="rp-legend">
              <span><i className="rp-sw" />IIS (seat lanes)</span>
              <span><i className="rp-sw v dim" />truth snapshot</span>
              <span><i className="rp-sw v" />decision</span>
              <span><i className="rp-sw v amber" />inject / link</span>
              <span><i className="rp-dot" />probe</span>
              <span><i className="rp-sw v white" />playhead</span>
            </div>
          </div>

          {/* -------- divergence strip -------- */}
          <div className="panel">
            <h2>ENTITY DIVERGENCE vs GROUND TRUTH @ T+{Math.round(t)}s</h2>
            <p className="muted rp-note-line">
              each seat’s latest snapshot at or before the playhead, compared with the truth snapshot at that tick
              (units: status + position, assets: status).
            </p>
            {divergence && (
              <div className="rp-div">
                <div
                  className="rp-div-row head"
                  style={{ gridTemplateColumns: `112px repeat(${divergence.entities.length}, minmax(44px, 1fr))` }}
                >
                  <span className="rp-div-seat">SEAT</span>
                  {divergence.entities.map((e) => (
                    <span key={e.id} className="mono" title={e.id}>
                      {e.label}
                    </span>
                  ))}
                </div>
                {divergence.rows.length === 0 && <p className="muted">No seat lanes in this run.</p>}
                {divergence.rows.map((r) => (
                  <div
                    key={r.seat}
                    className="rp-div-row"
                    style={{ gridTemplateColumns: `112px repeat(${divergence.entities.length}, minmax(44px, 1fr))` }}
                  >
                    <span className="rp-div-seat">
                      {r.seat}
                      <i>{r.viewT !== null ? `view t+${Math.round(r.viewT)}s` : "no snapshot yet"}</i>
                    </span>
                    {divergence.entities.map((e) => {
                      const v = r.cells[e.id] ?? "?";
                      return (
                        <span key={e.id} className={`rp-cell ${v === "✓" ? "ok" : v === "✗" ? "bad" : "unk"}`}>
                          {v}
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* -------- event log -------- */}
        <div className="rp-col">
          <div className="panel rp-log-panel">
            <h2>
              EVENTS ≤ T+{Math.round(t)}s <i className="rp-count mono">{visible.length} / {data.events.length}</i>
            </h2>
            <div className="rp-log" ref={logRef}>
              {visible
                .slice()
                .reverse()
                .map((e) => (
                  <button
                    key={e.seq}
                    type="button"
                    className={`rp-ev ${evEdge(e)}`}
                    onClick={() => { setPlaying(false); seek(e.t); }}
                    title="seek playhead to this event"
                  >
                    <span className="rp-ev-t mono">T+{Math.round(e.t)}s</span>
                    <span className="rp-ev-actor mono">{e.actor}</span>
                    <span className="rp-ev-type">{e.type}</span>
                    <span className="rp-ev-sum">{e.summary}</span>
                  </button>
                ))}
              {visible.length === 0 && (
                <p className="muted">No events at this playhead — press PLAY or scrub forward.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ lane chart */
const W = 1000;
const LABEL_W = 96;
const PAD_R = 14;
const TOP = 26;
const LANE_H = 46;
const AXIS = 22;

function LaneChart({ data, now, onSeek }: { data: ReplayData; now: number; onSeek: (t: number) => void }) {
  const seats = data.seats ?? [];
  const lanes = ["GROUND TRUTH", ...seats];
  const H = TOP + lanes.length * LANE_H + AXIS;
  const plotW = W - LABEL_W - PAD_R;
  const dur = Math.max(1, data.durationS);
  const axisY = TOP + lanes.length * LANE_H;
  const xOf = (v: number) => LABEL_W + Math.min(1, Math.max(0, v / dur)) * plotW;
  const truthTop = TOP;
  const sig = (p: RTruthPoint) =>
    p.units.map((u) => `${u.id}:${u.status}`).join("|") + "#" + p.assets.map((a) => `${a.id}:${a.status}`).join("|");

  const ticks: number[] = [];
  {
    const step = niceStep(dur);
    for (let v = 0; v <= dur && ticks.length < 9; v += step) ticks.push(v);
  }

  return (
    <svg className="rp-lane" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ground truth and per-seat lanes">
      {/* lane beds + labels */}
      {lanes.map((lane, i) => {
        const top = TOP + i * LANE_H;
        return (
          <g key={lane}>
            <rect
              x={LABEL_W}
              y={top}
              width={plotW}
              height={LANE_H}
              fill={i === 0 ? "rgba(158,111,24,0.08)" : "rgba(135,120,95,0.04)"}
            />
            <line x1={LABEL_W} x2={LABEL_W + plotW} y1={top + LANE_H} y2={top + LANE_H} stroke="rgba(135,120,95,0.2)" />
            <text
              x={LABEL_W - 8}
              y={top + LANE_H / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={i === 0 ? 10 : 9.5}
              letterSpacing="0.08em"
              fontFamily="var(--mono)"
              fontWeight={i === 0 ? 700 : 500}
              fill={i === 0 ? "var(--accent-hi)" : "var(--dim)"}
            >
              {lane}
            </text>
          </g>
        );
      })}
      <line x1={LABEL_W} x2={LABEL_W} y1={TOP} y2={axisY} stroke="rgba(135,120,95,0.3)" />

      {/* lane 0 — ground-truth snapshot cadence */}
      {data.truth.length === 0 ? (
        <text x={LABEL_W + 8} y={truthTop + LANE_H / 2} dominantBaseline="middle" fontSize={9} fill="var(--muted)">
          no ground-truth snapshots
        </text>
      ) : (
        data.truth.map((p, i) => {
          const changed = i > 0 && sig(p) !== sig(data.truth[i - 1]);
          const x = xOf(p.t);
          return (
            <line
              key={i}
              x1={x}
              x2={x}
              y1={truthTop + 8}
              y2={truthTop + LANE_H - 8}
              stroke={changed ? "var(--accent)" : "rgba(135,120,95,0.3)"}
              strokeWidth={changed ? 2 : 1}
            />
          );
        })
      )}

      {/* seat lanes — IIS area/line */}
      {seats.map((seat, li) => {
        const top = TOP + (li + 1) * LANE_H;
        const pts = data.views?.[seat] ?? [];
        const yOf = (iis: number) => top + LANE_H - 6 - Math.min(1, Math.max(0, iis)) * (LANE_H - 16);
        const base = top + LANE_H - 6;
        if (pts.length === 0) {
          return (
            <text key={seat} x={LABEL_W + 8} y={top + LANE_H / 2} dominantBaseline="middle" fontSize={9} fill="var(--muted)">
              no view snapshots
            </text>
          );
        }
        const line = pts
          .map((p, i) => `${i ? "L" : "M"}${xOf(p.t).toFixed(1)},${yOf(p.iis).toFixed(1)}`)
          .join(" ");
        const last = pts[pts.length - 1];
        const first = pts[0];
        return (
          <g key={seat}>
            <line x1={LABEL_W} x2={LABEL_W + plotW} y1={yOf(1)} y2={yOf(1)} stroke="rgba(135,120,95,0.15)" strokeDasharray="3 4" />
            {pts.length > 1 && (
              <>
                <path
                  d={`${line} L${xOf(last.t).toFixed(1)},${base.toFixed(1)} L${xOf(first.t).toFixed(1)},${base.toFixed(1)} Z`}
                  fill="rgba(158,111,24,0.12)"
                />
                <path d={line} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinejoin="round" />
              </>
            )}
            {pts.length === 1 && <circle cx={xOf(first.t)} cy={yOf(first.iis)} r={2.5} fill="var(--accent)" />}
          </g>
        );
      })}

      {/* decisions */}
      {data.decisions.map((d, i) => {
        const li = seats.indexOf(d.seat);
        if (li < 0) return null;
        const top = TOP + (li + 1) * LANE_H;
        const x = xOf(d.t);
        return (
          <g key={`d${i}`} className="rp-mk" opacity={d.t <= now ? 1 : 0.3} onClick={() => onSeek(d.t)}>
            <line x1={x} x2={x} y1={top + 4} y2={top + LANE_H - 4} stroke="var(--accent-hi)" strokeWidth={2} />
            <rect x={x - 2} y={top + 3} width={4} height={4} fill="var(--accent-hi)" />
            <text x={x + 4} y={top + 11} fontSize={8} fontFamily="var(--mono)" fill="var(--accent-hi)" fontWeight="700">
              {d.seat.toUpperCase()}
            </text>
          </g>
        );
      })}

      {/* probes */}
      {data.events
        .filter((e) => e.type === "probe" && e.actor !== "server")
        .map((e, i) => {
          const li = seats.indexOf(e.actor);
          if (li < 0) return null;
          const top = TOP + (li + 1) * LANE_H;
          const x = xOf(e.t);
          return (
            <g key={`p${i}`} className="rp-mk" opacity={e.t <= now ? 1 : 0.3} onClick={() => onSeek(e.t)}>
              <circle cx={x} cy={top + LANE_H / 2} r={3.8} fill="#ffffff" stroke="var(--accent)" strokeWidth={1.8} />
            </g>
          );
        })}

      {/* injects / link changes */}
      {data.injects.map((inj, i) => {
        const x = xOf(inj.t);
        const anchor = x > W - 70 ? "end" : x < LABEL_W + 26 ? "start" : "middle";
        return (
          <g key={`i${i}`} className="rp-mk" opacity={inj.t <= now ? 1 : 0.3} onClick={() => onSeek(inj.t)}>
            <line x1={x} x2={x} y1={TOP - 4} y2={axisY} stroke="var(--warn)" strokeWidth={1.4} strokeDasharray="4 3" />
            <text x={x} y={11} textAnchor={anchor} fontSize={8} fontFamily="var(--mono)" fill="var(--warn)" fontWeight="600">
              {inj.label}
            </text>
          </g>
        );
      })}

      {/* playhead */}
      <line x1={xOf(now)} x2={xOf(now)} y1={6} y2={axisY} stroke="var(--text-pure)" strokeWidth={1.5} opacity={0.95} />
      <path d={`M${xOf(now) - 5} 0 L${xOf(now) + 5} 0 L${xOf(now)} 8 Z`} fill="var(--text-pure)" />

      {/* time axis */}
      <line x1={LABEL_W} x2={LABEL_W + plotW} y1={axisY} y2={axisY} stroke="rgba(135,120,95,0.3)" />
      {ticks.map((v) => (
        <g key={v}>
          <line x1={xOf(v)} x2={xOf(v)} y1={axisY} y2={axisY + 4} stroke="rgba(135,120,95,0.4)" />
          <text x={xOf(v)} y={axisY + 15} textAnchor="middle" fontSize={8.5} fontFamily="var(--mono)" fill="var(--muted)">
            T+{v}s
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------ divergence */
interface DivRow {
  seat: string;
  viewT: number | null;
  cells: Record<string, string>;
}

/** Same comparison rules as aar.ts's asymmetry block, run against the playhead. */
function computeDivergence(data: ReplayData, now: number): { entities: REntity[]; rows: DivRow[] } {
  const labelOf = new Map<string, string>();
  const kindOf = new Map<string, "unit" | "asset">();
  let ids: string[] = [];
  for (const e of data.entities ?? []) {
    labelOf.set(e.id, e.label || e.id);
    kindOf.set(e.id, e.kind ?? "unit");
    ids.push(e.id);
  }
  // Older payload with no entities field: derive the universe from truth snapshots.
  if (ids.length === 0) {
    const seen = new Set<string>();
    for (const p of data.truth ?? []) {
      for (const u of p.units ?? []) if (!seen.has(u.id)) { seen.add(u.id); ids.push(u.id); }
      for (const a of p.assets ?? []) if (!seen.has(a.id)) { seen.add(a.id); ids.push(a.id); }
    }
  }

  const truthSnaps = data.truth ?? [];
  const rows: DivRow[] = (data.seats ?? []).map((seat) => {
    const views = data.views?.[seat] ?? [];
    let view: RViewPoint | null = null;
    for (let i = views.length - 1; i >= 0; i--) {
      if (views[i].t <= now) { view = views[i]; break; }
    }
    if (!view) return { seat, viewT: null, cells: {} };

    const snap = [...truthSnaps].reverse().find((s) => s.tick <= view!.tick) ?? truthSnaps[0] ?? null;
    const vunits = new Map((view.units ?? []).map((u): [string, RUnit] => [u.id, u]));
    const tunits = new Map(((snap?.units ?? []) as RUnit[]).map((u): [string, RUnit] => [u.id, u]));
    const vassets = new Map((view.assets ?? []).map((a): [string, RAsset] => [a.id, a]));
    const tassets = new Map(((snap?.assets ?? []) as RAsset[]).map((a): [string, RAsset] => [a.id, a]));

    const cells: Record<string, string> = {};
    for (const id of ids) {
      if (tunits.has(id) || vunits.has(id)) {
        const vu = vunits.get(id);
        const tu = tunits.get(id);
        cells[id] =
          !vu || !tu
            ? "?"
            : vu.status === tu.status && Math.hypot(vu.x - tu.x, vu.y - tu.y) <= 15
              ? "✓"
              : "✗";
      } else {
        const va = vassets.get(id);
        const ta = tassets.get(id);
        cells[id] = !va || !ta || va.status === "unknown" ? "?" : va.status === ta.status ? "✓" : "✗";
      }
    }
    return { seat, viewT: view.t, cells };
  });

  return { entities: ids.map((id) => ({ id, label: labelOf.get(id) ?? id, kind: kindOf.get(id) ?? "unit" })), rows };
}

/* ------------------------------------------------------------ helpers */
/** Border colour by event type — brass / warn / danger / accent / muted. */
function evEdge(e: REvent): string {
  if (e.type === "decision") return "brass";
  if (e.type === "inject" || e.type === "link_change") return "warn";
  if ((e.type === "chat" || e.type === "message") && /\[DROPPED\]/i.test(e.summary)) return "danger";
  if (e.type === "probe") return "accent";
  return "muted";
}

function niceStep(dur: number): number {
  const target = Math.max(1, dur / 5);
  for (const s of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]) if (s >= target) return s;
  return 7200;
}
