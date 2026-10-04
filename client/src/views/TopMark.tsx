// Ministry/DSSC-aligned masthead: abstract crest (inline SVG),
// wordmark, and the fictional-scenario disclaimer (classification reassurance).

export const APPOINTMENT: Record<string, string> = {
  cdr: "CDR (COMMANDER)",
  ops: "OPS (OPERATIONS)",
  intel: "G2 (INTELLIGENCE)",
  comms: "SIGS (COMMUNICATIONS)",
  log: "S4 (LOGISTICS)",
  instructor: "EXCON (EXERCISE CONTROL)",
};

export const APPOINTMENT_SHORT: Record<string, string> = {
  cdr: "CDR",
  ops: "OPS",
  intel: "G2",
  comms: "SIGS",
  log: "S4",
  instructor: "EXCON",
};

export function TopMark({ title, sub }: { title: string; sub?: string }) {
  return (
    <span className="topmark">
      <svg width="28" height="32" viewBox="0 0 30 34" aria-hidden="true">
        <path d="M15 1 28 7v10c0 8.5-5.5 13.4-13 16C7.5 30.4 2 25.5 2 17V7L15 1z" fill="#fdfbf7" stroke="#9e6f18" strokeWidth="1.8" />
        <path d="M15 6.5 23.5 10.5V17c0 6-3.8 9.6-8.5 11.4C10.3 26.6 6.5 23 6.5 17v-6.5L15 6.5z" fill="rgba(158,111,24,0.12)" stroke="#9e6f18" strokeWidth="1.2" />
        <circle cx="15" cy="15.5" r="3.2" fill="#9e6f18" stroke="#7c540e" strokeWidth="1.2" />
        <path d="M15 9v3M15 19v3M8.5 15.5h3M18.5 15.5h3" stroke="#9e6f18" strokeWidth="1.2" />
      </svg>
      <span className="topmark-text">
        <b>{title}</b>
        <i>{sub ?? "Defence Services Staff College · Ministry of Defence"}</i>
      </span>
    </span>
  );
}

export function Disclaimer() {
  return (
    <div className="disclaimer">
      SYNTHETIC WARFARE TRAINING SCENARIO · All units, locations, and telemetry are simulated · For training and evaluation use only
    </div>
  );
}
