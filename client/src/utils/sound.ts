import tileTapUrl from '../assets/sounds/freesound_community-thwump-85836.mp3';

/**
 * sound.ts — Racehorse Dominoes audio synthesis
 *
 * Self-contained Web Audio API sound engine. No external dependencies.
 *
 * Signal chain per sound event:
 *
 *   [OscillatorNode (body)]  ─┐
 *                              ├─→ [GainNode (envelope)] → [BiquadFilter (lowpass)] → [GainNode (master)] → destination
 *   [BufferSourceNode (noise)] ┘
 *
 * The lowpass filter cuts the tinny digital high-end, retaining the
 * 'meat' of each impact. Noise mixed at the attack start simulates tile
 * friction on felt. Pitch and gain are randomised ±2% per call to prevent
 * the machine-gun effect.
 *
 * Browser autoplay policy: AudioContext is created lazily on the first
 * call after a user gesture. No explicit unlock button needed.
 *
 * Mute state is owned by App.tsx and passed in — this module is stateless.
 */

// ─── Singleton AudioContext ────────────────────────────────────────────────

let ctx: AudioContext | null = null;
let tileTapAudio: HTMLAudioElement | null = null;

function getCtx(): AudioContext | null {
  if (!ctx) {
    ctx = new AudioContext();
  }
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
    if (ctx.state === 'suspended') {
      return null;
    }
  }
  return ctx;
}

function getTileTapAudio(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!tileTapAudio) {
    tileTapAudio = new Audio(tileTapUrl);
    tileTapAudio.preload = 'auto';
  }
  return tileTapAudio;
}

// ─── Randomisation helper ──────────────────────────────────────────────────

/** Returns a multiplier uniformly distributed in [1 - range, 1 + range]. */
function jitter(range = 0.02): number {
  return 1 + (Math.random() * 2 - 1) * range;
}

// ─── Core builder ─────────────────────────────────────────────────────────

/**
 * buildThwack — constructs and fires one complete percussive sound event.
 *
 * @param ac           AudioContext
 * @param now          ac.currentTime at call site
 * @param bodyFreq     Oscillator centre frequency (Hz) — jittered ±2%
 * @param oscType      OscillatorNode waveform
 * @param pitchDrop    How far the pitch falls by end of decay (ratio, e.g. 0.55)
 * @param peakGain     Oscillator envelope peak (0–1)
 * @param decayTime    Oscillator decay duration (seconds)
 * @param lpFreq       Lowpass filter cutoff (Hz) — primary warmth control
 * @param lpQ          Lowpass filter resonance (1 = neutral, >1 adds colour)
 * @param noiseGain    White noise mix level at attack (0 = no noise)
 * @param noiseDuration White noise burst length (seconds, typically 0.015–0.025)
 * @param startDelay   Offset from `now` (seconds) — for layering
 */
function buildThwack(
  ac: AudioContext,
  now: number,
  bodyFreq: number,
  oscType: OscillatorType,
  pitchDrop: number,
  peakGain: number,
  decayTime: number,
  lpFreq: number,
  lpQ: number,
  noiseGain: number,
  noiseDuration: number,
  startDelay = 0,
): void {
  const t0 = now + startDelay;

  // ── Lowpass filter (shared by osc + noise) ───────────────────────────────
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(lpFreq, t0);
  lp.Q.setValueAtTime(lpQ, t0);

  // ── Master gain (post-filter) ─────────────────────────────────────────────
  const master = ac.createGain();
  master.gain.setValueAtTime(1.0, t0);

  lp.connect(master);
  master.connect(ac.destination);

  // ── Oscillator body ───────────────────────────────────────────────────────
  const pitchedFreq = bodyFreq * jitter(0.02); // ±2% human variation

  const osc = ac.createOscillator();
  osc.type = oscType;
  osc.frequency.setValueAtTime(pitchedFreq, t0);
  // Pitch drop simulates energy leaving the struck object
  osc.frequency.exponentialRampToValueAtTime(pitchedFreq * pitchDrop, t0 + decayTime);

  const oscGain = ac.createGain();
  // Instant attack, exponential decay.
  // Floor is 0.001 not 0: exponentialRamp to exactly 0 is undefined in the
  // Web Audio spec and causes a discontinuity pop in some browsers.
  // A 150ms soft tail (ramp continuing past decayTime) ensures no abrupt cutoff.
  oscGain.gain.setValueAtTime(peakGain * jitter(0.02), t0);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + decayTime + 0.06);

  osc.connect(oscGain);
  oscGain.connect(lp);

  osc.start(t0);
  osc.stop(t0 + decayTime + 0.01);

  // ── White noise friction burst ────────────────────────────────────────────
  // Simulates the tile surface scraping across felt at the moment of contact.
  // A short burst mixed in at the very start gives the sound its tactile
  // 'grain' — without it the oscillator alone sounds purely synthetic.
  if (noiseGain > 0 && noiseDuration > 0) {
    const bufLen = Math.ceil(ac.sampleRate * (noiseDuration + 0.01));
    const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ac.createBufferSource();
    noise.buffer = buf;

    const noiseEnv = ac.createGain();
    // Must anchor at t0 before ramping — prevents the undefined-initial-value pop
    noiseEnv.gain.setValueAtTime(noiseGain, t0);
    // Ramp to 0.001 not 0: exponentialRamp to exactly 0 is undefined in the
    // Web Audio spec and causes a discontinuity click in some browsers.
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, t0 + noiseDuration);

    noise.connect(noiseEnv);
    noiseEnv.connect(lp); // noise shares the same lowpass — keeps it warm

    noise.start(t0);
    noise.stop(t0 + noiseDuration + 0.01);
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

