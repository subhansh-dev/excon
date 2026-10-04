import { useEffect, useState } from "react";
import { TopMark, Disclaimer } from "./TopMark";
import { sound } from "../sound";
import { useT } from "../i18n";

const SEAT_CARDS = [
  { id: "cdr", code: "CDR", name: "Commander", duty: "Commits the COA. Decides what to trust when the nets disagree." },
  { id: "ops", code: "OPS", name: "Operations / 2iC", duty: "Owns the operational picture and the movement plan." },
  { id: "intel", code: "G2", name: "Intelligence", duty: "ISR vs HUMINT. Says which feed to believe when they conflict." },
  { id: "comms", code: "SIGS", name: "Communications", duty: "The only seat that sees every link — and who dropped off it." },
  { id: "log", code: "S4", name: "Logistics", duty: "Fuel, spares, confirmations. The feed everyone forgets until it hurts." },
  { id: "instructor", code: "EXCON", name: "Exercise Control", duty: "God's-eye console: injects, freeze, notices, live scoring." },
];

const CAPABILITIES = [
  {
    k: "one",
    title: "ONE TRUTH, FIVE BROKEN VIEWS",
    body: "A single authoritative simulation projects a deliberately degraded slice of itself to each seat — latency, dropouts and spoofed feeds, derived from the scenario deck.",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 3 4 6.5v5c0 5 3.4 8.4 8 9.5 4.6-1.1 8-4.5 8-9.5v-5L12 3Z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    k: "score",
    title: "SCORED, NOT JUDGED BY EYE",
    body: "SAGAT probes, CAST checks, per-seat Information Integrity Score, OODA latency and confidence-vs-accuracy calibration — computed from the run, not from opinion.",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    ),
  },
  {
    k: "replay",
    title: "TICK-EXACT REPLAY",
    body: "Seeded, fixed-tick, deterministic. Scrub back to the exact second each seat's picture diverged from ground truth — with divergence computed from the deck itself.",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </svg>
    ),
  },
  {
    k: "cf",
    title: "COUNTERFACTUAL RE-SCORING",
    body: "Re-score the recorded run with the failure modes patched out: pristine links, zero spoofs. Shows what the decision would have cost without the EW.",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 6h6a4 4 0 0 1 0 8H7l3 4" />
        <path d="M20 18h-6a4 4 0 0 1 0-8h3" />
      </svg>
    ),
  },
];

/** Landing / entry surface: product pitch, one-click jury demo, role entry points. */
export function HomeView() {
  const [health, setHealth] = useState<any>(null);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const t = useT();

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth({ ok: false }));
    fetch("/api/scenarios").then((r) => r.json()).then(setScenarios).catch(() => setScenarios([]));
  }, []);

  const open = (url: string) => {
    sound.playClick();
    window.open(url, "_blank");
  };

  const primaryScenario = scenarios[0]?.id || "reach";

  return (
    <div style={{ maxWidth: 1140, margin: "0 auto", padding: "16px 20px" }}>
      <div className="topbar" style={{ position: "static", borderRadius: 12, marginBottom: 16 }}>
        <TopMark title="DSSC COMMAND DECISION TRAINER" sub="Defence Services Staff College · Multi-Domain Simulation" />
        <span style={{ flex: 1 }} />
        <nav className="nav-pills">
          <a className="on" href="?view=home">{t("nav.home")}</a>
          <a href="?view=lobby">{t("nav.lobby")}</a>
          <a href="?view=analytics">{t("nav.analytics")}</a>
          <a href="?view=instructor">{t("nav.excon")}</a>
        </nav>
        <span className="stat">
          {t("sim.server")}{" "}
          <b style={{ color: health?.ok ? "var(--ok)" : "var(--danger)" }}>
            {health?.ok ? `${t("sim.online")} (${String(health.store || "?").toUpperCase()})` : t("sim.off")}
          </b>
        </span>
      </div>

      {/* Hero */}
      <div className="panel" style={{ background: "linear-gradient(180deg, #faf7f0, #eae4d6)", border: "1px solid var(--line-hi)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 20 }}>
          <div style={{ maxWidth: 660 }}>
            <div className="mono" style={{ fontSize: 10.5, letterSpacing: "0.16em", color: "var(--accent-hi)", marginBottom: 10 }}>
              {t("home.kicker")}
            </div>
            <h1 style={{ margin: "0 0 10px", fontSize: "clamp(24px, 6.5vw, 34px)", lineHeight: 1.12, letterSpacing: "-0.01em" }}>
              {t("home.title")}
            </h1>
            <p style={{ margin: 0, fontSize: 14.5, color: "var(--dim)", maxWidth: 620 }}>
              {t("home.sub")}
            </p>
            <div className="row" style={{ gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              <button className="btn primary" style={{ padding: "11px 20px", fontSize: 13.5 }} onClick={() => open("?view=instructor&scenario=reach&demo=1")}>
                {t("home.demo")}
              </button>
              <button className="btn ghost" style={{ padding: "11px 20px", fontSize: 13.5 }} onClick={() => open("?view=lobby")}>
                {t("home.lobby")}
              </button>
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 10 }}>
              {t("home.demoHint")}
            </div>
          </div>

          <div style={{ display: "grid", gap: 8, minWidth: 240 }}>
            {[
              [t("home.stat.decks"), t("home.stat.decksV", { n: scenarios.length || 3 })],
              [t("home.stat.appts"), t("home.stat.apptsV")],
              [t("home.stat.scoring"), t("home.stat.scoringV")],
              [t("home.stat.replay"), t("home.stat.replayV")],
            ].map(([k, v]) => (
              <div
                key={k}
                style={{
                  background: "var(--bg-raise)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  padding: "8px 12px",
                  boxShadow: "var(--neu-sm)",
                }}
              >
                <div className="mono" style={{ fontSize: 9.5, letterSpacing: "0.14em", color: "var(--accent-hi)" }}>{k}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-pure)", fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Role entry */}
      <div className="panel" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{t("home.takeSeat")}</h2>
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
            {t("home.takeSeatHint", { deck: primaryScenario.toUpperCase() })}
          </span>
        </div>
        <div className="lobby-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          {SEAT_CARDS.map((s) => (
            <button
              key={s.id}
              className="lobby-card"
              onClick={() => open(`?view=${s.id}${s.id === "instructor" ? `&scenario=${primaryScenario}` : ""}`)}
              style={{
                textAlign: "left",
                cursor: "pointer",
                font: "inherit",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                minHeight: 0,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: "var(--accent-hi)" }}>{s.code}</span>
                <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.12em", color: "var(--muted)" }}>OPEN →</span>
              </div>
              <b style={{ color: "var(--text-pure)", fontSize: 13.5 }}>{t(`seat.${s.id === "instructor" ? "excon" : s.id}.name`)}</b>
              <span className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>{t(`seat.${s.id === "instructor" ? "excon" : s.id}.duty`)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Capabilities */}
      <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginTop: 16 }}>
        {CAPABILITIES.map((c) => (
          <div className="panel" key={c.title} style={{ marginTop: 0 }}>
            <div className="row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
              <span style={{ color: "var(--accent-hi)", display: "inline-flex" }}>{c.icon}</span>
              <b className="mono" style={{ fontSize: 11.5, letterSpacing: "0.1em", color: "var(--text-pure)" }}>{t(`cap.${c.k}.title`)}</b>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55 }}>{t(`cap.${c.k}.body`)}</p>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <Disclaimer />
      </div>
    </div>
  );
}
