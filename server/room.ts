// The authoritative room. One scenario, one run, fixed 4Hz tick.
// Seats receive ONLY their degraded view + their messages (D10) — ground truth
// never leaves the server except to the instructor console.
import { Room, Client } from "@colyseus/core";
import { schema, t } from "@colyseus/schema";
import type {
  ScenarioDef, WireMessage, DegradedView, DecisionPointDef, LinkProfile,
} from "../shared/types.js";
import { initWorld, stepWorld, projectView, type SimWorld } from "../shared/step.js";
import { makeRng, type Rng } from "../shared/rng.js";
import { routeMessage, CLEAN_LINK } from "../shared/degrad.js";
import { computeIIS, oodaLatency } from "../shared/metrics.js";
import { loadScenario } from "./scenario.js";
import { CannedProvider, LlmVariantProvider, type InjectProvider } from "./injects.js";
import { DEMO_SEATS, DEMO_SCRIPT } from "./bots.js";
import { openStore, type RunStore, type RunEvent } from "./store.js";
import { scoreAnswer, type JournalEntry } from "../shared/queries.js";

const SeatMeta = schema({ role: t.string(), connected: t.boolean() }, "SeatMeta");
const SessionState = schema(
  {
    tick: t.number(),
    phase: t.string(), // lobby | running | frozen | done
    freeze: t.boolean(),
    timeScale: t.number(),
    seats: t.map(SeatMeta),
  },
  "SessionState",
);
type Session = InstanceType<typeof SessionState>;

// Which comms links govern each seat's feeds (worst-integrity governs).
// Derived from the deck so a new scenario needs no table edit: a link feeds both
// endpoint seats. The comms appointment's node (e.g. `sigs`) carries no links of
// its own in every deck — it watches the whole net, so it gets all of them.
function deriveFeeds(scenario: ScenarioDef): Record<string, string[]> {
  const feeds: Record<string, string[]> = {};
  for (const node of scenario.nodes) {
    if (node.kind !== "seat") continue;
    const key = node.role ?? node.id;
    if (feeds[key]) continue; // two nodes sharing a role: first one wins
    feeds[key] =
      key === "comms"
        ? scenario.links.map((l) => l.id)
        : scenario.links.filter((l) => l.from === node.id || l.to === node.id).map((l) => l.id);
  }
  return feeds;
}

interface PendingDelivery {
  deliverAt: number;
  seatId: string;
  msg: WireMessage;
}
interface OpenDecision {
  def: DecisionPointDef;
  openedAt: number;
  answered: Set<string>;
}

let msgCounter = 0;
const nextMsgId = () => `m${Date.now().toString(36)}-${(msgCounter += 1)}`;

/** Public decision shape — optimal answer and alternatives NEVER leave the server. */
export function publicDecision(d: DecisionPointDef) {
  return { id: d.id, t: d.t, prompt: d.prompt, options: d.options, risk: d.risk ?? [], seats: d.seats ?? [] };
}

export class TrainerRoom extends Room<{ state: Session }> {
  private scenario!: ScenarioDef;
  private feeds: Record<string, string[]> = {};
  private world!: SimWorld;
  private rng!: Rng;
  private store!: RunStore;
  private runId!: string;
  private clients_by_seat = new Map<string, Client>();
  private queue: PendingDelivery[] = [];
  private manualLinks: Record<string, { since: number; patch: Partial<LinkProfile> }> = {};
  private openDecisions = new Map<string, OpenDecision>(); // decisionId -> open
  private journals = new Map<string, JournalEntry[]>(); // seat -> received reports
  private lastViews = new Map<string, DegradedView>();
  private provider!: InjectProvider;
  private demoBots = false;
  private botCursor = 0;
  private timeScale = 1;
  private hot = new Map<string, number>(); // unit/asset id -> sim-time until flagged
  private freezeInfo: { id: string; queryIds: string[]; untilWall: number; answered: Set<string> } | null = null;
  private freezeCount = 0;
  private freezeAt: number[] = [];
  /** Instructor hold — separate from a SAGAT probe so releasing one keeps the other. */
  private manualFreeze = false;

