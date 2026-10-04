# API

Two surfaces: a small REST API for run/scenario data, and the Colyseus WebSocket room that drives a live exercise. Everything is unauthenticated except the optional EXCON room password (`INSTRUCTOR_PASSWORD` env) — this is a lab tool, not a public service.

Base URL for examples: `http://localhost:2567`.

## REST

### `GET /api/health`

```json
{ "ok": true, "store": "jsonl", "time": "2026-10-04T…" }
```

### `GET /api/scenarios`

Lists every deck in `scenarios/` (also accepts uploads below):

```json
[{
  "id": "thar-vigil",
  "title": "Operation Desert Sentinel — …",
  "briefing": "…",
  "duration_s": 1800,
  "area": "Thar Sector — …",
  "decisions": 5, "queries": 15,
  "seats": ["cdr", "ops", "intel", "comms", "log"]
}]
```

`area` is `geo.name` when the deck declares a geo window, `""` otherwise.

### `POST /api/scenarios`

Registers a custom YAML deck. Body: `{ "yaml": "<file contents>", "filename": "my-deck.yaml" }`. The server validates it through the same loader as built-in decks — invalid YAML or schema is rejected with `400 { "error": "…" }`. On success the deck joins the directory listing and can be launched like any built-in.

### `GET /api/runs`

```json
[{ "runId": "reach-abc123", "scenarioId": "reach", "seed": 42, "startedAt": "…", "decisions": 5 }]
```

### `GET /api/analytics?limit=50`

Aggregated cross-run summaries (accuracy, calibration, probe scores, IIS averages) used by the run records panel. `limit` caps how many recent runs are folded in.

### `GET /api/runs/:id/aar`

