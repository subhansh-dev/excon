import { useEffect, useMemo, useRef, useState } from "react";
import type { Room } from "@colyseus/sdk";
import { joinRoom, sendDecision, sendChat, sendVerify, sendProbeAnswer, sendSart } from "../net";
import { MapPanel } from "../map/MapPanel";
import { InboxView } from "./InboxView";
import { TopMark, APPOINTMENT, APPOINTMENT_SHORT, Disclaimer } from "./TopMark";
import { sound } from "../sound";

const KEY = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const MIN_WORDS = 5;

const RATIONALE_TAGS = [
  "HUMINT primary source verified",
  "ISR drone feed corroborated",
  "Pre-blackout SOP standing order",
  "Alternate net verification check",
  "Link integrity suspect / uncorroborated",
  "Casualty evacuation time-critical",
  "Fuel margin insufficient for detour",
];

const RADIO_CHANNELS = [
  { id: "all", label: "NET 1: ALL NETS (BROADCAST)", freq: "34.50 MHz" },
  { id: "cdr", label: "NET 2: HQ COMMAND", freq: "42.10 MHz" },
  { id: "ops", label: "NET 3: TACTICAL OPERATIONS", freq: "58.20 MHz" },
  { id: "intel", label: "NET 4: G2 ISR INTEL", freq: "64.00 MHz" },
  { id: "comms", label: "NET 5: SIGNALS / EW", freq: "72.40 MHz" },
  { id: "log", label: "NET 6: S4 LOGISTICS", freq: "88.10 MHz" },
];

