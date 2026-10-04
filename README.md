# excon

A decision trainer for the moment the radio starts lying to you. Five seats, one shared situation, and every seat sees a slightly different — sometimes completely wrong — version of it.

Built for SIH 2026 (problem statement SIH26248). The interesting part isn't the 3D map or the NATO symbols on it. It's that after the exercise you can scrub back to the exact tick where the team's shared picture fell apart, and see whose screen was showing what at the time.

## Running it

```bash
npm install
npm run dev
```

Client on `:5173`, server on `:2567`. No database needed — without `DATABASE_URL` the server writes JSONL files and everything works anyway. Postgres is optional and only adds queryable tables; the JSONL files stay the source of truth for replays.

Open each seat in its own tab, that's the whole trick:

- `http://localhost:5173/?view=cdr` — commander
- `http://localhost:5173/?view=ops` / `intel` / `comms` / `log`
- `http://localhost:5173/?view=instructor` — the console driving the exercise
- `http://localhost:5173/?view=aar&run=<runId>` — after-action review

## The seats

| Seat | What they're responsible for |
|---|---|
| `cdr` | Decides. Route the convoy, commit the surveillance team, launch the MEDEVAC. Takes the blame. |
| `ops` | Owns the operational picture and the convoy's fuel state. |
| `intel` | ISR and HUMINT feeds. Has to say which one to trust when they disagree. |
| `comms` | The only seat that sees every link — latency, who dropped, who's still up. |
| `log` | Fuel, spares, confirmations. The seat everyone forgets until the helicopters won't start. |
| `instructor` | Warps time, freezes the room, drops injects and notices onto individual seats. |
| `demo` | No humans required. Runs the scenario end to end so you can watch the AAR fill up. |

Each seat gets its own feed table derived from the scenario deck: which links exist, how laggy they are, which ones go dead at what tick. The commander never sees the raw truth, they see what `comms` managed to push them.

## Scenario decks

Four live in `scenarios/`, all YAML:

- **reach** — flood relief convoy, two bridges, one of them closed, EW blackout incoming. A plausible-looking ISR contradiction has to be resolved by source evaluation rather than by whoever sounds more confident.
- **medevac-jam** — casualties waiting on a helicopter while an EW cell works the area. Fuel gets confirmed early or it doesn't get confirmed at all.
- **hvt-watch** — a high-value target, two same-priority feeds, one of which is being managed by the adversary. Whichever feed the commander leans on is the one that gets to shape reality.
- **thar-vigil** — real-world anchored. The deck's `geo:` header maps the 200×200 grid onto the Jaisalmer–Pokhran training area in the Thar (origin 26.45°N 70.60°E, 0.55°×1.45° window): the 2D map draws OpenStreetMap terrain with live lat/lon under the cursor, the ruler measures real kilometres, and key entities sit on their actual coordinates — Jal airfield lands on 26.92°N 70.91°E, the LRP on Pokhran, the border post west of the line. Decks without `geo:` keep the classic synthetic grid.

Each deck carries a `deceptionObjective`, so the exercise can be scored against what the adversary was actually trying to accomplish, not just against a checklist.

## What happens during a run

The instructor picks a deck and a seed, opens the room, then jumps time to each decision window instead of waiting it out. At every window a decision opens with context pulled from the seat's own (possibly degraded) view, the seat answers with a rationale and a confidence, and the ack comes back with whether it was right and how many seconds of OODA latency it took.

Alongside decisions: SAGAT-style probe questions fired mid-run, injects (with optional LLM-written variants if you set `LLM_API_KEY`), link degradation, and a freeze button that stops the sim cold while people talk.

## The after-action review

The AAR is the payload. One request gets you:

- the full timeline and every decision with context, confidence, correctness, and OODA latency
- SAGAT probe results and CAST checks
- information availability (IIS) over time — how much of the real picture each seat actually had
- an asymmetry matrix: which entity was misrepresented, on whose screen, and by how much (ships in the JSON payload and the HTML dossier — no AAR widget yet, see limitations)
- seat-by-seat scoring, calibration (did confidence track accuracy), and written narrative
- a counterfactual mode that re-scores the run with certain failure modes patched out — the kind of thing you can't get from watching a recording
- a replay payload with entity history, so divergence from truth is computed from the actual deck rather than a hardcoded list

