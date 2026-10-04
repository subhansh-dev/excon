// Shared domain types — server, replay tooling, AAR. No dependencies.
// NOTE: relative imports inside shared/ and server/ use explicit `.js` suffixes
// (required for NodeNext prod builds; tsx + Vite both resolve them).

export type Domain = "land" | "air" | "cyber" | "ew";
export type Role = "cdr" | "ops" | "intel" | "comms" | "log" | "opfor" | "instructor";
export type DegradMode = "latency" | "dropout" | "partial" | "contradiction" | "spoof";

export interface LinkProfile {
  latency_ms: number;
  jitter_ms: number;
  loss_pct: number;
  bandwidth_kbps: number;
  integrity: number; // probability content is NOT corrupted
  spoof_pct: number;
  active: boolean;
}

export interface LinkDef {
  id: string;
  from: string;
  to: string;
  domains: Domain[];
  base: LinkProfile;
  timeline: { t: number; patch: Partial<LinkProfile> }[];
}

export interface NodeDef {
  id: string;
  kind: "seat" | "unit" | "sensor" | "hq";
  role?: string;
  label: string;
}

export interface UnitState {
  id: string;
  side: "blue" | "opfor" | "civ";
  type: string;
  x: number;
  y: number;
  strength: number;
  status: string;
  sidc?: string;
  wp?: number[][];
  speed?: number; // map-units per sim-second
}

export interface AssetState {
  id: string;
  kind: string;
  status: string;
  x?: number;
  y?: number;
}

export interface GroundEvent {
  id: string;
  t: number;
  kind: string;
  x: number;
  y: number;
  severity: number;
  text?: string;
}

export interface GroundTruth {
  units: UnitState[];
  assets: AssetState[];
  events: GroundEvent[];
  supplies: Record<string, number>;
}

export interface InjectDef {
  t: number;
  type: "report" | "link_change" | "event" | "glitch";
  provider?: "canned" | "llm"; // stamped at fire time; recorded in the run trail
  from?: string;
  to?: string;
  link?: string;
  payload?: any;
  meta?: any;
  patch?: Partial<LinkProfile>;
  kind?: string;
  x?: number;
  y?: number;
  severity?: number;
}

export type RiskLevel = "low" | "med" | "high";

export interface DecisionPointDef {
  id: string;
  t: number;
  prompt: string;
  options: string[];
  /** Parallel to `options` — trains the seat to price risk before acting. */
  risk?: RiskLevel[];
  optimal: string;
  alternatives?: string[];
  seats?: string[];
}

/** Public decision shape — optimal answer never leaves the server. */
export interface PublicDecision {
  id: string;
  t: number;
  prompt: string;
  options: string[];
  risk?: RiskLevel[];
  seats: string[];
}

export interface QueryDef {
  id: string;
  level: 1 | 2 | 3;
  text: string;
  options: string[];
}

export interface ScenarioDef {
  id: string;
  title: string;
  deceptionObjective?: string;
  briefing?: string;
  objectives?: string[];
  domains: Domain[];
  duration_s: number;
  tick_ms: number;
  seed: number;
  nodes: NodeDef[];
  links: LinkDef[];
  obstacles?: ObstacleDef[];
  groundTruth: GroundTruth;
  injects: InjectDef[];
  decisions: DecisionPointDef[];
  queries: QueryDef[];
}

export interface ObstacleDef {
  id: string;
  kind: string; // hills | water | urban | minefield
  x1: number; y1: number; x2: number; y2: number;
  label?: string;
}

// ---- runtime wire types ----

export interface ViewUnit {
  id: string;
  side: string;
  type: string;
  x: number;
  y: number;
  status: string;
  sidc?: string;
  confidence: number; // 0..1 claimed
  age_s: number;
}

export interface ViewAsset {
  id: string;
  kind: string;
  status: string;
  x?: number;
  y?: number;
  confidence: number;
  age_s: number;
}

export interface DegradedView {
  seat: string;
  tick: number;
  t: number;
  units: ViewUnit[];
  assets: ViewAsset[];
  supplies: Record<string, number | string>;
  iis: number;
  links?: { id: string; latency_ms: number; loss_pct: number; integrity: number; active: boolean }[];
  nextDecision?: PublicDecision & { openTick: number };
  hot?: string[]; // unit ids flagged by recent contradiction/spoof injects
  timeScale?: number;
  probe?: { queryIds: string[]; freezeId: string };
  phase: string;
}

export interface WireMessage {
  id: string;
  from: string;
  to: string;
  kind: "report" | "order" | "query" | "alert" | "decision_open";
  text: string;
  payload?: any;
  t_sent: number;
  t_recv: number;
  meta: {
    source: string;
    confidence: number;
    integrity: number;
    age_s: number;
    origin: "truth" | "spoof";
  };
  degradedBy: DegradMode[];
}

export interface DecisionRecord {
  id: string;
  seat: string;
  t: number;
  decisionId: string;
  choice: string;
  rationale: string;
  confidence: number;
  ooda_latency_s: number;
  correct: boolean;
  context?: DecisionContext; // frozen evidence the seat decided on (hindsight-safe)
}

export interface DecisionContext {
  iis: number;
  viewTick: number;
  heard: { t: number; from: string; text: string }[];
  links: { id: string; integrity: number; active: boolean }[];
}

export interface ProbeAnswer {
  freezeId: string;
  seat: string;
  t: number;
  answers: { queryId: string; answer: string }[];
}