const soundQueue: Array<() => void> = [];
let soundQueueRunning = false;
const MAX_SOUND_QUEUE_DEPTH = 3;

export function queueSound(fn: () => void, delayMs = 0): void {
  // Drop oldest entry if the queue is backing up while playback is paused.
  while (soundQueue.length >= MAX_SOUND_QUEUE_DEPTH) {
    soundQueue.shift();
  }

  soundQueue.push(() => {
    setTimeout(() => {
      fn();
      soundQueueRunning = false;
      if (soundQueue.length > 0) {
        soundQueueRunning = true;
        const next = soundQueue.shift()!;
        next();
      }
    }, delayMs);
  });
  if (!soundQueueRunning) {
    soundQueueRunning = true;
    const next = soundQueue.shift()!;
    next();
  }
}

export type TileSoundType = 'standard' | 'slam' | 'deal';

/**
 * Play a synthesized tile sound.
 *
 * @param type    'standard' | 'slam' | 'deal'
 * @param isMuted if true, returns immediately
 *
 * ── Sound design ─────────────────────────────────────────────────────────
 *
 * standard — Weighted ivory thwack.
 *   Two layers: a bright attack click (triangle, 900 Hz) + a woody body
 *   resonance (sine, 180 Hz). Both pass through a 900 Hz lowpass.
 *   Noise burst (20 ms) adds felt-contact friction at the instant of impact.
 *   Pitch drops to 55% over 90 ms — ivory piece settling on baize.
 *
 * slam — Heavy bone-on-table thud.
 *   Low oscillator body (triangle, 320 Hz) with a longer 160 ms decay,
 *   a short mid-attack click (triangle, 600 Hz, 60 ms), and a heavier
 *   noise burst (30 ms). Lowpass cut at 700 Hz removes all high-end —
 *   the sound is deliberately muffled, like a domino slapped face-down.
 *
 * deal — Soft paper/tile flick.
 *   Single very quiet layer (triangle, 2400 Hz) through a 1200 Hz lowpass.
 *   20 ms decay, minimal noise. Barely perceptible — just enough to give
 *   each staggered deal tick a tactile anchor.
 */