Replay is tick-exact. Same seed, same config, bit for bit — that's a smoke-tested guarantee with `LLM_API_KEY` unset. If you enable LLM inject variants, only the inject *prose* differs between runs; the world still ticks identically.

## Requirements checklist (PS 26248)

Mapped straight off the problem statement's expected outcomes, so nobody has to take our word for it:

| # | Required | Where it lives | Status |
|---|---|---|---|
| R1 | Scenario engine, engine owns time | YAML decks in `scenarios/`, fixed-tick Colyseus loop (`server/room.ts`), EXCON warp / time-scale controls | Done |
| R2 | Degradation injectable *mid-exercise* | `LINK CONTROL` live patches, one-tap disruption row, deck timelines that fire while the sim runs | Done |
| R3 | Multiplayer, ≥4 seats, each with a different distorted view | 5 crew seats; per-seat feed tables derived from the deck in `deriveFeeds` (`server/room.ts`) | Done |
| R4 | Instructor dashboard: configure + watch decisions live | EXCON console: injects with preview, freeze, broadcasts, live decision feed, per-seat IIS | Done |
| R5 | Exportable AAR with individual + team timelines and rationale | `?view=aar&run=<id>`: decision table with the rationale verbatim, dual timelines; JSON via `/api/runs/<id>/aar` | Done |
| R6 | Web-based | Vite + React client, nothing for a trainee to install | Done |
| R7 | Multi-domain (land / air / cyber / EW) | every deck declares `domains: [land, air, cyber, ew]`, and they're coupled — EW hits the links, links hit the decisions | Done |
| R8 | A metric that shows decision quality under degradation | decision accuracy, OODA latency, Information Integrity Score, confidence-vs-accuracy calibration, SAGAT/CAST scores | Done |

## How it's built

- `server/` — Colyseus room holding the authoritative simulation. It's the only thing that knows the truth. Seat views are derived per seat and pushed; nobody negotiates the state over the wire.
- `shared/` — the step function, degradation rules, metrics, and scorers. No `Date.now()`, no unseeded randomness (`seedrandom`). This is what makes a run replayable.
- `client/` — Vite + React 18, Leaflet for the 2D map, Cesium for the 3D one, `milsymbol` for the NATO symbols, Barlow/IBM Plex for the type.
- `scenarios/` — the decks. Drop a new YAML in there and it loads.
- `runs/` — per-run JSONL logs (gitignored). These are the replay source of truth.

Deeper cuts: [docs/architecture.md](docs/architecture.md) (tick loop, per-seat views, geo windows, where logic is allowed to live) and [docs/API.md](docs/API.md) (REST endpoints + WebSocket protocol).

## Checks

| Command | What it proves |
|---|---|
| `npm run smoke` | Same seed twice → bit-identical runs; different seed → different runs; degraded link shows up in IIS |
| `npm run smoke:join` | Join a room, receive views, warp time, answer a decision (needs a running server) |
| `npm run typecheck` | `tsc --noEmit` across client and server |
| `npm run build` | Production client build |

For the 3-minute judge walkthrough, see [docs/demo.md](docs/demo.md). Design and protocol reference: [docs/architecture.md](docs/architecture.md), [docs/API.md](docs/API.md).

## Production

```bash
docker compose up -d db
cp .env.example .env        # set DATABASE_URL
npm run db:migrate
npm run dev
```

Or `docker build -t excon .` if you'd rather ship it as an image.

## Known limitations

Being straight about these: run status in `meta.json` never flips off `running` (nothing consumes it, so nothing sets it), the AAR ships entity and asymmetry tables in its JSON that the UI doesn't render as their own widgets yet, there's no authentication beyond an optional room password, and the LLM-written inject variants need your own `LLM_API_KEY` — without it you get the canned text, which is honestly fine for most runs.

## Credits

Made by **Subhansh** ([@subhansh-dev](https://github.com/subhansh-dev)) for SIH 2026, problem statement SIH26248.
