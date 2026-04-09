let audioCtx: AudioContext | null = null;
let unlocked = false;
let silencedUntil: number = 0;
let silenceMode = false;

const SILENCE_KEY = "ajkmart_rider_silence_mode";

/* ── Server sync helper ─────────────────────────────────────────────────────
   Called after silence mode state changes so the server tracks it.
   Fire-and-forget: never blocks the UI, failures are silently swallowed. */
export function syncSilenceModeToServer(enabled: boolean, minutes?: number) {
  try {
    const token = localStorage.getItem("ajkmart_rider_token");
    if (!token) return;
    const BASE = typeof window !== "undefined" ? `/api` : "";
    fetch(`${BASE}/rider/silence-mode`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ silenceMode: enabled, minutes }),
    }).catch(() => {});
  } catch {}
}

export function getSilenceMode(): boolean {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem(SILENCE_KEY);
  if (stored !== null) silenceMode = stored === "on";
  return silenceMode;
}

export function setSilenceMode(enabled: boolean) {
  silenceMode = enabled;
  localStorage.setItem(SILENCE_KEY, enabled ? "on" : "off");
}

function getCtx(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

/* ── Audio unlock / lock state ───────────────────────────────────────────────
   After a user gesture we attempt to resume the AudioContext and mark it as
   unlocked.  Components can query isAudioLocked() to decide whether to show
   the "Tap to enable sounds" prompt. */

export function unlockAudio() {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();
  const osc = ctx.createOscillator();
  osc.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.001);
  unlocked = true;
}

/** Returns true when the browser autoplay policy has blocked audio playback */
export function isAudioLocked(): boolean {
  if (unlocked) return false;
  const ctx = getCtx();
  if (!ctx) return false;
  return ctx.state === "suspended";
}

export function isSilenced(): boolean {
  const stored = localStorage.getItem("sound_silenced_until");
  if (stored) {
    silencedUntil = parseInt(stored, 10);
  }
  return Date.now() < silencedUntil;
}

export function silenceFor(minutes: number) {
  silencedUntil = Date.now() + minutes * 60 * 1000;
  localStorage.setItem("sound_silenced_until", String(silencedUntil));
}

export function unsilence() {
  silencedUntil = 0;
  localStorage.removeItem("sound_silenced_until");
}

export function getSilenceRemaining(): number {
  if (!isSilenced()) return 0;
  return Math.max(0, Math.ceil((silencedUntil - Date.now()) / 60000));
}

export function playRequestSound() {
  if (isSilenced() || getSilenceMode()) return;

  try {
    const ctx = getCtx();
    if (!ctx) {
      vibrateFallback();
      return;
    }
    if (ctx.state === "suspended") {
      vibrateFallback();
      return;
    }

    const now = ctx.currentTime;

    const playTone = (freq: number, start: number, dur: number, vol: number, type: OscillatorType = "sine") => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.015);
      gain.gain.setValueAtTime(vol, now + start + dur * 0.7);
      gain.gain.linearRampToValueAtTime(0, now + start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur);
    };

    playTone(880, 0, 0.1, 0.35, "square");
    playTone(1100, 0.12, 0.1, 0.35, "square");
    playTone(1320, 0.24, 0.15, 0.3, "sine");

    playTone(880, 0.5, 0.1, 0.35, "square");
    playTone(1100, 0.62, 0.1, 0.35, "square");
    playTone(1320, 0.74, 0.15, 0.3, "sine");

    playTone(1400, 0.95, 0.2, 0.25, "sine");
  } catch {
    vibrateFallback();
  }
}

function vibrateFallback() {
  try {
    navigator?.vibrate?.([200, 100, 200]);
  } catch {}
}
