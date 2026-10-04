// Contradiction / Conflict Audit Log — derived STRICTLY from the recorded run trail.
// Idea ported from the rival FOG-LAB "Contradiction Audit & Resolution Log"
// (backend/app/degradation/contradiction.py + ContradictionHeatmap card); the rival's
// schema (uuid conflict ids, hardcoded source_a/value_a pairs) is NOT copied — every
// field below traces to an event in events.jsonl or a snapshot in views/*.jsonl.
//
// Derivation rules (no invention):
//   spoof         <- inject events with data.meta.origin === "spoof"
//   link_down     <- link_change events / degradation injects with patch.active === false
//   stale | contradiction <- per-seat `hot` arrays (room.ts flags payload.asset/unit
//                   for 120s on report/event injects); kind split by the state of that
//                   seat's picture at detection time
//   resolution     <- later events / later snapshots (see each builder)
//
// NOTE on kind "resolved": resolutions are recorded ON the detecting entry
// (status + resolvedAt + resolutionNote) rather than as separate rows, so byKind never
// carries "resolved"; the member stays in the union so the client can style it.
import { existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import type { RunEvent, RunStore } from "./store.js";
import type { DegradedView, GroundTruth } from "../shared/types.js";

export type AuditKind = "spoof" | "contradiction" | "stale" | "link_down" | "resolved";

export interface AuditEntry {
  id: string;
  detectedAt: number; // sim-seconds
  kind: AuditKind;
  topic: string;
  claim: string;
  source: string;
  conflictingSource: string;
  seats: string[];
  resolvedAt: number | null;
  status: "OPEN" | "RESOLVED";
  resolutionNote: string | null;
}

export interface AuditSummary {
  total: number;
  open: number;
  resolved: number;
  byKind: Record<string, number>;
}

export interface AuditLog {
  entries: AuditEntry[];
  summary: AuditSummary;
}

// ---------------------------------------------------------------------------
// Shared run-log readers (also consumed by counterfactual.ts)
// ---------------------------------------------------------------------------

const NON_SEAT_ACTORS = new Set(["server", "router", "timeline", "instructor", "system"]);
/** room.ts: `this.hot.set(id, time_s + 120)` on report/event injects. */
const HOT_WINDOW_S = 120;
const RUNS_DIR = () => resolve(process.env.RUNS_DIR || "./runs");

/**
 * Trailing events after `run {status:"done"}` are room teardown (the instructor link
 * sweep recorded at t=end), not participant-visible degradation — drop them so the
 * audit never reports a link dying after the run already ended.
 */
export function trimRunEvents(events: RunEvent[]): RunEvent[] {
  const doneIdx = events.findIndex((e) => e.type === "run" && e.data?.status === "done");
  return doneIdx === -1 ? events : events.slice(0, doneIdx + 1);
}

/** Seats = actors in the trail ∪ basenames of stored view files (either can be missing). */
export function discoverSeats(runId: string, events: RunEvent[]): string[] {
  const seats = new Set<string>();
  for (const e of events) if (e && !NON_SEAT_ACTORS.has(e.actor)) seats.add(e.actor);
  try {
    const dir = join(RUNS_DIR(), runId, "views");
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".jsonl")) {
          const seat = f.slice(0, -".jsonl".length);
          if (!NON_SEAT_ACTORS.has(seat)) seats.add(seat);
        }
      }
    }
  } catch {
    /* fs unavailable — the event-derived seats are still valid */
  }
  return [...seats].sort();
}

/** Load every seat's snapshot series (sorted by tick). Seats with no file are skipped. */
export async function loadViews(
  runId: string,
  store: RunStore,
  seats: string[],
): Promise<Map<string, DegradedView[]>> {
  const out = new Map<string, DegradedView[]>();
  for (const seat of seats) {
    const rows = await store.getViews(runId, seat);
    const parsed = (rows ?? []).filter((r) => r && typeof r === "object") as DegradedView[];
    parsed.sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0));
    if (parsed.length) out.set(seat, parsed);
  }
  return out;
}

export interface TruthRow {
  tick: number;
  t: number;
  truth: GroundTruth;
}

/** groundTruth.jsonl rows: `{tick, t, truth:{units,assets,...}}`, sorted by tick. */
export async function loadTruthRows(runId: string, store: RunStore): Promise<TruthRow[]> {
  const rows = await store.getTruth(runId);
  const parsed = (rows ?? [])
    .filter((r) => r && typeof r === "object" && r.truth)
    .map((r) => ({ tick: Number(r.tick ?? 0), t: Number(r.t ?? 0), truth: r.truth as GroundTruth }));
  parsed.sort((a, b) => a.tick - b.tick);
  return parsed;
}

