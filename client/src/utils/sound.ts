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

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
  }
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  return ctx;
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

  let ac: AudioContext;
  try {
    ac = getCtx();
  } catch {
    return; // No audio device — fail silently
  }

  const now = ac.currentTime;

  switch (type) {
    case 'standard': {
      // Domino click + short body thud.
      const stdDecay1 = 0.056 + (Math.random() * 0.014 - 0.007);
      buildThwack(
        ac,
        now,
        /* bodyFreq */ 760,
        /* oscType */ 'triangle',
        /* pitchDrop */ 0.58,
        /* peakGain */ 0.24,
        /* decayTime */ stdDecay1,
        /* lpFreq */ 780,
        /* lpQ */ 0.9,
        /* noiseGain */ 0.2,
        /* noiseDur */ 0.015,
        /* startDelay */ 0,
      );
      // Low body resonance.
      const stdDecay2 = 0.102 + (Math.random() * 0.016 - 0.008);
      buildThwack(
        ac,
        now,
        /* bodyFreq */ 158,
        /* oscType */ 'sine',
        /* pitchDrop */ 0.72,
        /* peakGain */ 0.18,
        /* decayTime */ stdDecay2,
        /* lpFreq */ 520,
        /* lpQ */ 1.1,
        /* noiseGain */ 0,
        /* noiseDur */ 0,
        /* startDelay */ 0.003,
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
