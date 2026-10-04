// G1 gate — full loop: cdr joins + gets views, instructor warps time to d1,
// cdr receives decision_open, answers, gets ack. Needs server running.
// `npm run smoke:join`
import { Client } from "@colyseus/sdk";

const URL = process.env.SERVER_URL || "ws://localhost:2567";
const TIMEOUT_MS = 45000;

const fail = (msg: string): never => {
  console.error(`FAIL  ${msg}`);
  process.exit(1);
};
const timer = setTimeout(() => fail("timed out"), TIMEOUT_MS);

const client = new Client(URL);
const cdr = await client.joinOrCreate("trainer", { seat: "cdr", scenario: "reach" });
console.log(`cdr joined ${cdr.roomId}`);

let views = 0;
let warped = false;

cdr.onMessage("hello", (m: any) => console.log(`hello run=${m.runId} scenario=${m.scenario.id}`));
cdr.onMessage("view", (v: any) => {
  views += 1;
  if (views === 1) console.log(`first view: tick=${v.tick} units=${v.units.length} iis=${v.iis}`);
  if (views >= 3 && !warped) {
    warped = true;
    console.log("views flowing — warping to d1 via instructor seat");
    void warpAndAnswer();
  }
});
cdr.onMessage("decision_open", (d: any) => {
  console.log(`decision open: ${d.payload.id} — ${d.text}`);
  cdr.send("decision", { decisionId: d.payload.id, choice: d.payload.options[1], rationale: "smoke test", confidence: 0.7 });
});
cdr.onMessage("decision_ack", (d: any) => {
  console.log(`decision ack: ${d.choice} correct=${d.correct} ooda=${d.ooda_latency_s}s`);
  clearTimeout(timer);
  console.log("PASS  join + views + time-warp + decision round-trip");
  cdr.leave(true).then(() => process.exit(0));
});

async function warpAndAnswer() {
  const excon = await client.joinOrCreate("trainer", { seat: "instructor", scenario: "reach" });
  // NOTE: joinOrCreate may attach to the same room (expected) — warp it to d1 @t=330.
  excon.send("time_set", { t: 335 });
  setTimeout(() => excon.leave(true), 15000);
}
