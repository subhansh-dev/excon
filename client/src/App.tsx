import { useEffect, useMemo, useState } from "react";
import { SeatView } from "./views/SeatView";
import { InstructorView } from "./views/InstructorView";
import { AARView } from "./views/AARView";
import { LobbyView } from "./views/LobbyView";
import { HomeView } from "./views/HomeView";
import { AnalyticsView } from "./views/AnalyticsView";
import { ReplayView } from "./views/ReplayView";
import { sound } from "./sound";

const SEATS = ["cdr", "ops", "intel", "comms", "log"];

/** Tier-1 governance strip: classification left/centre/right, live clock, server state & audio toggle. */
function GovBar() {
  const [up, setUp] = useState(true);
  const [clock, setClock] = useState("");
  const [soundOn, setSoundOn] = useState(sound.isEnabled());

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(
        `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}Z`,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    const probe = () =>
      fetch("/api/health")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then(() => alive && setUp(true))
        .catch(() => alive && setUp(false));
    probe();
    const id = setInterval(probe, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const toggleSound = () => {
    const next = sound.toggle();
    setSoundOn(next);
    if (next) sound.playClick();
  };

  return (
    <div className="govbar">
      <span>SIH26248 · DSSC COMMAND TRAINER v2.0</span>
      <span className="cls">RESTRICTED // MULTI-DOMAIN EXERCISE</span>
      <span className="right">
        <button
          className="sound-toggle-btn"
          onClick={toggleSound}
          title={soundOn ? "Mute Tactical Audio FX" : "Enable Tactical Audio FX"}
        >
          {soundOn ? "🔊 AUDIO FX ON" : "🔇 MUTED"}
        </button>
        <span>{clock}</span>
        <span>
          <i className={`dot${up ? "" : " off"}`} />
          {up ? "SIM ENGINE ACTIVE" : "SIM OFFLINE"}
        </span>
      </span>
    </div>
  );
}

export default function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const view = (params.get("view") || "home").toLowerCase();
  const run = params.get("run") || "";

  const page =
    view === "aar" ? <AARView runId={run} />
    : view === "replay" ? <ReplayView runId={run} />
    : view === "instructor" || view === "excon" ? <InstructorView />
    : view === "analytics" ? <AnalyticsView />
    : view === "lobby" ? <LobbyView />
    : SEATS.includes(view) ? <SeatView seat={view} />
    : <HomeView />;

  return (
    <>
      <GovBar />
      {page}
    </>
  );
}
