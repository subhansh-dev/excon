# Architecture

How excon fits together, and where each behaviour actually lives. Read this before touching the tick loop.

## The one rule

**The server is the only thing that knows the truth.** Seats never see world state — they see a per-seat projection derived from the deck's link tables, and that projection is pushed to them. Everything else (disagreement, deception, probes, AAR) falls out of that rule.

The same rule covers *identity*: a URL claiming `?view=cdr` proves nothing. EXCON mints signed join codes (`server/joincode.ts` — HMAC over room+seat), and under enforcement the server assigns the seat from the token, not the client. See [API.md](API.md#signed-seat-codes-server-assigned-seats).

```
scenarios/*.yaml ──► server/room.ts (authoritative tick loop)
                          │
                          ├─ shared/step.ts  ─ pure state transition, seeded rng
                          ├─ shared/degrad.ts ─ link/loss/latency degradation rules
                          ├─ deriveFeeds()    ─ per-seat projection (what each seat may see)
                          │
                          ├─► seat clients   (pushed `view` messages, never raw state)
                          ├─► event log      (runs/<id>/*.jsonl — source of truth)
                          └─► AAR/replay      (rebuilt from the log + the deck)
```

## Process topology

| Process | Role |
|---|---|
| Colyseus server (`server/index.ts`) | Owns rooms, REST API, run storage. `:2567` |
| Vite client (`client/`) | React app, five seat views + EXCON + AAR. `:5173` |
| Postgres (optional) | Queryable tables only. JSONL stays the replay source of truth. |

Without `DATABASE_URL` the store is JSONL-only and every feature still works.

## The tick loop (`server/room.ts`)

- Fixed-tick loop; `world.time_s` advances by `tick * timeScale`.
- EXCON can warp time (`time_set`), change scale (`time_scale`, 0.25–10×), or freeze (`freeze_set`).
- Each tick, in order: fire due injects → `shared/step.ts` transition → recompute links → derive per-seat views → push diffs.
- Same seed ⇒ bit-identical run. `shared/rng.ts` is seeded; `shared/*` modules contain no `Date.now()` or unseeded randomness. That is what makes replay tick-exact.

## Per-seat views (`deriveFeeds`)

Each deck declares nodes, links, and per-link degradation timelines (latency, integrity, loss, blackout windows). For every seat the room computes a feed table: which links exist from that seat's vantage, how laggy they are, which go dead at which tick.

- `comms` sees every link's true state — it's the only seat that does.
- `cdr` sees only what survived the push through those links.
- The asymmetry matrix in the AAR is computed by diffing these views against ground truth, entity by entity.

## Scenario decks (`scenarios/*.yaml`, schema in `shared/types.ts`)

Loaded and validated by `server/scenario.ts`; an invalid deck refuses to load rather than starting a broken room.

Top-level keys: `id`, `title`, `briefing`, `domains`, `duration_s`, `seed`, `deceptionObjective`, `seats`, `nodes`, `links`, `assets`, `injects`, `decisions`, `queries`, `groundTruth`, optional `geo`.

### Geo windows

Optional `geo: {name, origin{lat,lon}, span{lat,lon}}` maps the 200×200 grid onto real WGS-84 coordinates (origin = south-west corner, lat grows with y, lon with x). When present:

- the 2D map (`client/src/map/MapView.tsx`) switches from the synthetic CQRS plane to OpenStreetMap tiles with live lat/lon readouts;
- the ruler measures real kilometres (`client/src/map/geo.ts`);
- Cesium flies over the actual window with imagery instead of the grid.

Decks without `geo` are untouched — the classic synthetic plane remains the default. `thar-vigil` is the reference geo deck.

### Probes and scoring

`queries` are SAGAT-style probe questions fired at freeze windows. Answers are graded against `groundTruth` through the scorer table in `shared/queries.ts`, keyed by query-id prefix (`q*`/`h*`/`m*`/`t*` etc.). **A query id with no scorer throws at grade time** — if you add queries to a deck, add their scorer in the same commit.

## Metrics (`shared/metrics.ts`)

- **IIS** (Information Integrity Score) — how much of the real picture each seat actually had, over time.
- **OODA latency** — seconds from decision open to answer.
- **Calibration** — did confidence track accuracy.
- **CAST checks** — corroborated-then-accepted events.
- **Asymmetry** — per-entity, per-seat misrepresentation.

All computed from the run log + deck, never from live state, so the AAR cannot drift from what happened.

## Storage (`server/store.ts`)

- `runs/<runId>/events.jsonl` — every state change, decision, probe, inject, link patch, chat.
- `runs/<runId>/meta.json` — run header.
- `runs/<runId>/notes.txt` — EXCON debrief notes.
- Same data mirrored into Postgres tables when `DATABASE_URL` is set.

## Replay and AAR

- `server/replay.ts` (`buildReplay`) — entity history from the log; divergence is computed against the deck's `groundTruth`, not a hardcoded list.
- `server/aar.ts` — assembles the full AAR object (decisions, probes, IIS, CAST, asymmetry, narrative, calibration, scores).
- `server/counterfactual.ts` — re-scores the same run with failure modes patched out (`clean_links`, `suppress_spoof`).
- Client rendering: `client/src/views/AARView.tsx`; export: `client/src/views/aarExport.ts` (self-contained HTML dossier + print-to-PDF).

## Where NOT to put logic

- **Not in `shared/`**: anything touching wall-clock time, unseeded randomness, I/O. It breaks replay.
- **Not in the client**: any truth, scoring, or degradation decision. The client renders what it's told.
- **Not in `server/room.ts` directly**: pure computation belongs in `shared/` so smoke tests can run it without a room (see `server/smoke.ts`).