/**
 * Truth for a view's tick: exact tick, else nearest earlier row (matches how aar.ts
 * picks a truth snapshot), else the earliest row when the view predates all truth rows.
 * Returns null only when the run recorded no truth at all.
 */
export function pickTruth(rows: TruthRow[], tick: number): { row: TruthRow; exact: boolean } | null {
  if (!rows.length) return null;
  let exact: TruthRow | undefined;
  let below: TruthRow | undefined;
  for (const r of rows) {
    if (r.tick === tick) {
      exact = r;
      break;
    }
    if (r.tick < tick) below = r;
  }
  if (exact) return { row: exact, exact: true };
  if (below) return { row: below, exact: false };
  return { row: rows[0], exact: false };
}

// ---------------------------------------------------------------------------
// Audit construction
// ---------------------------------------------------------------------------

interface Draft {
  key: string;
  kind: AuditKind;
  detectedAt: number;
  topic: string;
  claim: string;
  source: string;
  conflictingSource: string;
  seats: Set<string>;
  resolvedAt: number | null;
  resolutionNote: string | null;
}

export async function buildAuditLog(runId: string, store: RunStore): Promise<AuditLog> {
  const events = trimRunEvents(await store.getEvents(runId));
  const seats = discoverSeats(runId, events);
  const viewsBySeat = await loadViews(runId, store, seats);
  const truthRows = await loadTruthRows(runId, store);

  const drafts: Draft[] = [
    ...spoofDrafts(events),
    ...linkDownDrafts(events, viewsBySeat),
    ...hotDrafts(events, viewsBySeat, truthRows),
  ];

  drafts.sort(
    (a, b) =>
      a.detectedAt - b.detectedAt ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
      (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0),
  );

  const entries: AuditEntry[] = drafts.map((d, i) => ({
    id: `AUD-${String(i + 1).padStart(3, "0")}`,
    detectedAt: d.detectedAt,
    kind: d.kind,
    topic: d.topic,
    claim: d.claim,
    source: d.source,
    conflictingSource: d.conflictingSource,
    seats: [...d.seats].sort(),
    resolvedAt: d.resolvedAt,
    status: d.resolvedAt === null ? "OPEN" : "RESOLVED",
    resolutionNote: d.resolutionNote,
  }));

  // Every kind is always present (zeros included) so an empty run reports clean zeros.
  const counts: Record<AuditKind, number> = { spoof: 0, contradiction: 0, stale: 0, link_down: 0, resolved: 0 };
  for (const e of entries) counts[e.kind] += 1;

  return {
    entries,
    summary: {
      total: entries.length,
      open: entries.filter((e) => e.status === "OPEN").length,
      resolved: entries.filter((e) => e.status === "RESOLVED").length,
      byKind: counts,
    },
  };
}

// ---- spoof injects ---------------------------------------------------------

function spoofDrafts(events: RunEvent[]): Draft[] {
  const out = new Map<string, Draft>();
  for (const e of events) {
    if (e.type !== "inject" || e.data?.meta?.origin !== "spoof") continue;
    const d = e.data as Record<string, any>;
    const payload: Record<string, any> = d.payload ?? {};
    const text = typeof payload.text === "string" ? payload.text : "";
    const topic =
      typeof d.link === "string" && d.link
        ? `link:${d.link}`
        : typeof payload.asset === "string" && payload.asset
          ? payload.asset
          : typeof payload.unit === "string" && payload.unit
            ? payload.unit
            : text
              ? `report: "${truncate(text, 60)}"`
              : String(d.type ?? "spoof");
    const claim = text || `${String(d.type ?? "inject")} recorded with origin=spoof`;
    const source = typeof d.from === "string" && d.from ? `spoof inject (from ${d.from})` : "spoof inject";
    const key = `spoof|${topic}|${claim}`;
    const recipients = spoofRecipients(events, d, text);
    const prev = out.get(key);
    if (prev) {
      prev.detectedAt = Math.min(prev.detectedAt, e.t);
      for (const s of recipients) prev.seats.add(s);
      continue;
    }
    out.set(key, {
      key,
      kind: "spoof",
      detectedAt: e.t,
      topic,
      claim,
      source,
      // The false claim is measured against the recorded ground truth, never against
      // another fabricated value.
      conflictingSource: "ground truth",
      seats: new Set(recipients),
      // The event vocabulary has no retraction/withdrawn record, so a spoof cannot be
      // shown resolved from the log alone — OPEN unless the trail proves otherwise.
      resolvedAt: null,
      resolutionNote: null,
    });
  }
  return [...out.values()];
}

