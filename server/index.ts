// HTTP + Colyseus on ONE port (:2567). Serves the built client, /api/*, WS rooms,
// and the /matchmake/* HTTP API (wired by the framework during listen()).
import express from "express";
import path from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { TrainerRoom } from "./room.js";
import { buildAAR } from "./aar.js";
import { buildReplay } from "./replay.js";
import { runCounterfactual } from "./counterfactual.js";
import { summarizeRuns } from "./analytics.js";
import { openStore } from "./store.js";
import { listScenarios, loadScenario, saveScenario } from "./scenario.js";

const PORT = Number(process.env.PORT || 2567);
const CLIENT_DIST = path.resolve("client/dist");
const RUNS_DIR = path.resolve(process.env.RUNS_DIR || "./runs");

const store = await openStore();

const gameServer = new Server({
  transport: new WebSocketTransport(),
  // The framework hands us its express app (same http server as WS + matchmake).
  express: async (app) => {
    app.use(express.json({ limit: "10mb" }));

    app.get("/api/health", (_req, res) =>
      res.json({ ok: true, store: store.kind, time: new Date().toISOString() }),
    );

    app.get("/api/scenarios", (_req, res) => {
      try {
        res.json(
          listScenarios().map((f) => {
            const s = loadScenario(f.replace(/\.ya?ml$/, ""));
            return {
              id: s.id, title: s.title, briefing: s.briefing ?? "",
              duration_s: s.duration_s,
              decisions: s.decisions.length, queries: s.queries.length,
              seats: s.nodes.filter((n) => n.kind === "seat").map((n) => n.role ?? n.id),
            };
          }),
        );
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
    });

    app.post("/api/scenarios", (req, res) => {
      try {
        const { yaml } = req.body;
        if (!yaml || typeof yaml !== "string") {
          return res.status(400).json({ error: "Missing required 'yaml' string in request body" });
        }
        const saved = saveScenario(yaml);
        res.json({
          ok: true,
          scenario: {
            id: saved.id,
            title: saved.title,
            briefing: saved.briefing ?? "",
            duration_s: saved.duration_s,
            decisions: saved.decisions.length,
            queries: saved.queries.length,
            seats: saved.nodes.filter((n) => n.kind === "seat").map((n) => n.role ?? n.id),
          },
        });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    });

    app.get("/api/runs", async (_req, res) => res.json(await store.listRuns()));

    // One request for the whole Analytics page (events pass, no view loads).
    app.get("/api/analytics", async (_req, res) => {
      try {
        res.json({ runs: await summarizeRuns(store) });
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
    });

    app.get("/api/runs/:id/aar", async (req, res) => {
      try {
        res.json(await buildAAR(req.params.id, store));
      } catch (e) {
        res.status(404).json({ error: (e as Error).message });
      }
    });

    // Standalone so the AAR stays cheap to build; the client fetches the mode it shows.
    app.get("/api/runs/:id/counterfactual", async (req, res) => {
      const mode = String(req.query.mode ?? "clean_links");
      if (mode !== "clean_links" && mode !== "suppress_spoof") {
        return res.status(400).json({ error: `mode must be clean_links or suppress_spoof (got "${mode}")` });
      }
      try {
        res.json(await runCounterfactual(req.params.id, store, mode));
      } catch (e) {
        res.status(404).json({ error: (e as Error).message });
      }
    });

    app.get("/api/runs/:id/replay", async (req, res) => {
      try {
        res.json(await buildReplay(req.params.id, store));
      } catch (e) {
        res.status(404).json({ error: (e as Error).message });
      }
    });

    app.get("/api/runs/:id/notes", (req, res) => {
      try {
        const noteFile = path.join(RUNS_DIR, req.params.id, "notes.txt");
        if (existsSync(noteFile)) {
          res.json({ notes: readFileSync(noteFile, "utf8") });
        } else {
          res.json({ notes: "" });
        }
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
    });

    app.post("/api/runs/:id/notes", (req, res) => {
      try {
        const { notes } = req.body;
        const dir = path.join(RUNS_DIR, req.params.id);
        if (existsSync(dir)) {
          writeFileSync(path.join(dir, "notes.txt"), String(notes ?? ""), "utf8");
          res.json({ ok: true });
        } else {
          res.status(404).json({ error: "Run directory not found" });
        }
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
    });

    app.use(express.static(CLIENT_DIST));
    // SPA fallback — never swallow framework routes.
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/matchmake") || req.path.startsWith("/api")) return next();
      res.sendFile(path.join(CLIENT_DIST, "index.html"));
    });
  },
});

gameServer.define("trainer", TrainerRoom);

await gameServer.listen(PORT);
console.log(`[server] trainer on :${PORT} (store=${store.kind})`);