export function playTileSound(type: TileSoundType, isMuted: boolean): void {
  if (isMuted) return;

  const sample = getTileTapAudio();
  if (sample) {
    try {
      const instance = sample.cloneNode() as HTMLAudioElement;
      instance.volume = type === 'slam' ? 0.78 : type === 'deal' ? 0.42 : 0.64;
      void instance.play();
      return;
    } catch {
      // Fall back to synth if sample playback fails.
    }
  }

  let ac: AudioContext;
  try {
    const activeCtx = getCtx();
    if (!activeCtx) return;
    ac = activeCtx;
  } catch {
    return; // No audio device — fail silently
  }

  const now = ac.currentTime;

  switch (type) {
    case 'standard': {
      // Sharp wooden clack — bright attack + resonant body

      // Layer 1: sharp high click on impact
      buildThwack(
        ac,
        now,
        /* bodyFreq */ 1100,
        /* oscType */ 'triangle',
        /* pitchDrop */ 0.45,
        /* peakGain */ 0.32,
        /* decayTime */ 0.038,
        /* lpFreq */ 2200,
        /* lpQ */ 1.4,
        /* noiseGain */ 0.38,
        /* noiseDur */ 0.014,
        /* startDelay */ 0,
      );

      // Layer 2: woody mid-body resonance
      buildThwack(
        ac,
        now,
        /* bodyFreq */ 420,
        /* oscType */ 'triangle',
        /* pitchDrop */ 0.52,
        /* peakGain */ 0.26,
        /* decayTime */ 0.085,
        /* lpFreq */ 1100,
        /* lpQ */ 1.2,
        /* noiseGain */ 0.14,
        /* noiseDur */ 0.018,
        /* startDelay */ 0.004,
      );

      // Layer 3: short low thud for weight
      buildThwack(
        ac,
        now,
        /* bodyFreq */ 95,
        /* oscType */ 'sine',
        /* pitchDrop */ 0.58,
        /* peakGain */ 0.18,
        /* decayTime */ 0.065,
        /* lpFreq */ 280,
        /* lpQ */ 0.9,
        /* noiseGain */ 0,
        /* noiseDur */ 0,
        /* startDelay */ 0.006,
      );
      break;
    }

    case 'slam': {
      // Heavier domino slap.
      const slamDecay1 = 0.145 + (Math.random() * 0.02 - 0.01);
      buildThwack(
        ac,
        now,
        /* bodyFreq */ 230,
        /* oscType */ 'triangle',
        /* pitchDrop */ 0.46,
        /* peakGain */ 0.48,
        /* decayTime */ slamDecay1,
        /* lpFreq */ 560,
        /* lpQ */ 0.72,
        /* noiseGain */ 0.34,
        /* noiseDur */ 0.024,
        /* startDelay */ 0,
      );
      // Sharp click on impact.
      const slamDecay2 = 0.048 + (Math.random() * 0.012 - 0.006);
      buildThwack(
        ac,
        now,
        /* bodyFreq */ 860,
        /* oscType */ 'triangle',
        /* pitchDrop */ 0.63,
        /* peakGain */ 0.18,
        /* decayTime */ slamDecay2,
        /* lpFreq */ 920,
        /* lpQ */ 0.8,
        /* noiseGain */ 0.12,
        /* noiseDur */ 0.012,
        /* startDelay */ 0,
      );
      break;
    }

    case 'deal': {
      // Soft draw/deal tick.
      buildThwack(
        ac,
        now,
        /* bodyFreq */ 1600,
        /* oscType */ 'triangle',
        /* pitchDrop */ 0.7,
        /* peakGain */ 0.07,
        /* decayTime */ 0.028,
        /* lpFreq */ 980,
        /* lpQ */ 0.8,
        /* noiseGain */ 0.04,
        /* noiseDur */ 0.01,
        /* startDelay */ 0,
      );
      break;
    }
  }
}

export function playScoreSound(points: number, isMuted: boolean): void {
  if (isMuted) return;
  let ac: AudioContext;
  try {
    const activeCtx = getCtx();
    if (!activeCtx) return;
    ac = activeCtx;
  } catch {
    return;
  }

  const pingCount = points >= 15 ? 3 : points >= 10 ? 2 : 1;

  // Arcade chime notes — ascending major chord
  const notes = [523, 659, 784]; // C5, E5, G5

  for (let i = 0; i < pingCount; i++) {
    const t = ac.currentTime + i * 0.12;
    const freq = notes[i];

    // Clean sine oscillator
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);

    // Second oscillator one octave up at low volume for shimmer
    const osc2 = ac.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2, t);

    // ADSR envelope
    const env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.28, t + 0.01); // fast attack
    env.gain.linearRampToValueAtTime(0.22, t + 0.04); // slight decay
    env.gain.linearRampToValueAtTime(0.18, t + 0.12); // sustain
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.35); // release

    // Shimmer gain much quieter
    const env2 = ac.createGain();
    env2.gain.setValueAtTime(0, t);
    env2.gain.linearRampToValueAtTime(0.06, t + 0.01);
    env2.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    osc.connect(env);
    osc2.connect(env2);
    env.connect(ac.destination);
    env2.connect(ac.destination);

    osc.start(t);
    osc.stop(t + 0.4);
    osc2.start(t);
    osc2.stop(t + 0.25);
  }
}