function spoofRecipients(events: RunEvent[], d: Record<string, any>, text: string): string[] {
  const seats = new Set<string>();
  if (typeof d.to === "string" && d.to && d.to !== "all") seats.add(String(d.to));
  for (const m of events) {
    if (m.type !== "message" && m.type !== "chat") continue;
    const md = m.data;
    if (md?.meta?.origin !== "spoof") continue;
    if (text && md.text !== text && md.payload?.text !== text) continue;
    if (typeof md.to === "string" && md.to && md.to !== "all") seats.add(String(md.to));
  }
  return [...seats];
}

// ---- link_down -------------------------------------------------------------

function linkDownDrafts(events: RunEvent[], viewsBySeat: Map<string, DegradedView[]>): Draft[] {
  const downs: { link: string; t: number; source: string }[] = [];
  const ups: { link: string; t: number }[] = [];
  for (const e of events) {
    if (e.type !== "link_change" && e.type !== "inject") continue;
    const d = e.data;
    if (!d || typeof d.link !== "string" || !d.link) continue;
    const patch = d.patch;
    if (!patch || typeof patch !== "object") continue;
    if (patch.active === false) {
      downs.push({
        link: String(d.link),
        t: e.t,
        source: e.type === "inject" ? `${e.actor} degradation inject` : `${e.actor} link_change`,
      });
    } else if (patch.active === true) {
      ups.push({ link: String(d.link), t: e.t });
    }
  }

  // View-side evidence: for a link, snapshot t counts as "restored" only when EVERY
  // seat that carries that link records active:true at t.
  const linkSeats = new Map<string, Set<string>>();
  const byLinkTime = new Map<string, Map<number, { have: number; active: number }>>();
  for (const [seat, views] of viewsBySeat) {
    for (const v of views) {
      for (const l of v.links ?? []) {
        let s = linkSeats.get(l.id);
        if (!s) linkSeats.set(l.id, (s = new Set()));
        s.add(seat);
        let byTime = byLinkTime.get(l.id);
        if (!byTime) byLinkTime.set(l.id, (byTime = new Map()));
        let c = byTime.get(v.t);
        if (!c) byTime.set(v.t, (c = { have: 0, active: 0 }));
        c.have += 1;
        if (l.active === true) c.active += 1;
      }
    }
  }
  const restores = new Map<string, number[]>();
  for (const [id, byTime] of byLinkTime) {
    const times: number[] = [];
    for (const [t, c] of byTime) if (c.have > 0 && c.active === c.have) times.push(t);
    restores.set(id, times.sort((a, b) => a - b));
  }

  const out = new Map<string, Draft>();
  const sorted = [...downs].sort((a, b) => a.t - b.t || (a.link < b.link ? -1 : a.link > b.link ? 1 : 0));
  for (const down of sorted) {
    const topic = `link:${down.link}`;
    const key = `link_down|${topic}`;
    const prev = out.get(key);
    if (prev) continue; // dedupe by (kind, topic): first downtime wins, resolution scanned below
    const detectedAt = down.t;
    let resolvedAt: number | null = null;
    let note: string | null = null;
    for (const u of ups) {
      if (u.link === down.link && u.t > detectedAt) {
        resolvedAt = u.t;
        note = `recorded link_change set active:true at t=${u.t}s`;
        break;
      }
    }
    for (const t of restores.get(down.link) ?? []) {
      if (t <= detectedAt) continue;
      if (resolvedAt !== null && t >= resolvedAt) break;
      resolvedAt = t;
      note = `every seat view shows the link active again at t=${t}s`;
    }
    out.set(key, {
      key,
      kind: "link_down",
      detectedAt,
      topic,
      claim: `${down.link} went inactive (patch.active=false)`,
      source: down.source,
      conflictingSource: "link baseline (active=true)",
      seats: new Set(linkSeats.get(down.link) ?? []),
      resolvedAt,
      resolutionNote: resolvedAt === null ? null : note,
    });
  }
  return [...out.values()];
}

// ---- hot arrays (stale / contradiction) ------------------------------------

interface FlagWindow {
  id: string;
  start: number;
  end: number;
  source: string;
  text: string;
  spoof: boolean;
}

interface HotHit {
  t: number;
  seat: string;
  view: DegradedView;
}

function flagWindows(events: RunEvent[]): FlagWindow[] {
  const wins: FlagWindow[] = [];
  for (const e of events) {
    if (e.type !== "inject") continue;
    const d = e.data;
    if (!d || (d.type !== "report" && d.type !== "event")) continue;
    const id = d.payload?.asset ?? d.payload?.unit;
    if (typeof id !== "string" || !id) continue;
    wins.push({
      id,
      start: e.t,
      end: e.t + HOT_WINDOW_S,
      source: `${e.actor} ${String(d.type)} inject`,
      text: typeof d.payload?.text === "string" ? d.payload.text : "",
      spoof: d.meta?.origin === "spoof",
    });
  }
  return wins;
}