  async onCreate(options: any) {
    const scenarioId = options.scenario || process.env.SCENARIO || "reach";
    this.scenario = loadScenario(scenarioId);
    this.feeds = deriveFeeds(this.scenario);
    this.world = initWorld(this.scenario);
    this.rng = makeRng(this.scenario.seed);
    this.store = await openStore();
    this.runId = await this.store.createRun({
      scenarioId: this.scenario.id,
      seed: this.scenario.seed,
      deceptionObjective: this.scenario.deceptionObjective,
    });

    this.setState(new SessionState());
    this.state.tick = 0;
    this.state.phase = "running";
    this.state.freeze = false;
    this.state.timeScale = 1;

    const canned = new CannedProvider(this.scenario.injects);
    const llmKey = process.env.LLM_API_KEY || "";
    if (llmKey) {
      this.provider = new LlmVariantProvider(canned, this.scenario.injects, {
        baseUrl: process.env.LLM_BASE_URL || "https://api.cerebras.ai/v1",
        apiKey: llmKey,
        model: process.env.LLM_MODEL || "gpt-oss-120b",
        scenario: this.scenario.id,
      });
      console.log(`[room] LLM inject variants on (${process.env.LLM_MODEL || "gpt-oss-120b"})`);
    } else {
      console.warn("[injects] no LLM_API_KEY — canned injects only");
      this.provider = canned;
    }
    this.scheduleFreezes();

    await this.store.appendEvent(this.runId, {
      t: 0, type: "run", actor: "server",
      data: { scenario: this.scenario.id, seed: this.scenario.seed },
    });

    this.setFixedTimestep(() => this.tickStep(), 4); // 4 Hz (D9)
    this.onMessage("*", (client, type, data) => this.handleMessage(client, type, data));
    console.log(`[room] run ${this.runId} scenario=${scenarioId} tick=4Hz`);
  }

  // ---- fixed-step simulation ----
  private tickStep() {
    if (this.state.phase !== "running") return;
    if (this.state.freeze) {
      // Simulation suspended: SAGAT probe (freezeInfo set) or a manual EXCON hold.
      // Either way sim time does NOT advance here.
      if (this.freezeInfo) {
        // Bots answer instantly and ARE counted; release on timeout or all-answered.
        for (const seat of DEMO_SEATS) {
          if (this.isBotSeat(seat) && !this.freezeInfo.answered.has(seat)) {
            this.freezeInfo.answered.add(seat);
            this.answerProbeAsBot(seat);
          }
        }
        if (Date.now() >= this.freezeInfo.untilWall || this.freezeInfo.answered.size >= this.seatCount()) {
          this.releaseFreeze();
        }
      }
      return;
    }
    const dt = (this.scenario.tick_ms / 1000) * this.timeScale;
    stepWorld(this.world, this.scenario, this.rng, dt);

    // Manual instructor overrides sit on top of the scheduled timeline.
    for (const [id, m] of Object.entries(this.manualLinks)) {
      if (m.since <= this.world.time_s && this.world.links[id]) {
        Object.assign(this.world.links[id], m.patch);
      }
    }

    this.fireDueInjects();
    this.fireDueDecisions();
    this.runDemoBots();
    this.maybeFreeze();
    this.deliverDue();

    this.state.tick = this.world.tick;
    this.emitViews();

    if (this.world.tick % 40 === 0) {
      void this.store.appendTruth(this.runId, this.world.tick, {
        tick: this.world.tick, t: this.world.time_s, truth: this.world.truth,
      });
    }
    if (this.world.time_s >= this.scenario.duration_s) {
      this.state.phase = "done";
      void this.store.appendEvent(this.runId, { t: this.world.time_s, type: "run", actor: "server", data: { status: "done" } });
      this.broadcast("phase", { phase: "done", runId: this.runId });
    }
  }

