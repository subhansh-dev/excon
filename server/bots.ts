// Scripted demo seats — 1-click jury run. Bots act through the same server
// paths as humans (sendChatAs / recordDecision / gradeProbe), so everything they
// do is logged, scored and shows up in the AAR exactly like trainee traffic.
// A bot never touches a seat a human has joined (see room.isBotSeat).
import type { InjectDef } from "../shared/types.js";

export interface BotAction {
  t: number; // scenario seconds
  seat: string;
  kind: "chat" | "decision" | "verify";
  to?: string;
  text?: string;
  decisionId?: string;
  choice?: string;
  rationale?: string;
  confidence?: number;
}

export const DEMO_SEATS = ["cdr", "ops", "intel", "log"];

/** Fully autonomous Exercise Reach run — ends with a complete, scored AAR. */
export const DEMO_SCRIPT: BotAction[] = [
  { t: 10, seat: "intel", kind: "chat", text: "ISR drone on station. Scanning northern sector, no activity yet." },
  { t: 60, seat: "ops", kind: "chat", text: "Convoy Alpha rolling. ETA checkpoint two 12 min." },
  { t: 200, seat: "log", kind: "chat", to: "cdr", text: "Fuel state 44%. Recommend resupply before any push." },
  { t: 310, seat: "intel", kind: "verify", to: "cdr", text: "Bridge-7 OPEN report conflicts with engineer assessment" },
  { t: 335, seat: "cdr", kind: "decision", decisionId: "d1", choice: "Bridge-3", rationale: "Engineer assessment plus intel conflict — Bridge-7 cannot be trusted.", confidence: 0.8 },
  { t: 500, seat: "cdr", kind: "chat", text: "All callsigns, suspected EW activity on HQ net. Keep messages short." },
  { t: 705, seat: "log", kind: "decision", decisionId: "d2", choice: "Request resupply", rationale: "44% fuel cannot reach depot under jamming delays.", confidence: 0.75 },
  { t: 955, seat: "ops", kind: "decision", decisionId: "d3", choice: "Wait for restore", rationale: "Moving blind during blackout risks ambush on the approach.", confidence: 0.7 },
  { t: 1005, seat: "intel", kind: "chat", text: "HQ net degraded. Intel switching to drone feed only." },
  { t: 1305, seat: "intel", kind: "decision", decisionId: "d4", choice: "Verify via alternate net", rationale: "HQ claim arrived over a degraded link with spoof markers.", confidence: 0.85 },
  { t: 1400, seat: "ops", kind: "chat", to: "cdr", text: "Bravo holding. No contact." },
];

export function isReportInject(inj: InjectDef): boolean {
  return inj.type === "report" && typeof inj.payload?.text === "string";
}
