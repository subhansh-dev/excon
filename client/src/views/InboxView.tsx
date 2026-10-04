import { useState, useMemo } from "react";
import { sound } from "../sound";

interface Msg {
  id: string;
  from: string;
  to?: string;
  kind: string;
  text: string;
  t_recv: number;
  degradedBy?: string[];
  meta?: { source: string; confidence: number; integrity: number; age_s: number; origin?: string };
}

/** Same staleness line the AAR and counterfactual price defects at (shared/metrics consumers use 60s). */
const STALE_AGE_S = 60;

/** Per-seat military message traffic log with channel filters and search */
export function InboxView({
  messages, showOrigin = false, onQuote,
}: {
  messages: Msg[];
  showOrigin?: boolean;
  onQuote?: (text: string) => void;
}) {
  const [filter, setFilter] = useState<string>("ALL");
  const [query, setQuery] = useState<string>("");

  const filtered = useMemo(() => {
    let list = [...messages].reverse();
    if (filter === "HQ") {
      list = list.filter((m) => /hq|cdr|excon/i.test(m.meta?.source || m.from || ""));
    } else if (filter === "INTEL") {
      list = list.filter((m) => /intel|drone|isr|hum|recon/i.test(m.meta?.source || m.from || ""));
    } else if (filter === "OPS") {
      list = list.filter((m) => /ops|patrol|convoy|ambulance|alpha|bravo/i.test(m.meta?.source || m.from || ""));
    } else if (filter === "LOG") {
      list = list.filter((m) => /log|supply|fuel|depot|medevac/i.test(m.meta?.source || m.from || ""));
    } else if (filter === "ALERTS") {
      list = list.filter((m) => m.kind === "alert" || (m.degradedBy && m.degradedBy.length > 0) || (m.meta?.age_s ?? 0) >= STALE_AGE_S);
    }

    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((m) => m.text?.toLowerCase().includes(q) || m.from?.toLowerCase().includes(q));
    }
    return list;
  }, [messages, filter, query]);

  return (
    <div>
      <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {["ALL", "HQ", "INTEL", "OPS", "LOG", "ALERTS"].map((f) => (
          <button
            key={f}
            className={`btn ghost ${filter === f ? "primary" : ""}`}
            style={{ padding: "2px 8px", fontSize: 10 }}
            onClick={() => {
              setFilter(f);
              sound.playClick();
            }}
          >
            {f} {f === "ALL" ? `(${messages.length})` : ""}
          </button>
        ))}
        <input
          type="text"
          placeholder="Filter traffic..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: 130, padding: "2px 6px", fontSize: 11, marginLeft: "auto" }}
        />
      </div>

      <div className="inbox">
        {filtered.length === 0 ? (
          <div className="muted" style={{ padding: 12, textAlign: "center", fontSize: 12 }}>
            {messages.length === 0 ? "No radio traffic recorded yet. Listening to active nets..." : "No messages match filter."}
          </div>
        ) : (
          filtered.map((m) => {
            const isSpoof = showOrigin && m.meta?.origin === "spoof";
            return (
              <div key={m.id} className={`msg ${isSpoof ? "spoof" : ""}`}>
                <div className="msg-head">
                  <span className={`src ${/EXCON|HQ|OPS|CDR/.test(m.meta?.source ?? m.from) ? "cmd" : ""}`}>
                    {m.meta?.source ?? m.from}
                  </span>
                  <span className="t">t+{Math.round(m.t_recv)}s</span>
                </div>
                <div className="msg-text">{m.text}</div>
                <div className="chips">
                  {m.meta?.confidence !== undefined && (
                    <span className="chip">CONF {Math.round(m.meta.confidence * 100)}%</span>
                  )}
                  {m.meta?.age_s !== undefined && (
                    <span className={`chip ${(m.meta.age_s >= STALE_AGE_S) ? "warn" : ""}`}>
                      AGE {m.meta.age_s}s {(m.meta.age_s >= STALE_AGE_S) ? "· STALE" : ""}
                    </span>
                  )}
                  {(m.degradedBy ?? []).map((d) => (
                    <span key={d} className="chip warn">⚡ {d.toUpperCase()}</span>
                  ))}
                  {showOrigin && m.meta?.origin && (
                    <span className="chip origin">ORIGIN: {m.meta.origin.toUpperCase()}</span>
                  )}
                  {onQuote && (
                    <button
                      className="btn ghost"
                      style={{ padding: "0 5px", fontSize: 9, marginLeft: "auto" }}
                      onClick={() => {
                        onQuote(`REF [${m.from}]: ${m.text}`);
                        sound.playClick();
                      }}
                    >
                      QUOTE
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