  // ---- seats ----
  async onJoin(client: Client, options: any) {
    const seat = String(options.seat || "cdr");
    const needPw = process.env.ROOM_PASSWORD || "";
    if (seat === "instructor" && needPw && options.password !== needPw) {
      throw new Error("instructor access denied");
    }
    client.userData = { seat };
    this.clients_by_seat.set(seat, client);
    const meta = new SeatMeta();
    meta.role = seat;
    meta.connected = true;
    this.state.seats.set(client.sessionId, meta);
    if (!this.journals.has(seat)) this.journals.set(seat, []);

    // Demo mode: scripted seats act for roles no human has joined (1-click jury run).
    if (options.demo && !this.demoBots) {
      if (this.world.tick < 5) {
        this.demoBots = true;
        this.feed("DEMO MODE on: scripted cdr/ops/intel/log seats active");
      } else {
        this.clientFor(seat)?.send("feed", { t: this.world.time_s, text: "room already running — close all tabs (room resets), then reopen with &demo=1 for a clean demo" });
      }
    }

    // Full snapshot: scenario frame + current view + journal + open decisions.
    client.send("hello", {
      runId: this.runId,
      seat,
      scenario: { id: this.scenario.id, title: this.scenario.title, duration_s: this.scenario.duration_s },
      briefing: this.scenario.briefing ?? "",
      objectives: this.scenario.objectives ?? [],
      obstacles: this.scenario.obstacles ?? [],
      // The adversary's aim is debrief material, never trainee material.
      deceptionObjective: seat === "instructor" ? (this.scenario.deceptionObjective ?? "") : "",
      nodes: this.scenario.nodes,
      links: this.scenario.links.map((l) => ({
        id: l.id, from: l.from, to: l.to,
        seats: Object.keys(this.feeds).filter((s) => this.feeds[s].includes(l.id)),
      })),
      decisions: this.scenario.decisions.map(publicDecision),
      injects: this.scenario.injects.map((inj, index) => ({
        index, t: inj.t, type: inj.type, link: inj.link ?? null, from: inj.from ?? null, to: inj.to ?? null,
      })),
      journal: this.journals.get(seat),
    });
    const view = this.buildView(seat);
    if (view) client.send("view", view);
    if (seat === "instructor") {
      client.send("truth", { tick: this.world.tick, t: this.world.time_s, truth: this.world.truth, links: this.world.links });
    }
    console.log(`[room] seat=${seat} joined run=${this.runId}`);
  }

  onLeave(client: Client) {
    const seat = client.userData?.seat;
    if (seat) this.clients_by_seat.delete(seat);
    this.state.seats.delete(client.sessionId);
  }

  onDispose() {
    void this.store.close();
  }

  // ---- inbound seat traffic ----
  private handleMessage(client: Client, type: string | number, data: any) {
    const seat = client.userData?.seat ?? "unknown";
    switch (type) {
      case "decision": return void this.onDecision(seat, data);
      case "chat": return void this.onChat(seat, data);
      case "link_patch": return void this.onLinkPatch(seat, data);
      case "inject_now": return void this.onInjectNow(seat, data);
      case "freeze_set": return void this.onFreezeSet(seat, data);
      case "time_set": return void this.onTimeSet(seat, data);
      case "time_scale": return void this.onTimeScale(seat, data);
      case "probe_answer": return void this.onProbeAnswer(seat, data);
      case "sart": return void this.onSart(seat, data);
      case "notice": return void this.onNotice(seat, data);
      case "verify_request": return void this.sendChatAs(seat, String(data.to ?? "all"), `VERIFY REQUEST: ${String(data.text ?? "")}`);
      default: console.warn(`[room] unknown msg ${type} from ${seat}`);
    }
  }

  private onDecision(seat: string, d: any) {
    this.recordDecision(seat, d);
  }