function hotDrafts(
  events: RunEvent[],
  viewsBySeat: Map<string, DegradedView[]>,
  truthRows: TruthRow[],
): Draft[] {
  const windows = flagWindows(events);
  const hits = new Map<string, HotHit[]>();
  const unionTimes = new Set<number>();
  for (const [seat, views] of viewsBySeat) {
    for (const v of views) {
      unionTimes.add(v.t);
      for (const raw of v.hot ?? []) {
        const id = String(raw);
        let arr = hits.get(id);
        if (!arr) hits.set(id, (arr = []));
        arr.push({ t: v.t, seat, view: v });
      }
    }
  }
  const times = [...unionTimes].sort((a, b) => a - b);
  const out = new Map<string, Draft>();

  for (const id of [...hits.keys()].sort()) {
    const arr = (hits.get(id) ?? []).sort((a, b) => a.t - b.t || (a.seat < b.seat ? -1 : a.seat > b.seat ? 1 : 0));
    const present = new Set(arr.map((h) => h.t));

    // Contiguous presence runs over the merged snapshot timeline: each run is one
    // detection; resolution = first later snapshot where NO seat still carries the id.
    const runs: { start: number; end: number }[] = [];
    let openStart: number | null = null;
    let openEnd: number | null = null;
    for (const t of times) {
      if (present.has(t)) {
        if (openStart === null) openStart = t;
        openEnd = t;
      } else if (openStart !== null) {
        runs.push({ start: openStart, end: openEnd as number });
        openStart = null;
        openEnd = null;
      }
    }
    if (openStart !== null) runs.push({ start: openStart, end: openEnd as number });

    for (const run of runs) {
      const first = arr.find((h) => h.t === run.start);
      if (!first) continue;
      const entity =
        first.view.units.find((u) => u.id === id) ?? first.view.assets.find((a) => a.id === id);
      const pictureStale =
        !entity || entity.status === "unknown" || (entity.age_s ?? 0) >= 60;
      const kind: AuditKind = pictureStale ? "stale" : "contradiction";

      // Flagging inject whose 120s window covers this detection (latest start wins).
      const win = windows
        .filter((w) => w.id === id && w.start <= run.start && run.start <= w.end)
        .sort((a, b) => b.start - a.start)[0];

      const truthHit = pickTruth(truthRows, first.view.tick);
      const truthEntity = truthHit
        ? truthHit.row.truth.units.find((u) => u.id === id) ??
          truthHit.row.truth.assets.find((a) => a.id === id)
        : undefined;
      const conflictingSource = truthEntity
        ? `ground truth (status=${truthEntity.status})`
        : "ground truth";

      const claim = pictureStale
        ? `${win?.text ? `"${truncate(win.text, 120)}" flagged` : `hot flag`} on ${id} while the picture was stale` +
          (entity ? ` (status=${entity.status}, age_s=${entity.age_s}, confidence=${entity.confidence})` : ` (${id} absent from the picture)`)
        : win?.text
          ? `"${truncate(win.text, 120)}" flagged on seat pictures as ${id}`
          : `hot flag on ${id} (contested item on seat pictures)`;
      const source = win
        ? `${win.source}${win.spoof ? " (spoof)" : ""}`
        : `view snapshot (${first.seat})`;

      let resolvedAt: number | null = null;
      for (const t of times) {
        if (t > run.end && !present.has(t)) {
          resolvedAt = t;
          break;
        }
      }

      const key = `${kind}|${id}`; // dedupe by (kind, topic) — topic is the flagged id
      const draft: Draft = {
        key,
        kind,
        detectedAt: run.start,
        topic: id,
        claim,
        source,
        conflictingSource,
        seats: new Set(arr.filter((h) => h.t >= run.start && h.t <= run.end).map((h) => h.seat)),
        resolvedAt,
        resolutionNote: resolvedAt === null ? null : `flag cleared from every seat view at t=${resolvedAt}s`,
      };
      const prev = out.get(key);
      if (!prev) {
        out.set(key, draft);
        continue;
      }
      // Dedupe by (kind, topic) — merge affected seats, keep the earliest detection;
      // still-hot-at-end anywhere wins (OPEN).
      prev.detectedAt = Math.min(prev.detectedAt, draft.detectedAt);
      for (const s of draft.seats) prev.seats.add(s);
      if (prev.resolvedAt === null || draft.resolvedAt === null) {
        prev.resolvedAt = null;
        prev.resolutionNote = null;
      } else if (draft.resolvedAt > prev.resolvedAt) {
        prev.resolvedAt = draft.resolvedAt;
        prev.resolutionNote = draft.resolutionNote;
      }
    }
  }
  return [...out.values()];
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