export function SeatView({ seat }: { seat: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [status, setStatus] = useState("connecting…");
  const [view, setView] = useState<any>(null);
  const [inbox, setInbox] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [choice, setChoice] = useState("");
  const [rationale, setRationale] = useState("");
  const [confidence, setConfidence] = useState(0.75);
  const [confirming, setConfirming] = useState(false);
  const [decisionStart, setDecisionStart] = useState(0);
  const [oodaSeconds, setOodaSeconds] = useState(0);
  const [probe, setProbe] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [probeScore, setProbeScore] = useState<string>("");
  const [phase, setPhase] = useState("lobby");
  const [runId, setRunId] = useState("");
  const [tick, setTick] = useState(0);
  const [chatTo, setChatTo] = useState("all");
  const [chatText, setChatText] = useState("");
  const [sart, setSart] = useState({ demand: 4, supply: 4, understanding: 4 });
  const [sartSent, setSartSent] = useState(false);
  const [meta, setMeta] = useState<any>(null);
  const [objectives, setObjectives] = useState<string[]>([]);
  const [obstacles, setObstacles] = useState<any[]>([]);
  const [notice, setNotice] = useState("");
  const [frozen, setFrozen] = useState(false);
  const [aar, setAar] = useState<any>(null);
  const [viewTs, setViewTs] = useState(0);
  const [blip, setBlip] = useState(0);
  const [diagnosticsLink, setDiagnosticsLink] = useState<string | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceDispatchOn, setVoiceDispatchOn] = useState(true);

  useEffect(() => {
    let r: Room | null = null;
    let alive = true;
    const params = new URLSearchParams(window.location.search);
    joinRoom(seat, { scenario: params.get("scenario") || "reach" })
      .then((rm) => {
        if (!alive) { rm.leave(true); return; }
        r = rm;
        setRoom(rm);
        setStatus("connected");
        rm.onMessage("hello", (m: any) => {
          setRunId(m.runId); setInbox(m.journal ?? []); setMeta(m.scenario ?? null);
          setObjectives(m.objectives ?? []); setObstacles(m.obstacles ?? []);
        });
        rm.onMessage("view", (v: any) => {
          setView(v); setPhase(v.phase); setTick(v.tick); setViewTs(Date.now()); setAar(v.aar ?? null);
        });
        rm.onMessage("report", (m: any) => {
          setInbox((p) => [...p.slice(-59), m]);
          sound.playRadioSquelch(m.degradedBy && m.degradedBy.length > 0);
          if (voiceDispatchOn && m.text) {
            sound.speakRadio(m.text, m.from?.toUpperCase());
          }
        });
        rm.onMessage("decision_open", (d: any) => {
          setOpen(d); setChoice(""); setRationale(""); setConfirming(false);
          setDecisionStart(Date.now());
          sound.playDecisionAlert();
          if (voiceDispatchOn) {
            sound.speakRadio("High priority decision required. Acknowledge and commit order.", "EXCON");
          }
        });
        rm.onMessage("decision_ack", () => {
          setOpen(null); setConfirming(false);
          sound.playClick();
        });
        rm.onMessage("freeze", (f: any) => {
          setProbe(f); setAnswers({}); setProbeScore("");
          sound.playFreezeKlaxon();
        });
        rm.onMessage("unfreeze", () => setProbe(null));
        rm.onMessage("probe_result", (p: any) => {
          setProbe(null);
          setProbeScore(`Situational Awareness Probe Score: ${p.score}/${p.total} correct`);
          sound.playClick();
        });
        rm.onMessage("phase", (p: any) => { setPhase(p.phase); if (p.runId) setRunId(p.runId); });
        rm.onMessage("notice", (n: any) => {
          setNotice(n.text ?? "");
          setBlip(Date.now());
          sound.playWarning();
        });
        rm.onStateChange((s: any) => { setPhase(s.phase); setTick(s.tick); setFrozen(Boolean(s.freeze)); });
      })
      .catch((e) => setStatus(`connection failed: ${e.message} — verify server on port :2567`));
    return () => { alive = false; r?.leave(true); };
  }, [seat, voiceDispatchOn]);

  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => {
      setOodaSeconds(Math.round((Date.now() - decisionStart) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [open, decisionStart]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(id);
  }, [notice, blip]);

  const submitDecision = () => {
    if (!room || !open || !choice) return;
    sound.playClick();
    sendDecision(room, { decisionId: open.payload.id, choice, rationale, confidence });
  };

  const submitProbe = () => {
    if (!room || !probe) return;
    sound.playClick();
    sendProbeAnswer(room, probe.freezeId, Object.entries(answers).map(([queryId, answer]) => ({ queryId, answer })));
  };

  const submitSart = () => {
    if (!room) return;
    sound.playClick();
    sendSart(room, sart);
    setSartSent(true);
  };

  const handleSendChat = () => {
    if (room && chatText.trim()) {
      sound.playRadioSquelch(false);
      sendChat(room, chatTo, chatText.trim());
      setChatText("");
    }
  };

  const applyQuickSOP = (template: string) => {
    sound.playClick();
    setChatText(template);
  };

  const appendRationaleTag = (tag: string) => {
    sound.playClick();
    setRationale((prev) => (prev ? `${prev}. ${tag}` : tag));
  };

  /** Quick verify — sent immediately so it is counted as a verification, not just typed. */
  const sendVerifyNow = () => {
    if (!room) return;
    sound.playRadioSquelch(false);
    sendVerify(room, chatTo, "Request immediate corroboration on last contact");
  };

  /** Push-to-talk speech-to-text recognition */
  const handlePushToTalk = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech Recognition API is not supported in this browser. Please type traffic manually.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsRecordingVoice(true);
        sound.playRadioSquelch(false);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setChatText((prev) => (prev ? `${prev} ${transcript}` : transcript));
          sound.playRadioSquelch(false);
        }
      };

      recognition.onerror = () => {
        setIsRecordingVoice(false);
      };

      recognition.onend = () => {
        setIsRecordingVoice(false);
      };

      recognition.start();
    } catch {
      setIsRecordingVoice(false);
    }
  };

  const words = useMemo(() => wordCount(rationale), [rationale]);
  const canSubmit = Boolean(choice) && words >= MIN_WORDS;
  const probeTotal = probe?.queries?.length ?? 0;
  const probeAnswered = probe ? probe.queries.filter((q: any) => answers[q.id]).length : 0;

  const stale = viewTs > 0 && Date.now() - viewTs > 4500;

  return (
    <div>
      <div className="topbar">
        <TopMark
          title={meta?.title || "TACTICAL COMMAND STATION"}
          sub={`EXERCISE ${runId || "—"} · ${APPOINTMENT[seat] ?? seat.toUpperCase()} · DSSC`}
        />
        <span className="seat">{APPOINTMENT_SHORT[seat] ?? seat.toUpperCase()}</span>
        <span className="stat">RUN <b>{runId || "—"}</b></span>
        <span className="stat">SIM T+<b>{view ? Math.round(view.t) : 0}s</b></span>
        {view?.timeScale && view.timeScale !== 1 && <span className="stat">SPEED <b>×{view.timeScale}</b></span>}
        <span className="stat">TICK <b>{tick}</b></span>
        <span className="stat">
          IIS <b>{view ? `${(Number(view.iis ?? 1) * 100).toFixed(1)}%` : "—"}</b>
        </span>
        {aar && <span className="stat" style={{ color: "var(--ok)", fontWeight: 700 }}>AAR READY</span>}
        <span className="stat" style={{ fontSize: 10 }}>{status}</span>
        {stale && <span className="stat" style={{ color: "var(--warn)", fontWeight: 700 }}>⚠️ STALE FEED</span>}
        <span style={{ flex: 1 }} />
        <button
          className={`btn ghost ${voiceDispatchOn ? "primary" : ""}`}
          style={{ padding: "3px 8px", fontSize: 10 }}
          onClick={() => {
            setVoiceDispatchOn(!voiceDispatchOn);
            sound.playClick();
          }}
          title="Toggle AI Radio Voice Announcements"
        >
          {voiceDispatchOn ? "📻 VOICE DISPATCH: ON" : "📻 VOICE DISPATCH: OFF"}
        </button>
        <a className="btn ghost" href="?view=lobby" target="_blank" rel="noreferrer">LOBBY</a>
      </div>

      {frozen && !probe && (
        <div className="banner warn">
          ⏸ SIMULATION HELD BY EXCON — STAND BY, ALL TIMERS ARE PAUSED
        </div>
      )}

      {(() => {
        const ls = view?.links ?? [];
        if (ls.some((l: any) => !l.active)) {
          return (
            <div className="banner bad">
              ⚠️ COMMS BLACKOUT ON ACTIVE NETS — TRANSMISSIONS ARE LOST // ADAPT UNDER DEGRADATION
            </div>
          );
        }
        const worst = ls.length ? ls.reduce((a: any, b: any) => (a.integrity <= b.integrity ? a : b)) : null;
        if (worst && worst.integrity < 0.65) {
          return (
            <div className="banner warn">
              ⚡ COMMS SEVERELY DEGRADED — EXPECT LATENCY SPIKES, DROPOUTS & CONTRADICTORY FEEDS
            </div>
          );
        }
        return null;
      })()}

      {notice && (
        <div className="panel" style={{ margin: "10px 16px 0", borderLeft: "4px solid var(--accent)", background: "#fffbeb" }}>
          <b style={{ color: "var(--accent-hi)", fontFamily: "var(--mono)" }}>EXCON ADJUTANT BROADCAST:</b> {notice}
        </div>
      )}

      <div className="layout">
        <div>
          {meta && (
            <section className="brief">
              <div className="brief-class">RESTRICTED // TRAINING SCENARIO BRIEFING</div>
              <h1 className="brief-title">{meta.title}</h1>
              <div className="brief-meta">
                <span>SCENARIO: <b>{meta.id}</b></span>
                <span>APPOINTMENT: <b>{APPOINTMENT[seat] ?? seat.toUpperCase()}</b></span>
                <span>DURATION: <b>{Math.round((meta.duration_s ?? 0) / 60)} MIN</b></span>
                <span>DECEPTION RESISTANCE BENCHMARK</span>
              </div>
              <div className="brief-block">
                <h3>Operational Situation</h3>
                <p>{meta.briefing || meta.title}</p>
              </div>
              {objectives.length > 0 && (
                <div className="brief-block">
                  <h3>Mission Objectives</h3>
                  <ol className="obj-list">
                    {objectives.map((o, i) => <li key={i}>{o}</li>)}
                  </ol>
                </div>
              )}
            </section>
          )}

          {probe ? (
            <div className="blanked">
              ⚡ COGNITIVE SA PROBE ACTIVE — ALL MAPS &amp; TELEMETRY BLANKED
              <span>Answer situational questions from operational memory · Nets are silenced during freeze</span>
            </div>
          ) : (
            <>
              <div className="panel">
                <h2>COMMON OPERATING PICTURE (PERCEIVED THEATER VIEW)</h2>
                {view?.links && view.links.length > 0 && (
                  <div className="netstrip">
                    {view.links.map((l: any) => {
                      const cls = !l.active ? "bad" : l.integrity < 0.6 || l.loss_pct > 30 ? "warn" : "ok";
                      return (
                        <span
                          key={l.id}
                          className={`net ${cls}`}
                          style={{ cursor: "pointer" }}
                          onClick={() => {
                            setDiagnosticsLink(l.id === diagnosticsLink ? null : l.id);
                            sound.playClick();
                          }}
                          title="Click for Net Diagnostics"
                        >
                          {l.id} · {l.active ? `${l.latency_ms}ms / ${l.loss_pct}% loss / ${(l.integrity * 100).toFixed(0)}% int` : "BLACKOUT"}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Net Diagnostics Card */}
                {diagnosticsLink && (
                  <div className="panel-recessed" style={{ marginBottom: 10, fontSize: 11, fontFamily: "var(--mono)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <b style={{ color: "var(--accent-hi)" }}>DIAGNOSTICS FOR NET: {diagnosticsLink}</b>
                      <button className="btn ghost" style={{ padding: "1px 5px", fontSize: 9 }} onClick={() => setDiagnosticsLink(null)}>✕</button>
                    </div>
                    {(() => {
                      const l = (view?.links ?? []).find((x: any) => x.id === diagnosticsLink);
                      if (!l) return <span>Link data unavailable</span>;
                      return (
                        <div>
                          Status: <b>{l.active ? "ONLINE" : "OFFLINE (BLACKOUT)"}</b> · Latency: <b>{l.latency_ms}ms</b> · Loss: <b>{l.loss_pct}%</b> · Signal Integrity: <b>{(l.integrity * 100).toFixed(1)}%</b>
                          <div style={{ marginTop: 4, color: "var(--dim)" }}>
                            Assessment: {l.integrity < 0.5 ? "Adversary spoofing / corruption likely" : l.latency_ms > 2000 ? "Severe EW propagation delay" : "Net operating within nominal bounds"}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                <MapPanel
                  units={view?.units ?? []} assets={view?.assets ?? []}
                  obstacles={obstacles} hot={view?.hot ?? []} links={view?.links ?? []}
                  geo={meta?.geo ?? null}
                />
              </div>

              {/* Tactical Radio Dispatcher */}
              <div className="panel">
                <h2>TACTICAL RADIO DISPATCH (MULTI-CHANNEL TRANSCEIVER)</h2>

                {/* Tactical Channel Tuner */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {RADIO_CHANNELS.map((ch) => (
                    <button
                      key={ch.id}
                      className={`btn ghost ${chatTo === ch.id ? "primary" : ""}`}
                      style={{ padding: "4px 10px", fontSize: 11, fontFamily: "var(--mono)" }}
                      onClick={() => {
                        setChatTo(ch.id);
                        sound.playChannelSwitch();
                      }}
                    >
                      {ch.label} [{ch.freq}]
                    </button>
                  ))}
                </div>

                <div className="quick-comms">
                  <button onClick={sendVerifyNow}>
                    ⚡ VERIFY REPORT
                  </button>
                  <button onClick={() => applyQuickSOP("SITREP REQUEST // All stations report position and fuel status")}>
                    📋 SITREP REQUEST
                  </button>
                  <button onClick={() => applyQuickSOP("HOLD POSITION // Suspected ambush corridor ahead")}>
                    🛑 HOLD POSITION
                  </button>
                  <button onClick={() => applyQuickSOP("COMMS CHECK // Acknowledge on alternate channel")}>
                    📻 COMMS CHECK
                  </button>
                  <button onClick={() => applyQuickSOP("SPOTREP // Unconfirmed movement spotted on flank")}>
                    🎯 SPOTREP
                  </button>
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <input
                    type="text"
                    placeholder={`Transmit on ${RADIO_CHANNELS.find((c) => c.id === chatTo)?.freq || "NET"}…`}
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSendChat(); }}
                    style={{ flex: 1 }}
                  />
                  <button
                    className={`btn ${isRecordingVoice ? "danger" : "ghost"}`}
                    onClick={handlePushToTalk}
                    title="Push To Talk (Speech to Text)"
                  >
                    {isRecordingVoice ? "🔴 RECORDING..." : "🎙️ PTT VOICE"}
                  </button>
                  <button className="btn primary" onClick={handleSendChat}>
                    TRANSMIT
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div>
          {/* Active Decision Point Card */}
          {open && !probe && (
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                <h3 style={{ margin: 0 }}>DECISION POINT REQUIRED</h3>
                <span className="mono" style={{ fontSize: 11, background: "#fee2e2", color: "#991b1b", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>
                  ⏱️ OODA: {oodaSeconds}s
                </span>
              </div>
              <p className="prompt">{open.text}</p>

              <div style={{ marginBottom: 12 }}>
                {open.payload.options.map((o: string, i: number) => {
                  const r = (open.payload.risk ?? [])[i];
                  return (
                    <button
                      key={o}
                      className={`opt-row ${choice === o ? "sel" : ""}`}
                      onClick={() => {
                        setChoice(o);
                        sound.playClick();
                      }}
                      disabled={confirming}
                    >
                      <span className="opt-key">{KEY[i] ?? i + 1}</span>
                      <span style={{ flex: 1 }}>{o}</span>
                      {r && <span className={`risk ${r}`}>{r.toUpperCase()} RISK</span>}
                    </button>
                  );
                })}
              </div>

              <label className="lbl">Decision Confidence Level</label>
              <input
                type="range" min={0} max={1} step={0.05}
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
              />
              <div className="statline">
                <span>
                  Confidence: <b>{Math.round(confidence * 100)}%</b>
                  {" — "}
                  <span style={{ color: confidence >= 0.8 ? "var(--ok)" : confidence >= 0.5 ? "var(--warn)" : "var(--danger)" }}>
                    {confidence >= 0.8 ? "HIGH ASSURANCE" : confidence >= 0.5 ? "PROBABLE ASSESSMENT" : "LOW CONFIDENCE / ESTIMATE"}
                  </span>
                </span>
              </div>

              <label className="lbl">Operational Rationale (Debrief Record)</label>
              <div className="quick-comms" style={{ marginBottom: 6 }}>
                {RATIONALE_TAGS.slice(0, 4).map((tag) => (
                  <button key={tag} onClick={() => appendRationaleTag(tag)}>
                    + {tag}
                  </button>
                ))}
              </div>
              <textarea
                value={rationale}
                disabled={confirming}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Detail why you chose this course of action. What intelligence or reports did you rely on? What alternate indicators did you reject?"
              />
              <div className={`wc ${words >= MIN_WORDS ? "ok" : rationale ? "bad" : ""}`}>
                {words} / {MIN_WORDS} WORDS {words >= MIN_WORDS ? "· READY FOR COMMITMENT" : "· MINIMUM REQUIRED FOR DOCTRINAL AUDIT"}
              </div>

              {!confirming ? (
                <div style={{ marginTop: 12 }}>
                  <button
                    className="btn primary"
                    disabled={!canSubmit}
                    onClick={() => {
                      setConfirming(true);
                      sound.playClick();
                    }}
                    style={{ width: "100%", padding: "10px" }}
                  >
                    REVIEW &amp; LOCK DECISION
                  </button>
                </div>
              ) : (
                <div className="confirm">
                  <b>COMMIT ORDER CONFIRMATION:</b> You are committing <b>"{choice}"</b> at {Math.round(confidence * 100)}% confidence. This record is permanently stamped into the immutable exercise timeline.
                  <div className="row" style={{ marginTop: 10 }}>
                    <button className="btn primary" onClick={submitDecision}>
                      CONFIRM &amp; EXECUTE ORDER
                    </button>
                    <button className="btn ghost" onClick={() => setConfirming(false)}>
                      EDIT RATIONALE
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SAGAT Freeze Probe Modal */}
          {probe && (
            <div className="card freeze">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>SA PROBE // SITUATIONAL RECALL</h3>
                <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-hi)" }}>
                  {probeAnswered} / {probeTotal} ANSWERED
                </span>
              </div>
              <p className="muted" style={{ margin: "4px 0 10px", fontSize: 12.5 }}>
                Answer from memory based on telemetry observed prior to freeze.
              </p>
              <div className="prog">
                {probe.queries.map((q: any) => <i key={q.id} className={answers[q.id] ? "done" : ""} />)}
              </div>

              {probe.queries.map((q: any) => (
                <div key={q.id} style={{ marginBottom: 14 }}>
                  <p style={{ margin: "0 0 6px", fontWeight: 600, fontSize: 13 }}>
                    <span className={`lvl l${q.level}`}>LEVEL {q.level}</span>{" "}
                    <span className="mono muted" style={{ fontSize: 11 }}>[{q.id}]</span>{" "}
                    {q.text}
                  </p>
                  {q.options.map((o: string, i: number) => (
                    <button
                      key={o}
                      className={`opt-row ${answers[q.id] === o ? "sel" : ""}`}
                      onClick={() => {
                        setAnswers((a) => ({ ...a, [q.id]: o }));
                        sound.playClick();
                      }}
                    >
                      <span className="opt-key">{KEY[i] ?? i + 1}</span>
                      <span>{o}</span>
                    </button>
                  ))}
                </div>
              ))}

              <div className="row" style={{ marginTop: 12 }}>
                <button
                  className="btn primary"
                  disabled={probeAnswered < probeTotal}
                  onClick={submitProbe}
                  style={{ flex: 1, padding: "10px" }}
                >
                  SUBMIT SITUATIONAL ASSESSMENT
                </button>
              </div>
            </div>
          )}

          {probeScore && (
            <div className="panel" style={{ background: "#f0fdf4", borderLeft: "4px solid var(--ok)", color: "#166534" }}>
              <b>{probeScore}</b>
            </div>
          )}

          {phase === "done" && !sartSent && (
            <div className="card">
              <h3>EXERCISE CONCLUDED — SART POST-FLIGHT RATING</h3>
              <p className="muted" style={{ fontSize: 12.5 }}>
                Rate your perceived situational awareness under degradation (1 = Low, 7 = High).
              </p>
              {([
                ["demand", "Mental DEMAND — Cognitive complexity and task difficulty"],
                ["supply", "Mental SUPPLY — Cognitive resources and attentional bandwidth"],
                ["understanding", "UNDERSTANDING — Grasp of ground reality vs adversary deception"],
              ] as const).map(([k, label]) => (
                <div key={k} style={{ marginBottom: 8 }}>
                  <label className="lbl">{label}: {sart[k]}/7</label>
                  <input
                    type="range" min={1} max={7} step={1}
                    value={sart[k]}
                    onChange={(e) => setSart((s) => ({ ...s, [k]: Number(e.target.value) }))}
                  />
                </div>
              ))}
              <div style={{ marginTop: 12 }} className="row">
                <button className="btn primary" onClick={submitSart}>
                  SUBMIT SART RATING
                </button>
                {runId && (
                  <a className="btn" href={`?view=aar&run=${runId}`} target="_blank" rel="noreferrer">
                    OPEN COMPREHENSIVE AAR
                  </a>
                )}
              </div>
            </div>
          )}

          {!probe && (
            <div className="panel">
              <h2>RADIO TRAFFIC INBOX</h2>
              <InboxView
                messages={inbox}
                onQuote={(q) => {
                  setChatText(q);
                  sound.playClick();
                }}
              />
            </div>
          )}
        </div>
      </div>
      <Disclaimer />
    </div>
  );
}