  /** Decision capture shared by humans (WS) and demo bots (in-process). */
  private recordDecision(seat: string, d: any) {
    const open = this.openDecisions.get(d.decisionId);
    if (!open) return;
    const def = open.def;
    const correct = d.choice === def.optimal;
    const view = this.lastViews.get(seat);
    const journal = this.journals.get(seat) ?? [];
    const rec = {
      id: nextMsgId(), seat, t: this.world.time_s, decisionId: def.id,
      choice: d.choice, rationale: String(d.rationale ?? ""), confidence: Number(d.confidence ?? 0.5),
      ooda_latency_s: oodaLatency(this.world.time_s, open.openedAt), correct,
      context: {
        iis: view?.iis ?? 0,
        viewTick: view?.tick ?? this.world.tick,
        heard: journal.slice(-5).map((j) => ({ t: j.t, from: j.from, text: j.text.slice(0, 120) })),
        links: (this.feeds[seat] ?? []).map((id) => ({
          id, integrity: this.world.links[id]?.integrity ?? 1, active: this.world.links[id]?.active ?? true,
        })),
      },
    };
    open.answered.add(seat);
    void this.store.appendEvent(this.runId, { t: this.world.time_s, type: "decision", actor: seat, data: rec });
    this.clientFor(seat)?.send("decision_ack", rec);
    this.feed(`${seat} decided: ${d.choice} (${correct ? "CORRECT" : "off-optimal"})`);
  }

  private onChat(seat: string, d: any) {
    this.sendChatAs(seat, String(d.to ?? "all"), String(d.text ?? "").slice(0, 500));
  }

  /** Seat traffic shared by humans (WS) and demo bots (in-process). */
  private sendChatAs(seat: string, to: string, text: string) {
    // Seat-to-seat traffic crosses the ops net with a small delay (logged for CAST).
    const profile = { ...CLEAN_LINK, latency_ms: 1500, jitter_ms: 500 };
    const route = routeMessage(profile, this.world.time_s, this.rng);
    const msg: WireMessage = {
      id: nextMsgId(), from: seat, to, kind: "query", text,
      t_sent: this.world.time_s, t_recv: route.action === "deliver" ? route.deliverAt : -1,
      meta: { source: seat.toUpperCase(), confidence: 1, integrity: 1, age_s: 0, origin: "truth" },
      degradedBy: route.degradedBy,
    };
    if (route.action === "deliver") {
      const targets = to === "all" ? [...this.clients_by_seat.keys()].filter((s) => s !== "instructor") : [to];
      for (const s of targets) this.queue.push({ deliverAt: route.deliverAt, seatId: s, msg: { ...msg, to: s } });
      void this.store.appendEvent(this.runId, { t: this.world.time_s, type: "chat", actor: seat, data: msg });
    } else {
      void this.store.appendEvent(this.runId, { t: this.world.time_s, type: "chat", actor: seat, data: { ...msg, dropped: true } });
    }
  }

  private onLinkPatch(seat: string, d: any) {
    if (seat !== "instructor" && seat !== "comms") return;
    this.manualLinks[d.link] = { since: this.world.time_s, patch: d.patch };
    void this.store.appendEvent(this.runId, { t: this.world.time_s, type: "link_change", actor: seat, data: d });
    this.feed(`link ${d.link} patched by ${seat}`);
  }

  private onInjectNow(seat: string, d: any) {
    if (seat !== "instructor") return;
    const inject = this.scenario.injects[d.index];
    if (inject) this.fireInject(inject, true);
  }

  private onFreezeSet(seat: string, d: any) {
    if (seat !== "instructor") return;
    this.manualFreeze = Boolean(d.freeze);
    this.state.freeze = this.manualFreeze || Boolean(this.freezeInfo);
    void this.store.appendEvent(this.runId, {
      t: this.world.time_s, type: "state", actor: seat,
      data: { freeze: this.manualFreeze },
    });
    // Seats have no freeze_flag listener — tell them over the notice channel they do watch.
    this.broadcast("notice", {
      t: this.world.time_s,
      text: this.manualFreeze ? "SIMULATION HELD BY EXCON — STAND BY." : "SIMULATION RESUMED — ALL NETS ACTIVE.",
      from: "EXCON",
    });
    this.feed(`EXCON ${this.manualFreeze ? "held" : "released"} the simulation`);
  }

