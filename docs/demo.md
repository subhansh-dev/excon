# Judge demo — 3 minute script

Rehearse this once before the table walks up. Every click below is real; nothing here is a
recording or a mock screen.

## Prep (2 minutes before, judges not at the table yet)

```bash
cd dssc-trainer
npm run dev
```

Open `http://localhost:5173/`. Check the top-right corner reads **SIM SERVER: ONLINE** — if it
says DISCONNECTED, the server didn't start: rerun `npm run dev` and wait for `server :2567`.

Leave the landing page open. Keep a second empty tab ready for the AAR.

**If the demo tab ever says** `room already running - close all tabs (room resets)` — close every
seat/excon tab and reopen the demo with `&demo=1` for a clean run.

---

## 0:00 — The pitch (landing page)

Point at the screen, say:

> "Every simulator we looked at trains tactics and hopes the network holds. This one trains the
> decision when it doesn't — one authoritative simulation, five seats, each shown a deliberately
> broken version of the truth, and an after-action review that shows the exact second each seat's
> picture diverged from reality."

Click nothing yet. The hero + the six seat cards are the whole product in one glance.

## 0:15 — One click, exercise starts

Click **1-CLICK JURY DEMO** (hero, gold button). A new tab opens the EXCON console running
Operation Reach with scripted staff (cdr, ops, intel, log) acting for you.

Immediately click **×10** in the TIME SCALE panel (right column). The scripted exercise is
authored at real speed (~23 min); ×10 runs it in ~2.5 min.

Point at the live feed:

> "Scripted staff seats are already talking, filing verify requests and making decisions — through
> the same server paths a human uses, so it all gets scored."

## 0:45 — Take the commander's chair

Open a second tab: `http://localhost:5173/?view=cdr`. You are now Commander — the script skips any
seat a human occupies, so you override the bot.

## 1:00 — The decision under degraded information

Back in the EXCON tab: type `300` into **SCENARIO TIME (EXCON WARP)** and click **WARP**. At t=330
the first decision opens in your CDR tab.

- Before answering, point at the CDR inbox: intel filed a **verify request** — the Bridge-7 report
  conflicts with the engineer assessment. That conflict is the whole exercise.
- Answer the decision: pick a route, type a **rationale**, set the **confidence** slider, submit.
- You get an ack with correctness + OODA latency, and a **SAGAT probe** may freeze the room for
  questions. (The script also auto-fires two probe freezes per run around t≈500–800 and
  t≈1000–1400 — scripted seats answer those instantly.)

> "Rationale is captured at the moment of decision, not in a post-run interview."

## 1:35 — Break the network, on purpose, with a preview

In the EXCON tab, **LINK CONTROL (LIVE DEGRADATION)**:

1. Pick a link (e.g. `cdr-hq`), pick a mode, set magnitude.
2. Click **PREVIEW IMPACT** — the dry-run panel shows added seconds, delivery state, risk and
   which appointments are affected. Nothing has happened yet.
3. Click **COMMIT**. Watch the seat's link telemetry change.

Faster version: the **ONE-TAP DISRUPTION** row (`+LATENCY`, `60% DROPOUT`, …) applies in one
click, and **ACTIVE DISRUPTIONS** has a per-inject RESTORE.

## 2:05 — Talk to every seat at once

**SEAT BROADCAST (EXCON ADJUTANT)**: type `HOLD AT CHECKPOINT DELTA`, click **BROADCAST**. It lands
in every seat's inbox instantly.

Then click **FREEZE ALL** — the sim stops while you talk. **UNFREEZE** to resume.

## 2:30 — The after-action review

Click the **AAR** button in the EXCON toolbar (opens `?view=aar&run=…`). Walk down the report:

- decision table — choice, correctness, OODA latency, and the rationale **verbatim**
- SAGAT probe scores and CAST checks
- IIS curves — how much of the real picture each seat actually had, per tick
- asymmetry matrix — which entity was misrepresented, on whose screen
- **COUNTERFACTUAL** panel — flip to ZERO SPOOFS / CLEAN LINKS and read the delta:

> "Same recorded run, failure modes patched out — here's what the decision would have cost
> without the electronic warfare."

## 3:00 — Close

Two optional doors, only if a judge asks:

- **Replay** (`?view=replay&run=…`): tick-exact scrub of truth vs seat views.
- **Analytics** (`?view=analytics`): fleet stats across every past run.

Close with:

> "Every existing simulator assumes the network holds. We train the decision when it doesn't —
> and we measure how badly it broke."

---

## If something breaks mid-demo

| Symptom | Fix |
|---|---|
| Landing shows SIM SERVER: DISCONNECTED | server died — rerun `npm run dev` |
| Demo tab: "room already running" | close all seat/excon tabs, reopen with `&demo=1` |
| No decision in CDR tab | you warped past its trigger — check WARP target is 300, not 3300 |
| Demo feels slow | TIME SCALE ×10 was missed — click it now |
| Port 2567 already in use | an old server is squatting the port: stop it, rerun `npm run dev` |
