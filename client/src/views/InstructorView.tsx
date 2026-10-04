import { useEffect, useMemo, useRef, useState } from "react";
import type { Room } from "@colyseus/sdk";
import { joinRoom, sendLinkPatch, sendInjectNow, sendFreeze } from "../net";
import { TopMark, Disclaimer, APPOINTMENT_SHORT } from "./TopMark";
import { MapPanel } from "../map/MapPanel";
import { InboxView } from "./InboxView";
import { sound } from "../sound";
import "./instructor.css";

interface Profile {
  latency_ms: number;
  jitter_ms: number;
  loss_pct: number;
  bandwidth_kbps: number;
  integrity: number;
  spoof_pct: number;
  active: boolean;
}

type Patch = Record<string, number | boolean>;
type Mode = "latency" | "dropout" | "partial" | "contradiction" | "spoof" | "blackout";
type Tone = "ok" | "warn" | "bad";

const CLEAN: Profile = {
  latency_ms: 300, jitter_ms: 60, loss_pct: 1, bandwidth_kbps: 128,
  integrity: 1, spoof_pct: 0, active: true,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const MODES: { id: Mode; label: string }[] = [
  { id: "latency", label: "LATENCY" },
  { id: "dropout", label: "DROPOUT" },
  { id: "partial", label: "PARTIAL" },
  { id: "contradiction", label: "CONTRADICTION" },
  { id: "spoof", label: "SPOOF" },
  { id: "blackout", label: "BLACKOUT" },
];

interface Quick {
  id: string;
  label: string;
  caption: string;
  tone?: string;
  kind: "patch" | "restore-all";
  build?: (cur: Profile, base: Profile) => Patch;
}

const QUICK: Quick[] = [
  { id: "lat", label: "+LATENCY", caption: "+3000ms vs baseline", kind: "patch",
    build: (_c, b) => ({ latency_ms: Math.round(b.latency_ms + 3000) }) },
  { id: "drop", label: "60% DROPOUT", caption: "loss 60%", kind: "patch",
    build: () => ({ loss_pct: 60 }) },
  { id: "part", label: "PARTIAL PAYLOAD", caption: "integrity 0.35", kind: "patch",
    build: () => ({ integrity: 0.35 }) },
  { id: "contr", label: "CONTRADICTION", caption: "integrity 0.65 · feed vs truth", kind: "patch",
    build: () => ({ integrity: 0.65 }) },
  { id: "spoof", label: "SPOOF", caption: "spoof 50% · integ 0.60", kind: "patch",
    build: () => ({ spoof_pct: 0.5, integrity: 0.6 }) },
  { id: "black", label: "BLACKOUT", caption: "active false", tone: "danger", kind: "patch",
    build: () => ({ active: false }) },
  { id: "restore", label: "RESTORE ALL", caption: "all → baseline, link up", tone: "restore", kind: "restore-all" },
];

function patchFor(mode: Mode, mag: number, cur: Profile): Patch {
  switch (mode) {
    case "latency":
      return { latency_ms: Math.round(cur.latency_ms + mag * 100) };
    case "dropout":
      return { loss_pct: mag };
    case "partial":
      return { integrity: Math.round(clamp(1 - mag / 100, 0.05, 1) * 100) / 100 };
    case "contradiction":
      return { integrity: Math.round(clamp(1 - mag / 100, 0.5, 0.8) * 100) / 100 };
    case "spoof":
      return {
        spoof_pct: Math.round((mag / 100) * 100) / 100,
        integrity: Math.round(clamp(1 - (mag / 100) * 0.5, 0.5, 1) * 100) / 100,
      };
    case "blackout":
      return { active: false };
  }
}

interface Est {
  addedS: number | null;
  delivery: "INTACT" | "DELAYED" | "LIKELY LOST";
  risk: "low" | "med" | "high";
  narrative: string;
}

function estimateFor(mode: Mode, mag: number, linkId: string, cur: Profile, patch: Patch): Est {
  const proj = { ...cur, ...(patch as Partial<Profile>) } as Profile;
  const addedS = mode === "blackout"
    ? null
    : Math.round(((proj.latency_ms - cur.latency_ms) / 1000) * 10) / 10;
  const delivery: Est["delivery"] =
    !proj.active || proj.loss_pct >= 40 ? "LIKELY LOST"
    : proj.latency_ms >= 1500 ? "DELAYED"
    : "INTACT";
  const risk: Est["risk"] =
    !proj.active || proj.integrity <= 0.5 || proj.spoof_pct >= 0.4 ? "high"
    : proj.integrity <= 0.8 || proj.spoof_pct >= 0.15 || proj.loss_pct >= 25 ? "med"
    : "low";
  const narrative =
    mode === "latency"
      ? `Estimate: traffic on ${linkId} picks up +${addedS}s, so delivered reports arrive ${addedS}s late and the seat acts on an older picture.`
    : mode === "dropout"
      ? `Estimate: about ${mag} of every 100 messages on ${linkId} never arrive; expect holes in the feed rather than merely slow data.`
    : mode === "partial"
      ? `Estimate: payloads crossing ${linkId} arrive roughly ${Math.round((1 - proj.integrity) * 100)}% corrupted, so readouts can be wrong without looking wrong.`
    : mode === "contradiction"
      ? `Estimate: values from ${linkId} sit in the plausible-wrong band, so the seat's numbers can disagree with ground truth and with its other feeds.`
    : mode === "spoof"
      ? `Estimate: ${linkId} carries a ${mag}% spoof flag at integrity ${proj.integrity.toFixed(2)}, so arriving content is garbled to the plausible-wrong band.`
      : `Estimate: ${linkId} goes down and every message routed across it is dropped from this point on.`;
  return { addedS, delivery, risk, narrative };
}

function differs(cur: Profile, base: Profile): boolean {
  return (
    Math.abs(cur.latency_ms - base.latency_ms) > 1 ||
    Math.abs(cur.jitter_ms - base.jitter_ms) > 1 ||
    Math.abs(cur.loss_pct - base.loss_pct) > 0.01 ||
    Math.abs(cur.integrity - base.integrity) > 0.001 ||
    Math.abs(cur.spoof_pct - base.spoof_pct) > 0.001 ||
    cur.active !== base.active
  );
}

function deltaText(cur: Profile, base: Profile): string {
  const parts: string[] = [];
  const dl = Math.round(cur.latency_ms - base.latency_ms);
  if (Math.abs(dl) >= 1) parts.push(`lat ${dl > 0 ? "+" : ""}${dl}ms`);
  const dj = Math.round(cur.jitter_ms - base.jitter_ms);
  if (Math.abs(dj) >= 1) parts.push(`jit ${dj > 0 ? "+" : ""}${dj}ms`);
  const dloss = Math.round(cur.loss_pct - base.loss_pct);
  if (dloss !== 0) parts.push(`loss ${dloss > 0 ? "+" : ""}${dloss}pp`);
  const di = Math.round((cur.integrity - base.integrity) * 100) / 100;
  if (di !== 0) parts.push(`integ ${di > 0 ? "+" : ""}${di.toFixed(2)}`);
  const ds = Math.round((cur.spoof_pct - base.spoof_pct) * 100) / 100;
  if (ds !== 0) parts.push(`spoof ${ds > 0 ? "+" : ""}${ds.toFixed(2)}`);
  if (cur.active !== base.active) parts.push(cur.active ? "back up" : "down");
  return parts.join(" · ");
}

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const keyHits = (tokens: Set<string>, key: string) => {
  const words = key.split(" ").filter(Boolean);
  return words.length > 0 && words.every((w) => tokens.has(w));
};

interface Conflict {
  id: string;
  subject: string;
  source: string;
  text: string;
  truthLine: string;
  detectedAt: number;
  resolved: boolean;
}

function buildConflicts(wire: any[], truth: any, nodes: any[]): Conflict[] {
  if (!truth || !Array.isArray(wire) || wire.length === 0) return [];
  const labels = new Map<string, string>();
  for (const n of nodes ?? []) if (n?.id) labels.set(n.id, n.label ?? n.id);
  const cands: { id: string; label: string; keys: string[]; depth: number; truthLine: string }[] = [];
  for (const u of truth.units ?? []) {
    const label = labels.get(u.id) ?? u.id;
    const keys = [norm(u.id), norm(label)].filter(Boolean);
    const pos = Number.isFinite(u?.x) && Number.isFinite(u?.y)
      ? `, pos (${Math.round(u.x)}, ${Math.round(u.y)})`
      : "";
    cands.push({
      id: u.id, label, keys,
      depth: keys.length ? Math.max(...keys.map((k) => k.split(" ").length)) : 0,
      truthLine: `${label} — status "${u.status}", side ${u.side}${pos}`,
    });
  }
  for (const a of truth.assets ?? []) {
    const label = labels.get(a.id) ?? a.id;
    const keys = [norm(a.id), norm(label)].filter(Boolean);
    const pos = Number.isFinite(a?.x) && Number.isFinite(a?.y) ? `, pos (${a.x}, ${a.y})` : "";
    cands.push({
      id: a.id, label, keys,
      depth: keys.length ? Math.max(...keys.map((k) => k.split(" ").length)) : 0,
      truthLine: `${label} — status "${a.status}"${pos}`,
    });
  }
  const subjectOf = (m: any) => {
    const payloadId = m?.payload?.asset ?? m?.payload?.unit;
    if (payloadId) {
      const direct = cands.find((c) => c.id === payloadId);
      if (direct) return direct;
    }
    const tokens = new Set(norm(m?.text).split(" ").filter(Boolean));
    const hits = cands.filter((c) => c.keys.some((k) => keyHits(tokens, k)));
    hits.sort((a, b) => b.depth - a.depth);
    return hits[0];
  };
  const out: Conflict[] = [];
  for (const m of wire) {
    if (m?.meta?.origin !== "spoof") continue;
    const hit = subjectOf(m);
    if (!hit) continue;
    const resolved = wire.some(
      (x) =>
        x !== m &&
        typeof x?.t_recv === "number" &&
        x.t_recv > m.t_recv &&
        x?.meta?.origin !== "spoof" &&
        subjectOf(x)?.id === hit.id,
    );
    out.push({
      id: m.id, subject: hit.label,
      source: m.meta?.source ?? m.from, text: m.text,
      truthLine: hit.truthLine, detectedAt: m.t_recv, resolved,
    });
  }
  return out.sort((a, b) => b.detectedAt - a.detectedAt).slice(0, 4);
}

function Gauge(props: { label: string; value: string; unit: string; frac: number; tone: Tone | ""; note: string }) {
  const c = 2 * Math.PI * 42;
  const offset = c * (1 - clamp(props.frac, 0, 1));
  return (
    <div className={`inst-gauge${props.tone ? ` inst-gauge--${props.tone}` : ""}`}>
      <div className="inst-gauge-label">{props.label}</div>
      <div className="inst-gauge-dial">
        <svg viewBox="0 0 100 100">
          <circle className="inst-gauge-track" cx="50" cy="50" r="42" />
          <circle
            className="inst-gauge-ring"
            cx="50" cy="50" r="42"
            transform="rotate(-90 50 50)"
            strokeDasharray={c}
            style={{ strokeDashoffset: offset }}
          />
        </svg>
        <div className="inst-gauge-read">
          <div className="inst-gauge-val">{props.value}</div>
          <div className="inst-gauge-unit">{props.unit}</div>
        </div>
      </div>
      <div className="inst-gauge-note">{props.note}</div>
    </div>
  );
}

export function InstructorView() {
  const [room, setRoom] = useState<Room | null>(null);
  const [status, setStatus] = useState("connecting…");
  const [truth, setTruth] = useState<any>(null);
  const [links, setLinks] = useState<any>({});
  const [iis, setIis] = useState<Record<string, number>>({});
  const [feed, setFeed] = useState<any[]>([]);
  const [wire, setWire] = useState<any[]>([]);
  const [warpT, setWarpT] = useState("");
  const [noticeText, setNoticeText] = useState("");
  const [injects, setInjects] = useState<any[]>([]);
  const [objective, setObjective] = useState("");
  const [runId, setRunId] = useState("");
  const [frozen, setFrozen] = useState(false);
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [briefing, setBriefing] = useState("");
  const [objectives, setObjectives] = useState<string[]>([]);
  const [obstacles, setObstacles] = useState<any[]>([]);
  const [geo, setGeo] = useState<any>(null);
  const [linkDefs, setLinkDefs] = useState<any[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [tapTarget, setTapTarget] = useState("__all__");
  const [patchTimes, setPatchTimes] = useState<Record<string, number>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dryLink, setDryLink] = useState("");
  const [dryMode, setDryMode] = useState<Mode>("latency");
  const [dryMag, setDryMag] = useState(50);
  const [dryRes, setDryRes] = useState<{ linkId: string; mode: Mode; mag: number; patch: Patch; est: Est } | null>(null);
  const baselineRef = useRef<Record<string, Profile> | null>(null);

  useEffect(() => {
    let r: Room | null = null;
    let alive = true;
    const params = new URLSearchParams(window.location.search);
    const pw = params.get("pw") ?? "";
    const demo = params.get("demo") === "1";
    joinRoom("instructor", { scenario: params.get("scenario") || "reach", ...(pw ? { password: pw } : {}), ...(demo ? { demo: true } : {}) })
      .then((rm) => {
        if (!alive) { rm.leave(true); return; }
        r = rm;
        setRoom(rm);
        setStatus("connected");
        rm.onMessage("hello", (m: any) => {
          setRunId(m.runId);
          setInjects(m.injects ?? []);
          setObjective(m.deceptionObjective ?? "");
          setBriefing(m.briefing ?? ""); setObjectives(m.objectives ?? []);
          setObstacles(m.obstacles ?? []); setLinkDefs(m.links ?? []);
          setGeo(m.scenario?.geo ?? null);
          setNodes(m.nodes ?? []);
        });
        rm.onMessage("truth", (t: any) => {
          if (!baselineRef.current) baselineRef.current = JSON.parse(JSON.stringify(t.links ?? {}));
          setTruth(t.truth); setLinks(t.links); setIis(t.iis ?? {});
        });
        rm.onMessage("feed", (f: any) => setFeed((p) => [...p.slice(-99), f]));
        rm.onMessage("wiretap", (m: any) => setWire((p) => [...p.slice(-99), m]));
        rm.onStateChange((s: any) => setFrozen(s.freeze));
      })
      .catch((e) => setStatus(`connection failed: ${e.message}`));
    return () => { alive = false; r?.leave(true); };
  }, []);

  const edit = (link: string, k: string, v: number | boolean) =>
    setEdits((e) => ({ ...e, [link]: { ...(e[link] ?? {}), [k]: v } }));

  const sendPatch = (link: string, patch: Patch) => {
    if (!room) return;
    sound.playWarning();
    sendLinkPatch(room, link, patch);
    setPatchTimes((prev) => ({ ...prev, [link]: Date.now() }));
  };

  const apply = (link: string) => {
    if (room && edits[link]) sendPatch(link, edits[link]);
  };

  const restoreLink = (link: string) => {
    sound.playClick();
    const base = baselineRef.current?.[link] ?? links[link] ?? CLEAN;
    sendPatch(link, { ...base, active: true, spoof_pct: 0 });
    setPatchTimes((prev) => { const next = { ...prev }; delete next[link]; return next; });
  };

  const toggleFreeze = () => {
    if (room) {
      if (!frozen) sound.playFreezeKlaxon();
      else sound.playClick();
      sendFreeze(room, !frozen);
      setFrozen(!frozen);
    }
  };

  const sendNotice = () => {
    const text = noticeText.trim();
    if (!room || !text) return;
    sound.playWarning();
    room.send("notice", { text: text.slice(0, 300) });
    setNoticeText("");
  };

  const linkIds = Object.keys(links);
  const linkList = useMemo(
    () => Object.entries(links).map(([id, p]) => ({ id, p: p as Profile })),
    [links],
  );
  const conflicts = useMemo(() => buildConflicts(wire, truth, nodes), [wire, truth, nodes]);

  const patchCount = Object.keys(patchTimes).length;
  useEffect(() => {
    if (!patchCount) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [patchCount]);

  useEffect(() => {
    if (!dryLink && linkIds.length) setDryLink(linkIds[0]);
  }, [dryLink, linkIds]);

  const tapQuick = (q: Quick) => {
    if (!room) return;
    sound.playWarning();
    if (q.kind === "restore-all") { linkIds.forEach(restoreLink); return; }
    const targets = tapTarget === "__all__" ? linkIds : [tapTarget];
    const base = baselineRef.current ?? {};
    for (const id of targets) {
      const cur = links[id] as Profile | undefined;
      if (!cur || !q.build) continue;
      sendPatch(id, q.build(cur, base[id] ?? cur));
    }
  };

  const runPreview = () => {
    const cur = links[dryLink] as Profile | undefined;
    if (!cur) return;
    const patch = patchFor(dryMode, dryMag, cur);
    setDryRes({ linkId: dryLink, mode: dryMode, mag: dryMag, patch, est: estimateFor(dryMode, dryMag, dryLink, cur, patch) });
  };

  const commitDry = () => {
    if (!dryRes) return;
    sendPatch(dryRes.linkId, dryRes.patch);
  };

  const reliability = linkList.length
    ? mean(linkList.map(({ p }) => (p.active ? (1 - p.loss_pct / 100) * p.integrity : 0))) * 100
    : null;
  const meanLat = linkList.length ? mean(linkList.map(({ p }) => p.latency_ms)) : null;
  const meanLoss = linkList.length ? mean(linkList.map(({ p }) => p.loss_pct)) : null;

  const relTone: Tone | "" = reliability === null ? "" : reliability >= 85 ? "ok" : reliability >= 70 ? "warn" : "bad";
  const relNote = relTone === "ok" ? "within tolerance" : relTone === "warn" ? "expect missed reports" : relTone === "bad" ? "assume losses" : "awaiting link profiles";
  const latTone: Tone | "" = meanLat === null ? "" : meanLat <= 1000 ? "ok" : meanLat <= 3000 ? "warn" : "bad";
  const latNote = latTone === "ok" ? "within tolerance" : latTone === "warn" ? "reports arrive stale" : latTone === "bad" ? "decisions outpace the net" : "awaiting link profiles";
  const lossTone: Tone | "" = meanLoss === null ? "" : meanLoss < 10 ? "ok" : meanLoss <= 30 ? "warn" : "bad";
  const lossNote = lossTone === "ok" ? "within tolerance" : lossTone === "warn" ? "expect missed reports" : lossTone === "bad" ? "assume losses" : "awaiting link profiles";

  const activeRows = linkList.filter(({ id, p }) => {
    const b = baselineRef.current?.[id];
    return Boolean(patchTimes[id]) || p.active === false || (b ? differs(p, b) : false);
  });

  const magReadout =
    dryMode === "blackout" ? "link down"
    : dryMode === "latency" ? `+${(dryMag / 10).toFixed(1)}s`
    : dryMode === "dropout" ? `${dryMag}% loss`
    : dryMode === "partial" ? `integrity ${(clamp(1 - dryMag / 100, 0.05, 1)).toFixed(2)}`
    : dryMode === "contradiction" ? `integrity ${clamp(1 - dryMag / 100, 0.5, 0.8).toFixed(2)}`
    : `spoof ${dryMag}%`;

  const deliveryCls = dryRes ? (dryRes.est.delivery === "INTACT" ? "ok" : dryRes.est.delivery === "DELAYED" ? "warn" : "bad") : "";

  return (
    <div>
      <div className="topbar">
        <TopMark title="EXERCISE CONTROL — INSTRUCTOR" />
        <span className="seat">GROUND TRUTH</span>
        <span className="stat">run <b>{runId || "—"}</b></span>
        <span className="stat">t+<b>{truth ? Math.round(truth.t ?? 0) : 0}s</b></span>
        <span className="stat">{status}</span>
        <span style={{ flex: 1 }} />
        <button className="btn danger" onClick={toggleFreeze}>{frozen ? "UNFREEZE" : "FREEZE ALL"}</button>
        <button
          className="btn"
          title="Fresh room + scripted seats + auto injects. Close all trainer tabs first for a clean run."
          onClick={() => {
            const q = new URLSearchParams(window.location.search);
            q.set("demo", "1");
            window.open(`${window.location.pathname}?${q.toString()}`, "_blank");
          }}
        >
          START DEMO EXERCISE
        </button>
        {runId && <a className="btn" href={`?view=aar&run=${runId}`} target="_blank" rel="noreferrer">AAR</a>}
      </div>
      <div className="layout">
        <div>
          <div className="panel">
            <h2>GROUND TRUTH (TRAINEES NEVER SEE THIS)</h2>
            <MapPanel units={truth?.units ?? []} assets={truth?.assets ?? []} obstacles={obstacles} hot={[]} links={Object.values(links)} geo={geo} />
          </div>
          <div className="panel">
            <h2>ONE-TAP DISRUPTION</h2>
            <div className="inst-tap-head">
              <span className="inst-lbl">target</span>
              <div className="inst-selwrap">
                <select value={tapTarget} onChange={(e) => setTapTarget(e.target.value)}>
                  <option value="__all__">ALL LINKS</option>
                  {linkIds.map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              </div>
              <span className="muted">a manual patch overrides that link's scheduled timeline until restored</span>
            </div>
            <div className="inst-tap">
              {QUICK.map((q) => (
                <button key={q.id} className={q.tone ?? ""} disabled={!room || linkIds.length === 0} onClick={() => tapQuick(q)}>
                  <span className="inst-tap-t">{q.label}</span>
                  <span className="inst-tap-c">{q.caption}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="panel">
            <h2>LIVE TELEMETRY — ALL LINKS</h2>
            <div className="inst-gauges">
              <Gauge label="COMMS RELIABILITY" value={reliability === null ? "—" : String(Math.round(reliability))} unit="%" frac={(reliability ?? 0) / 100} tone={relTone} note={relNote} />
              <Gauge label="MEAN LATENCY" value={meanLat === null ? "—" : String(Math.round(meanLat))} unit="ms" frac={(meanLat ?? 0) / 5000} tone={latTone} note={latNote} />
              <Gauge label="MEAN PACKET LOSS" value={meanLoss === null ? "—" : String(Math.round(meanLoss))} unit="%" frac={(meanLoss ?? 0) / 100} tone={lossTone} note={lossNote} />
            </div>
            <div className="inst-note">reliability = mean(integrity × delivery) over live link profiles · thresholds 85/70 reliability, 1000/3000ms latency, 10/30% loss · computed client-side</div>
          </div>
          {conflicts.length > 0 && (
            <div className="panel">
              <h2>CONTRADICTION WATCH</h2>
              {conflicts.map((c) => (
                <div className="inst-conf" key={c.id}>
                  <div className="inst-conf-head">
                    <span className="inst-conf-subject">subject · {c.subject}</span>
                    <span className="inst-conf-t">DETECTED t+{Math.round(c.detectedAt)}s</span>
                    <span className={c.resolved ? "chip ok" : "chip origin"}>{c.resolved ? "RESOLVED" : "ACTIVE"}</span>
                    {c.resolved && <span className="muted">a later honest report on this subject superseded it</span>}
                  </div>
                  <div className="inst-conf-grid">
                    <div className="inst-conf-col a">
                      <div className="inst-conf-src">SOURCE A SAYS · {c.source} (spoof-flagged)</div>
                      <div className="inst-conf-text">{c.text}</div>
                    </div>
                    <div className="inst-conf-col b">
                      <div className="inst-conf-src">SOURCE B SAYS · GROUND TRUTH (instructor only)</div>
                      <div className="inst-conf-text">{c.truthLine}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {objective && <div className="panel"><h2>DECEPTION OBJECTIVE</h2><p>{objective}</p></div>}
          {(briefing || objectives.length > 0) && (
            <div className="panel">
              <h2>TRAINEE BRIEF</h2>
              {briefing && <p>{briefing}</p>}
              {objectives.length > 0 && (
                <ul className="obj">{objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>
              )}
            </div>
          )}
          <div className="panel">
            <h2>PER-SEAT INFORMATION INTEGRITY (IIS)</h2>
            <table className="data">
              <thead><tr><th>seat</th><th>iis</th></tr></thead>
              <tbody>
                {Object.entries(iis).map(([s, v]) => (
                  <tr key={s}><td className="mono">{s}</td><td className="mono">{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="panel">
            <h2>INJECT DRY-RUN — ESTIMATE ONLY</h2>
            <div className="inst-form">
              <div>
                <span className="inst-lbl">link</span>
                <select value={dryLink} onChange={(e) => { setDryLink(e.target.value); setDryRes(null); }}>
                  {linkIds.map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              </div>
              <div>
                <span className="inst-lbl">magnitude</span>
                <div className="inst-maghead">
                  <span>applied value</span>
                  <b>{magReadout}</b>
                </div>
                <input
                  type="range" min={0} max={100} step={5} value={dryMag}
                  disabled={dryMode === "blackout"}
                  onChange={(e) => { setDryMag(Number(e.target.value)); setDryRes(null); }}
                />
              </div>
              <div className="inst-full">
                <span className="inst-lbl">degradation mode</span>
                <div className="inst-modes">
                  {MODES.map((m) => (
                    <button
                      key={m.id}
                      className={`inst-mode${dryMode === m.id ? " sel" : ""}`}
                      onClick={() => { setDryMode(m.id); setDryRes(null); }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="inst-actions">
              <button className="btn" disabled={!room || !dryLink} onClick={runPreview}>PREVIEW IMPACT</button>
              <button className="btn ghost" disabled={!room || !dryRes} onClick={commitDry}>COMMIT</button>
            </div>
            {dryRes && (
              <div className="inst-est">
                <div className="inst-est-head">ESTIMATE — COMPUTED CLIENT-SIDE FROM CURRENT LINK STATE</div>
                <div className="inst-est-stats">
                  <span>
                    <span className="inst-est-k">link</span>
                    <span className="inst-est-v">{dryRes.linkId}</span>
                  </span>
                  <span>
                    <span className="inst-est-k">mode</span>
                    <span className="inst-est-v">{MODES.find((m) => m.id === dryRes.mode)?.label ?? dryRes.mode}</span>
                  </span>
                  <span>
                    <span className="inst-est-k">added latency</span>
                    <span className="inst-est-v">{dryRes.est.addedS === null ? "—" : `+${dryRes.est.addedS}s`}</span>
                  </span>
                  <span>
                    <span className="inst-est-k">expected delivery</span>
                    <span className={`inst-est-v ${deliveryCls}`}>{dryRes.est.delivery}</span>
                  </span>
                  <span>
                    <span className="inst-est-k">conflict risk</span>
                    <span className={`risk ${dryRes.est.risk}`}>{dryRes.est.risk.toUpperCase()}</span>
                  </span>
                  <span>
                    <span className="inst-est-k">affects</span>
                    <span className="inst-est-v">
                      {(linkDefs.find((l: any) => l.id === dryRes.linkId)?.seats ?? [])
                        .map((s: string) => APPOINTMENT_SHORT[s] || s.toUpperCase())
                        .join(" · ") || "—"}
                    </span>
                  </span>
                </div>
                <div className="inst-est-note">{dryRes.est.narrative}</div>
                <div className="muted inst-est-foot">Deterministic arithmetic on the link profile this console last received — not a simulation of the server router, not a prediction of truth.</div>
              </div>
            )}
          </div>
          <div className="panel">
            <h2>ACTIVE DISRUPTIONS</h2>
            {activeRows.length === 0 ? (
              <div className="inst-empty">No link deviates from the profile this console observed at connect.</div>
            ) : (
              activeRows.map(({ id, p }) => {
                const b = baselineRef.current?.[id];
                const st: Tone = !p.active ? "bad"
                  : p.loss_pct >= 10 || p.integrity <= 0.8 || p.latency_ms >= 3000 ? "warn"
                  : "ok";
                const stLabel = st === "bad" ? "DOWN" : st === "warn" ? "DEGRADED" : "NOMINAL";
                const since = patchTimes[id];
                const delta = b ? deltaText(p, b) : "";
                return (
                  <div className="inst-row" key={id}>
                    <span className="inst-row-id">{id}</span>
                    <span className={`net ${st}`}>{stLabel}</span>
                    <span className="inst-row-nums">lat {Math.round(p.latency_ms)}ms · loss {Math.round(p.loss_pct)}% · integ {p.integrity.toFixed(2)}</span>
                    {delta && <span className="inst-row-delta">Δ {delta}</span>}
                    <span className={since ? "inst-since" : "inst-when"}>
                      {since ? `${Math.max(0, Math.round((nowMs - since) / 1000))}s since this console` : "changed since connect"}
                    </span>
                    <span className="inst-grow" />
                    <button className="btn ghost" onClick={() => restoreLink(id)}>RESTORE</button>
                  </div>
                );
              })
            )}
            <div className="inst-note">live values only · this console gets no server-side patch clock, so a countdown appears only for patches sent from here</div>
          </div>
          <div className="panel">
            <h2>LINK CONTROL (LIVE DEGRADATION)</h2>
            {Object.entries(links).map(([id, p]: [string, any]) => {
              const e = edits[id] ?? {};
              const num = (k: string, min: number, max: number, step: number) => (
                <div key={k}>
                  <label className="lbl">{k}: {e[k] ?? p[k]}</label>
                  <input type="range" min={min} max={max} step={step} value={e[k] ?? p[k]}
                    onChange={(ev) => edit(id, k, Number(ev.target.value))} />
                </div>
              );
              return (
                <div key={id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8, marginBottom: 8 }}>
                  <div className="row"><b className="mono">{id}</b>
                    <button className="btn" onClick={() => apply(id)}>APPLY</button>
                    <button className="btn danger" onClick={() => room && sendPatch(id, { active: !(e.active ?? p.active) })}>
                      {(e.active ?? p.active) ? "BLACKOUT" : "RESTORE"}
                    </button>
                  </div>
                  <div className="muted">affects: {(linkDefs.find((d: any) => d.id === id)?.seats ?? []).join(", ") || "—"}</div>
                  {num("latency_ms", 0, 10000, 100)}
                  {num("loss_pct", 0, 100, 5)}
                  {num("integrity", 0, 1, 0.05)}
                </div>
              );
            })}
          </div>
          <div className="panel">
            <h2>FIRE INJECT NOW</h2>
            {injects.map((inj: any) => (
              <div key={inj.index} className="row" style={{ marginBottom: 6 }}>
                <span className="mono muted">t={inj.t}s</span>
                <span style={{ fontSize: 12 }}>{inj.type}{inj.link ? ` ${inj.link}` : ""}{inj.from ? ` ${inj.from}→${inj.to}` : ""}</span>
                <button className="btn" onClick={() => room && sendInjectNow(room, inj.index)}>FIRE</button>
              </div>
            ))}
          </div>
          <div className="panel">
            <h2>SCENARIO TIME (EXCON WARP)</h2>
            <div className="row">
              <input type="text" placeholder="t seconds, e.g. 335" value={warpT} onChange={(e) => setWarpT(e.target.value)} style={{ width: 170 }} />
              <button className="btn" onClick={() => room && warpT && room.send("time_set", { t: Number(warpT) })}>WARP</button>
            </div>
            <div className="muted" style={{ marginTop: 6 }}>Jumps sim time; due injects and decisions fire on the next ticks. Logged in the run trail.</div>
          </div>
          <div className="panel">
            <h2>TIME SCALE</h2>
            <div className="row">
              {[0.25, 0.5, 1, 2, 4, 10].map((s) => (
                <button key={s} className="btn" onClick={() => room && room.send("time_scale", { scale: s })}>×{s}</button>
              ))}
            </div>
            <div className="muted" style={{ marginTop: 6 }}>Speeds the sim clock. Logged in the run trail; seats see the × indicator.</div>
          </div>
          <div className="panel">
            <h2>SEAT BROADCAST (EXCON ADJUTANT)</h2>
            <div className="row">
              <input
                type="text"
                placeholder="Message to every seat, e.g. HOLD AT CHECKPOINT DELTA"
                value={noticeText}
                onChange={(e) => setNoticeText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendNotice(); }}
                maxLength={300}
                style={{ flex: 1 }}
              />
              <button className="btn primary" onClick={sendNotice} disabled={!room || !noticeText.trim()}>BROADCAST</button>
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              Shows as the adjutant banner on every seat, appended to the run trail as a state event.
            </div>
          </div>
          <div className="panel">
            <h2>LIVE FEED (DECISIONS + ROUTER)</h2>
            <div className="inbox">
              {[...feed].reverse().map((f, i) => (
                <div key={i} className="msg"><span className="mono muted">t+{Math.round(f.t)}s </span>{f.text}</div>
              ))}
            </div>
          </div>
          <div className="panel">
            <h2>WIRETAP — ALL DELIVERED TRAFFIC (ORIGIN VISIBLE HERE ONLY)</h2>
            <InboxView messages={wire} showOrigin />
          </div>
        </div>
      </div>
      <Disclaimer />
    </div>
  );
}