  /** Instructor broadcast to every seat (the EXCON adjutant banner seats already render). */
  private onNotice(seat: string, d: any) {
    if (seat !== "instructor") return;
    const text = String(d?.text ?? "").trim().slice(0, 300);
    if (!text) return;
    const t = this.world.time_s;
    this.broadcast("notice", { t, text, from: "EXCON" });
    void this.store.appendEvent(this.runId, { t, type: "state", actor: seat, data: { notice: text } });
    this.feed(`EXCON notice: ${text}`);
  }

  private onTimeSet(seat: string, d: any) {
    if (seat !== "instructor") return;
    const t = Math.max(0, Math.min(Number(d.t ?? 0), this.scenario.duration_s));
    this.world.time_s = t;
    void this.store.appendEvent(this.runId, { t, type: "state", actor: seat, data: { timeWarp: t } });
    this.feed(`EXCON warped scenario time to t=${t}s`);
  }

  private onTimeScale(seat: string, d: any) {
    if (seat !== "instructor") return;
    const s = Math.max(0.25, Math.min(Number(d.scale ?? 1), 10));
    this.timeScale = s;
    this.state.timeScale = s;
    void this.store.appendEvent(this.runId, { t: this.world.time_s, type: "state", actor: seat, data: { timeScale: s } });
    this.feed(`EXCON set time scale x${s}`);
  }

  private onProbeAnswer(seat: string, d: any) {
    if (!this.freezeInfo || d.freezeId !== this.freezeInfo.id) return;
    this.freezeInfo.answered.add(seat);
    this.gradeProbe(seat, d.freezeId, d.answers ?? []);
  }

  /** Probe grading shared by humans (WS) and demo bots (in-process). */
  private gradeProbe(seat: string, freezeId: string, answers: { queryId: string; answer: string }[]) {
    const view = this.lastViews.get(seat);
    if (!view) return;
    const ctx = {
      truth: this.world.truth, view,
      journal: this.journals.get(seat) ?? [],
      views: Object.fromEntries(this.lastViews),
      links: this.world.links,
    };
    let score = 0;
    const graded = answers.map((a) => {
      const correct = scoreAnswer(a.queryId, ctx).truth;
      const hit = a.answer === correct;
      if (hit) score += 1;
      return { ...a, correct, hit };
    });
    void this.store.appendEvent(this.runId, {
      t: this.world.time_s, type: "probe", actor: seat,
      data: { freezeId, seat, answers: graded, score, total: graded.length },
    });
    this.clientFor(seat)?.send("probe_result", { freezeId, score, total: graded.length });
  }

  /** Demo bots answer probes instantly from the option list (shows the scoring loop). */
  private answerProbeAsBot(seat: string) {
    if (!this.freezeInfo) return;
    const qs = this.scenario.queries.filter((q) => this.freezeInfo!.queryIds.includes(q.id));
    this.gradeProbe(seat, this.freezeInfo.id, qs.map((q) => ({ queryId: q.id, answer: this.rng.pick(q.options) })));
  }

  private onSart(seat: string, d: any) {
    void this.store.appendEvent(this.runId, { t: this.world.time_s, type: "sart", actor: seat, data: d });
  }

  // ---- injects / decisions / freezes ----
  private fireDueInjects() {
    for (const inj of this.provider.due(this.world.time_s)) this.fireInject(inj, false);
  }

