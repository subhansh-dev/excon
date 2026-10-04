// Web Audio API tactical sound generator for DSSC Trainer.
// Zero external audio files required — fully synthesized military radio acoustics and radiotelephony.

const KEY_SOUND = "dssc-sound-enabled";
const KEY_VOICE = "dssc-sound-voice-enabled";

/** Preferences survive reloads — a mute that resets every refresh is not a preference. */
function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function saveFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* storage unavailable — keep the in-memory value */
  }
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private enabled: boolean = loadFlag(KEY_SOUND, true);
  private voiceEnabled: boolean = loadFlag(KEY_VOICE, true);

  private getContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public toggle(mute?: boolean): boolean {
    if (mute !== undefined) {
      this.enabled = !mute;
    } else {
      this.enabled = !this.enabled;
    }
    saveFlag(KEY_SOUND, this.enabled);
    return this.enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public toggleVoice(voice?: boolean): boolean {
    if (voice !== undefined) {
      this.voiceEnabled = voice;
    } else {
      this.voiceEnabled = !this.voiceEnabled;
    }
    saveFlag(KEY_VOICE, this.voiceEnabled);
    return this.voiceEnabled;
  }

  public isVoiceEnabled(): boolean {
    return this.voiceEnabled;
  }

  /** Tactical Radio Click / Squelch Burst when sending or receiving military traffic */
  public playRadioSquelch(degraded = false) {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const bufferSize = ctx.sampleRate * (degraded ? 0.12 : 0.05);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(degraded ? 1200 : 2400, now);
      filter.Q.setValueAtTime(3, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(degraded ? 0.08 : 0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (degraded ? 0.12 : 0.05));

      whiteNoise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      whiteNoise.start(now);
      whiteNoise.stop(now + (degraded ? 0.12 : 0.05));
    } catch {}
  }

  /** Rotary Channel Knob Click */
  public playChannelSwitch() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.setValueAtTime(300, now + 0.02);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.04);
    } catch {}
  }

  /** Tactical Decision Alert Tone */
  public playDecisionAlert() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.setValueAtTime(880, now + 0.08);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.3);
    } catch {}
  }

  /** SAGAT Freeze Klaxon */
  public playFreezeKlaxon() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.linearRampToValueAtTime(320, now + 0.25);

      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch {}
  }

  /** Tactical Blip / Click on interaction */
  public playClick() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(1200, now);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.03);
    } catch {}
  }

  /** Warning / Blackout alert tone */
  public playWarning() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.setValueAtTime(380, now + 0.1);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.25);
    } catch {}
  }

  /** Tactical Radio Voice Transmission (SpeechSynthesis with authentic squelch) */
  public speakRadio(text: string, callsign?: string) {
    if (!this.enabled || !this.voiceEnabled) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    try {
      this.playRadioSquelch(false);
      window.speechSynthesis.cancel(); // Stop overlapping speech

      const cleanText = text.replace(/\[.*?\]/g, "").slice(0, 140);
      const utterance = new SpeechSynthesisUtterance(callsign ? `${callsign}, ${cleanText}` : cleanText);
      utterance.rate = 1.05;
      utterance.pitch = 0.95;

      utterance.onend = () => {
        this.playRadioSquelch(false);
      };

      window.speechSynthesis.speak(utterance);
    } catch {}
  }
}

export const sound = new SoundEngine();
