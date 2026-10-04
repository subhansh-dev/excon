// One-off demo verification: instructor+demo join, warp past everything, check AAR.
import { Client } from "@colyseus/sdk";

async function main() {
  const client = new Client("ws://localhost:2567");
  const room = await client.joinOrCreate("trainer", { seat: "instructor", scenario: "reach", demo: true });
  let runId = "";
  room.onMessage("hello", (m: any) => { runId = m.runId; console.log(`demo run=${runId}`); });
  await new Promise((r) => setTimeout(r, 3000));
  room.send("time_set", { t: 1500 });
  await new Promise((r) => setTimeout(r, 25000));
  const aar = await fetch(`http://localhost:2567/api/runs/${runId}/aar`).then((r) => r.json());
  console.log("decisions:", aar.decisions.length, aar.decisions.map((d: any) => `${d.decisionId}=${d.choice}${d.correct ? "Y" : "N"}`).join(" "));
  console.log("context on d1:", JSON.stringify(aar.decisions[0]?.context ?? null).slice(0, 160));
  console.log("probes:", aar.probes.length, "| cast:", aar.cast.length, "| asymmetry:", JSON.stringify(aar.asymmetry));
  console.log("discipline:", JSON.stringify(aar.discipline));
  console.log("injects:", (aar.injects ?? []).length, "| flags:", aar.flags.length);
  await room.leave(true);
  const ok = aar.decisions.length === 4 && aar.probes.length >= 2;
  console.log(ok ? "PASS demo run complete" : "FAIL demo run incomplete");
  process.exit(ok ? 0 : 1);
}

void main();