The full after-action review object. Top-level keys: `header` (scenario, seed, runId, deceptionObjective), `decisions` (choice, rationale verbatim, confidence, correctness, OODA latency, per-decision context), `seats` (per-seat scores/accuracy), `probes` (SAGAT results), `calibration` (per-seat meanConf/accuracy/divergence/**brier**), `brier` (team-wide mean Brier, 0–1, lower is better), `tlx` (per-seat NASA-TLX workload averages, when ratings were submitted), `cast`, `iis` timeline, `asymmetry`, `flags`, `narrative`, `timeline`, `audit`. Same payload the AAR view renders and the HTML dossier exports.

### `GET /api/runs/:id/counterfactual?mode=clean_links`

Re-scores the run with a failure mode patched out. Modes:

| mode | Meaning |
|---|---|
| `clean_links` | As if the degraded links had stayed up |
| `suppress_spoof` | As if the adversary's spoofed feed had never fired |

Returns original vs counterfactual scores plus the per-decision delta. `400` on unknown mode.

### `GET /api/runs/:id/replay`

Tick-exact replay payload: entity history per tick plus deck ground truth, so divergence is computed against what was actually supposed to be true. `404 { "error": "…" }` if the run has no log.

### `GET /api/runs/:id/notes` · `POST /api/runs/:id/notes`

EXCON debrief notes stored as `notes.txt` inside the run directory.

```json
// GET → { "notes": "…" }
// POST body → { "notes": "…" }
// GET on missing file → { "notes": "" }
```

Anything else under `/api` falls through to the built client (`client/dist`) in production.

## WebSocket room

Room name: **`trainer`**. One room per run; joining creates it if absent.

### Join options

```js
client.joinOrCreate("trainer", {
  seat: "cdr" | "ops" | "intel" | "comms" | "log" | "instructor" | "demo",
  scenario: "reach",        // deck id; defaults to SCENARIO env or "reach"
  password: "…",            // only checked for seat === "instructor"
  demo: true,               // spawn in-process bots for empty seats
  joinToken: "…"            // signed seat code — server assigns the seat from it
});
```

### Signed seat codes (server-assigned seats)

`?view=` alone never proves anything — the URL can claim any seat. EXCON mints signed codes, and when enforcement is on, only those links get crew in:

1. EXCON clicks **ISSUE SEAT CODES** → server message `issue_codes` → replies `seat_codes` with one token per crew seat (deterministic: re-issue returns identical codes).
2. Share the links: `<origin>/?join=<token>`. The client parses the token only to learn the room; the **server verifies the HMAC** and assigns the embedded seat.
3. EXCON toggles **ENFORCE** → `code_enforce {on:true}`. From then on, a bare `joinOrCreate({seat})` with no token is rejected (`seat code required — ask EXCON for your join link`); instructor joins stay exempt (they use the room password).

Tokens are `base64url("<roomId>\n<seat>") + "." + HMAC-SHA256(secret)[0:32]`; the secret is `ROOM_PASSWORD` if set, else a per-process random. Tampering with any byte → `invalid seat code`. Wrong room → `seat code was issued for a different room`. State is echoed back in `hello` (`codeEnforce`, `issuedCodes`) so a refreshed EXCON tab restores its UI.

### Server → client messages

| Type | Payload (shape) | Notes |
|---|---|---|
| `hello` | `{ runId, seat, codeEnforce, issuedCodes, scenario: { …, geo }, briefing, objectives, nodes, links, decisions, … }` | Sent once on join. `seat` is what the **server** assigned. `scenario.geo` is the deck's geo window or `null`. |
| `view` | derived per-seat view: entities, feeds, links (with `age_s` AoI), IIS, journal | The **only** world state a seat receives. Pushed on every change. |
| `feed` | text line | Instructor's running activity feed. |
| `decision_open` | `{ decisionId, text, options, t, … }` | Decision window opened for a seat. |
| `decision_ack` | `{ decisionId, correct, confidence, ooda_latency_s, … }` | Grade + latency for the submitted answer. |
| `probe_result` | `{ freezeId, queryId, correct, truth, … }` | SAGAT probe grading. |
| `seat_codes` | `{ codes: [{ seat, token }], enforce }` | Response to `issue_codes` (EXCON only). |
| `code_enforce` | `{ on }` | Ack of the enforce toggle (EXCON only). |
| `tlx_prompt` | `{ t }` | EXCON requested NASA-TLX ratings — crew seats show the survey modal. |
| `report` | `{ from, to, text, t }` | Seat-to-seat / report traffic as delivered (post-degradation). |
| `truth` | ground-truth update | EXCON-only. |
| `wiretap` | intercepted traffic | EXCON-only. |
| `notice` | `{ t, text, from: "EXCON" }` | Broadcast notice. |

### Client → server messages

Permitted seats noted; others are ignored (`server/room.ts` `handleMessage`).

| Type | Payload | Seat |
|---|---|---|
| `decision` | `{ decisionId, choice, rationale, confidence }` | any crew seat |
| `chat` | `{ to, text }` (text ≤ 500 chars) | any |
| `probe_answer` | `{ freezeId, answers: [{ queryId, answer }] }` | any (during its freeze) |
| `sart` | free-form SART self-report, stored in the log | any |
| `tlx` | `{ mental, physical, temporal, performance, effort, frustration }` — each 0–100, logged and averaged into the AAR | any crew seat |
| `verify_request` | `{ to, text }` — sent as `VERIFY REQUEST: …` | any |
| `issue_codes` | `{}` → replies `seat_codes` | instructor |
| `code_enforce` | `{ on: boolean }` | instructor |
| `tlx_request` | `{}` — broadcasts `tlx_prompt` to all crew seats | instructor |
| `link_patch` | `{ link, patch }` — live degradation override | instructor, comms |
| `inject_now` | `{ index }` — fire a deck inject immediately | instructor |
| `freeze_set` | `{ freeze: boolean }` | instructor |
| `time_set` | `{ t }` — warp to `t` seconds (clamped to deck duration) | instructor |
| `time_scale` | `{ scale }` — 0.25–10 | instructor |
| `notice` | `{ text }` (≤ 300 chars), broadcast to all | instructor |

## Error behaviour

- Unknown deck id → join fails (server never starts a room on an invalid deck).
- Decision answered with no open window / unknown `decisionId` → silently ignored.
- `probe_answer` with a stale `freezeId` → ignored (the freeze already closed).
- Query ids without a scorer in `shared/queries.ts` → **throw at grade time**; add the scorer with the deck.
- REST run endpoints → `404 { "error": "…" }` for unknown run ids.
