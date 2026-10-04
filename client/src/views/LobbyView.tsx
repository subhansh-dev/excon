import { useEffect, useState, useMemo } from "react";
import { TopMark, Disclaimer, APPOINTMENT } from "./TopMark";
import { sound } from "../sound";

/** Exercise lobby: scenario selector, custom YAML loader, 1-click jury demo, run records. */
export function LobbyView() {
  const [health, setHealth] = useState<any>(null);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<any>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [customYamlName, setCustomYamlName] = useState("");
  const [customYamlStatus, setCustomYamlStatus] = useState("");

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth({ ok: false }));
    fetch("/api/scenarios").then((r) => r.json()).then(setScenarios).catch(() => setScenarios([]));
    fetch("/api/runs").then((r) => r.json()).then(setRuns).catch(() => setRuns([]));
  }, []);

  const openSeat = (scenario: string, seat: string, extra = "") => {
    sound.playClick();
    window.open(`?view=${seat}&scenario=${scenario}${extra}`, "_blank");
  };

  const filteredScenarios = useMemo(() => {
    if (!filterQuery.trim()) return scenarios;
    const q = filterQuery.toLowerCase();
    return scenarios.filter(
      (s) => s.title?.toLowerCase().includes(q) || s.id?.toLowerCase().includes(q) || s.briefing?.toLowerCase().includes(q),
    );
  }, [scenarios, filterQuery]);

  const handleCustomYamlUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCustomYamlName(file.name);
    setCustomYamlStatus("Uploading & validating scenario with server engine...");

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (!text) return;

      fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: text }),
      })
        .then((r) => {
          if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.error || `HTTP ${r.status}`)));
          return r.json();
        })
        .then((res) => {
          setCustomYamlStatus(`✓ Scenario '${res.scenario?.title || file.name}' registered & ready to simulate!`);
          sound.playClick();
          // Reload scenario list
          fetch("/api/scenarios").then((r) => r.json()).then(setScenarios);
        })
        .catch((err) => {
          setCustomYamlStatus(`⚠️ Scenario validation error: ${err.message}`);
          sound.playWarning();
        });
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ maxWidth: 1140, margin: "0 auto", padding: "16px 20px" }}>
      <div className="topbar" style={{ position: "static", borderRadius: 12, marginBottom: 16 }}>
        <TopMark title="DSSC COMMAND DECISION TRAINER" sub="Defence Services Staff College · Multi-Domain Simulation" />
        <span style={{ flex: 1 }} />
        <nav className="nav-pills">
          <a className="on" href="?view=lobby">LOBBY</a>
          <a href="?view=analytics">ANALYTICS</a>
          <a href="?view=instructor">EXCON CONSOLE</a>
        </nav>
        <span className="stat">
          SIM SERVER: <b style={{ color: health?.ok ? "var(--ok)" : "var(--danger)" }}>
            {health?.ok ? `ONLINE (${health.store.toUpperCase()})` : "DISCONNECTED"}
          </b>
        </span>
      </div>

      {/* Hero Banner / SIH Overview Card */}
      <div className="panel" style={{ background: "linear-gradient(180deg, #faf7f0, #eae4d6)", border: "1px solid var(--line-hi)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div style={{ maxWidth: 700 }}>
            <h2 style={{ borderLeftColor: "var(--accent-hi)", margin: "0 0 8px" }}>
              SIH26248 · DECISION-MAKING UNDER DEGRADED COMMS
            </h2>
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--dim)" }}>
              One authoritative multi-domain simulation projecting <i>deliberately degraded, asynchronous views</i> to each staff appointment.
              Evaluates cognitive resistance to adversarial spoofing, latency spikes, and communication blackouts via SAGAT situational awareness probes and automated CAST scoring.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 200 }}>
            <button
              className="btn primary"
              style={{ padding: "10px 18px", fontSize: 13.5 }}
              onClick={() => {
                sound.playClick();
                window.open("?view=instructor&scenario=reach&demo=1", "_blank");
              }}
            >
              🚀 1-CLICK JURY DEMO RUN
            </button>
            <span style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--muted)", textAlign: "center" }}>
              Spawns scripted AI staff seats &amp; live injects
            </span>
          </div>
        </div>
      </div>

      {/* Scenario Directory */}
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>MISSION SCENARIO DIRECTORY</h2>
          <input
            type="text"
            placeholder="Search operational scenarios…"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            style={{ width: 240, padding: "4px 10px", fontSize: 12 }}
          />
        </div>

        <div className="lobby-grid">
          {filteredScenarios.map((s) => (
            <div key={s.id} className="lobby-card">
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <b style={{ color: "var(--text-pure)", fontSize: 16 }}>{s.title}</b>
                  <span className="mono" style={{ fontSize: 10, background: "var(--bg-deep)", padding: "2px 6px", borderRadius: 4, color: "var(--accent-hi)", fontWeight: 700 }}>
                    {s.id.toUpperCase()}
                  </span>
                </div>
                {s.briefing && (
                  <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 12px", minHeight: 48 }}>
                    {s.briefing.slice(0, 160)}{s.briefing.length > 160 ? "…" : ""}
                  </p>
                )}
                <div className="mono" style={{ fontSize: 11, color: "var(--dim)", margin: "8px 0 14px" }}>
                  ⏱️ {Math.round(s.duration_s / 60)} min · 🎯 {s.decisions} decisions · 🧠 {s.queries} SA probes
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--muted)", marginBottom: 6 }}>
                  SELECT APPOINTMENT STATION:
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {(s.seats || []).map((seat: string) => (
                    <button
                      key={seat}
                      className="btn seatbtn"
                      onClick={() => openSeat(s.id, seat)}
                      title={`Launch ${APPOINTMENT[seat] || seat.toUpperCase()} workstation`}
                    >
                      {seat.toUpperCase()}
                    </button>
                  ))}
                  <button
                    className="btn seatbtn excon"
                    onClick={() => openSeat(s.id, "instructor")}
                    title="Launch EXCON God's eye control console"
                  >
                    EXCON
                  </button>
                </div>
              </div>
            </div>
          ))}

          {filteredScenarios.length === 0 && (
            <div className="muted" style={{ padding: 24, textAlign: "center", gridColumn: "1 / -1" }}>
              Loading scenario profiles from server...
            </div>
          )}
        </div>
      </div>

      <div className="grid2">
        {/* Custom Scenario Ingestion */}
        <div className="panel">
          <h2>CUSTOM SCENARIO INGESTION</h2>
          <p className="muted" style={{ fontSize: 12.5, margin: "0 0 10px" }}>
            Upload custom military scenario decks in YAML format to test custom troop movements, deception injects, and EW link timelines.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label className="btn" style={{ cursor: "pointer", fontSize: 12 }}>
              📂 SELECT YAML FILE
              <input type="file" accept=".yaml,.yml" onChange={handleCustomYamlUpload} style={{ display: "none" }} />
            </label>
            {customYamlName && <span className="mono" style={{ fontSize: 11 }}>{customYamlName}</span>}
          </div>
          {customYamlStatus && (
            <div style={{ marginTop: 8, fontSize: 11.5, fontFamily: "var(--mono)", color: "var(--ok)", background: "#f0fdf4", padding: "6px 10px", borderRadius: 4 }}>
              {customYamlStatus}
            </div>
          )}
        </div>

        {/* Past Exercise Runs Archive */}
        <div className="panel">
          <h2>RECENT EXERCISE ARCHIVE</h2>
          {runs.length === 0 ? (
            <span className="muted" style={{ fontSize: 12 }}>No past runs recorded yet. Launch a demo or live exercise above.</span>
          ) : (
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              {runs.slice().reverse().slice(0, 8).map((r: any) => (
                <div key={r.id} className="row" style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                  <div>
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>{r.id}</span>
                    <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>{r.scenarioId}</span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <a className="btn" style={{ padding: "2px 8px", fontSize: 11 }} href={`?view=aar&run=${r.id}`} target="_blank" rel="noreferrer">
                      AAR DOSSIER
                    </a>
                    <a className="btn ghost" style={{ padding: "2px 8px", fontSize: 11 }} href={`?view=replay&run=${r.id}`} target="_blank" rel="noreferrer">
                      DVR REPLAY
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Disclaimer />
    </div>
  );
}