  private fireInject(inj: ScenarioDef["injects"][number], manual: boolean) {
    void this.store.appendEvent(this.runId, { t: this.world.time_s, type: "inject", actor: manual ? "instructor" : "timeline", data: inj });
    this.feed(`INJECT: ${inj.type}${inj.link ? " " + inj.link : ""}`);
    // Flag assets/units named in traffic — seats see them pulse as "recently reported".
    const hotId: string | undefined = inj.payload?.asset ?? inj.payload?.unit;
    if (hotId && (inj.type === "report" || inj.type === "event")) {
      this.hot.set(hotId, this.world.time_s + 120);
    }
    if (inj.type === "report") {
      const from = inj.from ?? "hq";
      const to = inj.to ?? "cdr";
      const link = this.scenario.links.find((l) => l.from === from && l.to === to);
      const profile = link ? this.world.links[link.id] : { ...CLEAN_LINK };
      const route = routeMessage(profile, this.world.time_s, this.rng);
      const isSpoof = inj.meta?.origin === "spoof";
      const msg: WireMessage = {
        id: nextMsgId(), from, to, kind: "report",
        text: String(inj.payload?.text ?? ""),
        payload: inj.payload,
        t_sent: this.world.time_s, t_recv: route.action === "deliver" ? route.deliverAt : -1,
        meta: {
          source: String(inj.meta?.source ?? from.toUpperCase()),
          confidence: Number(inj.meta?.confidence ?? 0.8),
          integrity: isSpoof ? 0 : route.integrity,
          age_s: 0, origin: isSpoof ? "spoof" : "truth",
        },
        degradedBy: isSpoof ? [...route.degradedBy, "spoof"] : route.degradedBy,
      };
      if (route.action === "deliver") this.queue.push({ deliverAt: route.deliverAt, seatId: to, msg });
      else {
        // Dropped reports still get logged (instructor sees the black hole).
        void this.store.appendEvent(this.runId, { t: this.world.time_s, type: "message", actor: "router", data: { ...msg, dropped: true } });
      }
    } else if (inj.type === "link_change" && inj.link) {
      this.manualLinks[inj.link] = { since: this.world.time_s, patch: inj.patch ?? {} };
    } else if (inj.type === "event") {
      const ev = {
        id: nextMsgId(), t: this.world.time_s, kind: inj.kind ?? "event",
        x: inj.x ?? 0, y: inj.y ?? 0, severity: inj.severity ?? 0.5, text: inj.payload?.text,
      };
      this.world.truth.events.push(ev);
      if (inj.payload?.unit) {
        const u = this.world.truth.units.find((x) => x.id === inj.payload.unit);
        if (u) u.status = "in contact";
      }
      // Alert all seats through their own links.
      for (const seat of this.clients_by_seat.keys()) {
        if (seat === "instructor") continue;
        const profile = this.profileFor(seat);
        const route = routeMessage(profile, this.world.time_s, this.rng);
        if (route.action === "deliver") {
          this.queue.push({
            deliverAt: route.deliverAt, seatId: seat,
            msg: {
              id: nextMsgId(), from: "ops", to: seat, kind: "alert",
              text: String(inj.payload?.text ?? "event"),
              t_sent: this.world.time_s, t_recv: route.deliverAt,
              meta: { source: "OPS-NET", confidence: 0.85, integrity: route.integrity, age_s: 0, origin: "truth" },
              degradedBy: route.degradedBy,
            },
          });
        }
      }
    }
  }

  private fireDueDecisions() {
    for (const d of this.scenario.decisions) {
      if (d.t <= this.world.time_s && !this.openDecisions.has(d.id)) {
        const open: OpenDecision = { def: d, openedAt: this.world.time_s, answered: new Set() };
        this.openDecisions.set(d.id, open);
        const seats = d.seats?.length ? d.seats : [...this.clients_by_seat.keys()].filter((s) => s !== "instructor");
        for (const s of seats) {
          this.clientFor(s)?.send("decision_open", {
            id: nextMsgId(), from: "server", to: s, kind: "decision_open",
            text: d.prompt, payload: publicDecision(d), t_sent: this.world.time_s, t_recv: this.world.time_s,
            meta: { source: "EXCON", confidence: 1, integrity: 1, age_s: 0, origin: "truth" },
            degradedBy: [],
          } satisfies WireMessage);
        }
        void this.store.appendEvent(this.runId, { t: this.world.time_s, type: "decision", actor: "server", data: { opened: d.id } });
      }
    }
  }

