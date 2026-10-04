// Scenario loader — YAML deck in, validated ScenarioDef out.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import YAML from "yaml";
import type { GroundTruth, ScenarioDef } from "../shared/types.js";

const DIR = resolve("scenarios");

export function listScenarios(): string[] {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  return readdirSync(DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
}

export function validateScenario(sc: ScenarioDef, id: string): ScenarioDef {
  if (!sc.id || !sc.nodes?.length || !sc.links?.length) {
    throw new Error(`scenario ${id}: missing id/nodes/links`);
  }
  const nodeIds = new Set(sc.nodes.map((n) => n.id));
  for (const l of sc.links) {
    if (!nodeIds.has(l.from) || !nodeIds.has(l.to)) {
      throw new Error(`scenario ${id}: link ${l.id} references unknown node`);
    }
  }
  sc.injects = sc.injects || [];
  sc.decisions = sc.decisions || [];
  sc.queries = sc.queries || [];
  sc.injects.sort((a, b) => a.t - b.t);
  sc.decisions.sort((a, b) => a.t - b.t);
  return sc;
}

export function loadScenario(id: string): ScenarioDef {
  const file = resolve(DIR, `${id}.yaml`);
  let alt = file;
  try {
    readFileSync(file);
  } catch {
    alt = resolve(DIR, `${id}.yml`);
  }
  const raw = readFileSync(alt, "utf8");
  const sc = YAML.parse(raw) as ScenarioDef;
  return validateScenario(sc, id);
}

export function saveScenario(rawYaml: string): ScenarioDef {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  const sc = YAML.parse(rawYaml) as ScenarioDef;
  if (!sc || !sc.id) {
    throw new Error("Invalid scenario YAML: 'id' field is required.");
  }
  const validated = validateScenario(sc, sc.id);
  const targetFile = resolve(DIR, `${sc.id}.yaml`);
  writeFileSync(targetFile, rawYaml, "utf8");
  return validated;
}

// ---------------------------------------------------------------------------
// Run-reporting helpers — the deck a recorded run came from, addressed the way a
// run records it (by scenario `id`, which need not match the file it lives in).
// ---------------------------------------------------------------------------

/** Deck by file name first ("reach"), then by scanning for a deck whose id matches. */
function loadDeck(scenarioId: string): ScenarioDef | null {
  try {
    return loadScenario(scenarioId);
  } catch {
    // runs store `scenario.id` — fall through and look for the deck that owns it
  }
  for (const f of listScenarios()) {
    const short = f.replace(/\.ya?ml$/, "");
    if (short === scenarioId) continue;
    try {
      const sc = loadScenario(short);
      if (sc.id === scenarioId) return sc;
    } catch {
      // unreadable deck — keep scanning
    }
  }
  return null;
}

/** Node labels for a deck (id -> label). Missing deck → empty map, ids are the fallback. */
export function labelMap(scenarioId: string): Map<string, string> {
  const labels = new Map<string, string>();
  const deck = loadDeck(scenarioId);
  for (const n of deck?.nodes ?? []) labels.set(n.id, n.label ?? n.id);
  return labels;
}

/** The deck's own ground truth — present even for runs whose truth log is empty. */
export function deckTruth(scenarioId: string): GroundTruth | null {
  return loadDeck(scenarioId)?.groundTruth ?? null;
}

export interface EntityRef {
  id: string;
  label: string;
  kind: "unit" | "asset";
}

/** Display label for an id the deck has no name for: `bridge-7` -> `Bridge-7`. */
function humanize(id: string): string {
  const out = id
    .split(/([_-]+)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/^\w/, (c) => c.toUpperCase())))
    .join("");
  return out.trim() || id;
}

/**
 * Universe of entities an AAR/replay compares seat pictures against: the deck's
 * ground truth plus every id the run actually recorded (first-seen order, units
 * then assets). Hidden OPFOR is excluded — it is deliberately absent from seat
 * pictures, so scoring it would report a failure the seats could never fix.
 */
export function entityList(
  rows: (GroundTruth | { truth?: GroundTruth } | null | undefined)[],
  labels: Map<string, string>,
): EntityRef[] {
  const out: EntityRef[] = [];
  const seen = new Set<string>();
  const add = (id: string, kind: "unit" | "asset", side?: string) => {
    if (!id || seen.has(id) || side === "opfor") return;
    seen.add(id);
    out.push({ id, label: labels.get(id) ?? humanize(id), kind });
  };
  for (const row of rows) {
    if (!row) continue;
    const truth: GroundTruth | undefined = "units" in row ? row : row.truth;
    if (!truth) continue;
    for (const u of truth.units ?? []) add(u.id, "unit", u.side);
    for (const a of truth.assets ?? []) add(a.id, "asset");
  }
  return out;
}