export function playDrawSound(isMuted: boolean): void {
  if (isMuted) return;

  let ac: AudioContext;
  try {
    const activeCtx = getCtx();
    if (!activeCtx) return;
    ac = activeCtx;
  } catch {
    return;
  }
  const now = ac.currentTime;

  buildThwack(ac, now, 280, 'triangle', 0.62, 0.12, 0.07, 420, 0.8, 0.28, 0.035, 0);
}

export function playHandWinSound(isMuted: boolean): void {
  if (isMuted) return;

  let ac: AudioContext;
  try {
    const activeCtx = getCtx();
    if (!activeCtx) return;
    ac = activeCtx;
  } catch {
    return;
  }
  const now = ac.currentTime;

  buildThwack(ac, now, 440, 'sine', 0.98, 0.2, 0.18, 2000, 1.0, 0, 0, 0);
  buildThwack(ac, now, 660, 'sine', 0.98, 0.18, 0.22, 2000, 1.0, 0, 0, 0.14);
}

export function playHandLoseSound(isMuted: boolean): void {
  if (isMuted) return;

  let ac: AudioContext;
  try {
    const activeCtx = getCtx();
    if (!activeCtx) return;
    ac = activeCtx;
  } catch {
    return;
  }
  const now = ac.currentTime;

  buildThwack(ac, now, 440, 'sine', 0.98, 0.16, 0.18, 1800, 1.0, 0, 0, 0);
  buildThwack(ac, now, 294, 'sine', 0.96, 0.14, 0.22, 1800, 1.0, 0, 0, 0.14);
}

export function playMatchWinSound(isMuted: boolean): void {
  if (isMuted) return;

  let ac: AudioContext;
  try {
    const activeCtx = getCtx();
    if (!activeCtx) return;
    ac = activeCtx;
  } catch {
    return;
  }
  const now = ac.currentTime;

  buildThwack(ac, now, 392, 'sine', 0.99, 0.22, 0.28, 2400, 1.3, 0, 0, 0);
  buildThwack(ac, now, 523, 'sine', 0.99, 0.2, 0.28, 2400, 1.3, 0, 0, 0.16);
  buildThwack(ac, now, 659, 'sine', 0.99, 0.24, 0.38, 2400, 1.3, 0, 0, 0.32);
}

export function playMatchLoseSound(isMuted: boolean): void {
  if (isMuted) return;

  let ac: AudioContext;
  try {
    const activeCtx = getCtx();
    if (!activeCtx) return;
    ac = activeCtx;
  } catch {
    return;
  }
  const now = ac.currentTime;

  buildThwack(ac, now, 494, 'sine', 0.97, 0.16, 0.28, 1600, 1.0, 0, 0, 0);
  buildThwack(ac, now, 370, 'sine', 0.97, 0.14, 0.28, 1600, 1.0, 0, 0, 0.18);
  buildThwack(ac, now, 294, 'sine', 0.95, 0.12, 0.36, 1600, 1.0, 0, 0, 0.38);
}

export function playBlockedSound(isMuted: boolean): void {
  if (isMuted) return;

  let ac: AudioContext;
  try {
    const activeCtx = getCtx();
    if (!activeCtx) return;
    ac = activeCtx;
  } catch {
    return;
  }
  const now = ac.currentTime;

  buildThwack(ac, now, 320, 'triangle', 0.88, 0.15, 0.35, 900, 1.4, 0.06, 0.02, 0);
  buildThwack(ac, now, 339, 'triangle', 0.88, 0.13, 0.35, 900, 1.4, 0, 0, 0);
}

export function playYourTurnSound(isMuted: boolean): void {
  if (isMuted) return;

  try {
    const ac = getCtx();
    if (!ac) return;

    const t = ac.currentTime;

    // Soft two-note chime — gentle notification feel
    const notes = [330, 440]; // E4 then A4 — simple pleasant interval

    for (let i = 0; i < notes.length; i++) {
      const t0 = t + i * 0.1;
      const freq = notes[i];

      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);

      const env = ac.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(0.15, t0 + 0.012); // soft attack
      env.gain.linearRampToValueAtTime(0.1, t0 + 0.06); // slight decay
      env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28); // gentle fade

      osc.connect(env);
      env.connect(ac.destination);

      osc.start(t0);
      osc.stop(t0 + 0.32);
    }
  } catch {
    return;
  }
}