  private scheduleFreezes() {
    // Two SAGAT freezes per run, kept clear of scripted injects by ±90s.
    const injectTimes = this.scenario.injects.map((i) => i.t);
    const clear = (t: number) => injectTimes.every((x) => Math.abs(x - t) > 90);
    let t1 = 500 + Math.floor(this.rng.next() * 300);
    let guard = 0;
    while (!clear(t1) && guard++ < 50) t1 += 37;
    let t2 = 1000 + Math.floor(this.rng.next() * 400);
    guard = 0;
    while ((!clear(t2) || Math.abs(t2 - t1) < 200) && guard++ < 50) t2 += 41;
    // Clamp inside the scenario; drop the second freeze if it no longer fits.
    t1 = Math.min(t1, this.scenario.duration_s - 240);
    t2 = Math.min(t2, this.scenario.duration_s - 120);
    this.freezeAt = t2 > t1 + 200 ? [t1, t2] : [t1];
  }

  private seatCount(): number {
    const humans = [...this.clients_by_seat.keys()].filter((s) => s !== "instructor").length;
    const bots = this.demoBots ? DEMO_SEATS.filter((s) => !this.clients_by_seat.has(s)).length : 0;
    return Math.max(humans + bots, 1);
  }

  /** A bot seat is script-driven only while no human occupies it. */
  private isBotSeat(seat: string): boolean {
    return this.demoBots && DEMO_SEATS.includes(seat) && !this.clients_by_seat.has(seat);
  }

  private runDemoBots() {
    if (!this.demoBots || this.freezeInfo) return;
    while (this.botCursor < DEMO_SCRIPT.length && DEMO_SCRIPT[this.botCursor].t <= this.world.time_s) {
      const a = DEMO_SCRIPT[this.botCursor++];
      if (!this.isBotSeat(a.seat)) continue;
      if (a.kind === "chat") this.sendChatAs(a.seat, a.to ?? "all", a.text ?? "");
      else if (a.kind === "verify") this.sendChatAs(a.seat, a.to ?? "all", `VERIFY REQUEST: ${a.text ?? ""}`);
      else if (a.kind === "decision" && a.decisionId && a.choice) {
        this.recordDecision(a.seat, { decisionId: a.decisionId, choice: a.choice, rationale: a.rationale ?? "", confidence: a.confidence ?? 0.7 });
      }
    }
  }

  /** Instructor-only feed (decisions, injects, link changes). Never broadcast to seats. */
  private feed(text: string) {
    this.clients_by_seat.get("instructor")?.send("feed", { t: this.world.time_s, text });
  }

  private releaseFreeze() {
    const id = this.freezeInfo?.id;
    this.freezeInfo = null;
    this.freezeCount += 1;
    this.state.freeze = this.manualFreeze;
    this.broadcast("unfreeze", { freezeId: id });
  }

  private maybeFreeze() {
    if (this.freezeInfo || this.freezeCount >= 2) return;
    const due = this.freezeAt[this.freezeCount];
    if (due !== undefined && this.world.time_s >= due) {
      const ids = [...this.scenario.queries].sort(() => this.rng.next() - 0.5).slice(0, 3).map((q) => q.id);
      this.freezeInfo = { id: `fz${this.freezeCount + 1}`, queryIds: ids, untilWall: Date.now() + 90000, answered: new Set() };
      this.state.freeze = true;
      const queries = this.scenario.queries.filter((q) => ids.includes(q.id));
      this.broadcast("freeze", { freezeId: this.freezeInfo.id, queries });
      void this.store.appendEvent(this.runId, { t: this.world.time_s, type: "probe", actor: "server", data: { opened: this.freezeInfo.id, queries: ids } });
    }
  }

  // ---- delivery + views ----
  private deliverDue() {
    const now = this.world.time_s;
    const ready = this.queue.filter((q) => q.deliverAt <= now);
    this.queue = this.queue.filter((q) => q.deliverAt > now);
    for (const q of ready) {
      const withAge: WireMessage = { ...q.msg, t_recv: now, meta: { ...q.msg.meta, age_s: Math.round(now - q.msg.t_sent) } };
      const target = this.clientFor(q.seatId);
      if (!target) {
        // Seat unmanned (bot-only role or disconnected) — logged as dropped, never queued.
        void this.store.appendEvent(this.runId, { t: now, type: "message", actor: "router", data: { ...withAge, dropped: true, reason: "seat-unmanned" } });
        continue;
      }
      // Seats get the message WITHOUT origin (spoof must not be detectable on the wire)…
      const { origin: _origin, ...seatMeta } = withAge.meta;
      target.send("report", { ...withAge, meta: seatMeta });
      // …the instructor wiretap gets everything, origin included.
      this.clients_by_seat.get("instructor")?.send("wiretap", withAge);
      const j = this.journals.get(q.seatId);
      j?.push({ t: now, from: withAge.from, kind: withAge.kind, text: withAge.text });
      void this.store.appendEvent(this.runId, { t: now, type: "message", actor: "router", data: withAge });
    }
  }

  private profileFor(seat: string): LinkProfile {
    const ids = this.feeds[seat] ?? [];
    let worst: LinkProfile = { ...CLEAN_LINK };
    for (const id of ids) {
      const p = this.world.links[id];
      if (p && p.integrity < worst.integrity) worst = p;
    }
    return worst;
  }

  private buildView(seat: string): DegradedView | null {
    if (seat === "instructor") return null;
    const profiles = (this.feeds[seat] ?? []).map((id) => this.world.links[id]).filter(Boolean);
    const open = [...this.openDecisions.values()].find((o) => !o.answered.has(seat));
    const view = projectView(this.world, seat, profiles, this.rng, {
      tick: this.world.tick, phase: this.state.phase,
      nextDecision: open ? { ...publicDecision(open.def), openTick: this.world.tick } : undefined,
    });
    view.iis = computeIIS(view, this.world.truth);
    view.links = (this.feeds[seat] ?? []).map((id) => {
      const p = this.world.links[id];
      return { id, latency_ms: p?.latency_ms ?? 0, loss_pct: p?.loss_pct ?? 0, integrity: p?.integrity ?? 1, active: p?.active ?? true };
    });
    const now = this.world.time_s;
    for (const [id, until] of [...this.hot]) if (until < now) this.hot.delete(id);
    view.hot = [...this.hot.keys()];
    view.timeScale = this.timeScale;
    if (this.freezeInfo) view.probe = { queryIds: this.freezeInfo.queryIds, freezeId: this.freezeInfo.id };
    this.lastViews.set(seat, view);
    return view;
  }

  private emitViews() {
    // Bot-only seats get computed + stored views (probe grading, AAR) but no send.
    const seats = new Set<string>([...this.clients_by_seat.keys()]);
    if (this.demoBots) for (const s of DEMO_SEATS) seats.add(s);
    for (const seat of seats) {
      const client = this.clientFor(seat);
      if (seat === "instructor") {
        if (client && this.world.tick % 8 === 0) {
          client.send("truth", {
            tick: this.world.tick, t: this.world.time_s,
            truth: this.world.truth, links: this.world.links,
            iis: Object.fromEntries([...this.lastViews].map(([s, v]) => [s, v.iis])),
          });
        }
        continue;
      }
      const view = this.buildView(seat);
      if (view) {
        client?.send("view", view);
        if (this.world.tick % 40 === 0) void this.store.appendView(this.runId, seat, this.world.tick, view);
      }
    }
  }

  private clientFor(seat: string): Client | undefined {
    return this.clients_by_seat.get(seat);
  }
}
