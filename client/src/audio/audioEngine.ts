// client/src/audio/audioEngine.ts
//
// The one audio context and mix bus every Racehorse sound goes through.
//
//   source -> [pan] -> [gain] -> BUS INPUT -> soft limiter -> speakers
//
// Why a bus: sounds used to connect straight to the speakers, so a score chime stacked on a clack could
// clip, nothing could be panned, and there was no single place to set the overall level. The soft limiter
// is a static safety net so nothing can clip (see BUS for why it is a curve and not a compressor).
//
// Why decoded buffers: the tile sample used to play through an <audio> element, which bypasses the audio
// graph (no panning, no bus) and starts with noticeable latency, worst in the iOS WebView. A decoded
// AudioBuffer plays with no start-up cost, can overlap itself, and can be pitched and panned per hit.
//
// Autoplay policy: the context is created and resumed on the first user gesture (installAudioUnlock), and
// decoding starts then too, so the first tile placed after a tap is already ready to play.

export interface Playback {
  /** Linear gain, 1 = the sample as authored. */
  gain?: number;
  /** playbackRate: 1 = as authored; 1.06 is about one semitone up. */
  rate?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Seconds from now. */
  delay?: number;
  /** Start this far INTO the sample (seconds of the sample, not of playback): skips a silent or slowly swelling pre-roll. */
  offset?: number;
  /** Fade the start in over this many seconds. Needed when `offset` lands mid-sound, or the cut clicks. */
  fadeInS?: number;
}

const onsetCache = new WeakMap<AudioBuffer, number>();

/**
 * Where a sample's real hit begins, in seconds: the first 1 ms stretch within `thresholdDb` of its loudest, minus a
 * short lead so the attack's first few ms are kept. Some library samples carry a slow swell or silence before the
 * impact (the tile sample's loudest moment is ~120 ms in), which both delays the sound and reads as an echo leading
 * into it. Starting at the onset puts the transient at time zero.
 */
export function attackOffsetOf(buffer: AudioBuffer, thresholdDb = -14, leadS = 0.006): number {
  const cached = onsetCache.get(buffer);
  if (cached !== undefined) return cached;
  const data = buffer.getChannelData(0);
  const win = Math.max(1, Math.round(buffer.sampleRate * 0.001));
  const rms: number[] = [];
  let peak = 0;
  for (let i = 0; i + win <= data.length; i += win) {
    let acc = 0;
    for (let j = i; j < i + win; j += 1) acc += data[j] * data[j];
    const value = Math.sqrt(acc / win);
    rms.push(value);
    if (value > peak) peak = value;
  }
  let offset = 0;
  if (peak > 0) {
    const floor = peak * 10 ** (thresholdDb / 20);
    const first = rms.findIndex((value) => value >= floor);
    offset = first <= 0 ? 0 : Math.max(0, (first * win) / buffer.sampleRate - leadS);
  }
  onsetCache.set(buffer, offset);
  return offset;
}

type Ctx = BaseAudioContext;

let ctx: Ctx | null = null;
let busInput: GainNode | null = null;
let realtime = true;
const samples = new Map<string, AudioBuffer | Promise<AudioBuffer | null> | null>();

/**
 * The bus's safety limiter, as a static curve. Exported so the audio bench can assert against the same numbers.
 *
 * Below `kneeLinear` a sample passes untouched; above it the level rolls off smoothly (tanh) toward `ceilingLinear`,
 * which nothing can exceed. Static on purpose: Chrome's DynamicsCompressor adds ~6 ms of look-ahead delay per stage
 * and, with no history, swallows a loud transient that arrives straight after silence (the bench measured a tile click
 * losing 13 dB), and a clack IS a transient arriving after silence. A curve has no delay, no state and no attack to
 * miss: transients pass exactly, and only a peak that would otherwise clip is rounded off.
 */
export const BUS = {
  kneeLinear: 0.5, // -6 dBFS
  ceilingLinear: 0.89, // -1 dBFS
} as const;

/** The soft-limiter transfer curve over [-1, 1], sampled for a WaveShaperNode. */
export function softLimiterCurve(points = 8192): Float32Array<ArrayBuffer> {
  const { kneeLinear, ceilingLinear } = BUS;
  const headroom = ceilingLinear - kneeLinear;
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i += 1) {
    const x = (i / (points - 1)) * 2 - 1;
    const magnitude = Math.abs(x);
    const y = magnitude <= kneeLinear ? magnitude : kneeLinear + headroom * Math.tanh((magnitude - kneeLinear) / headroom);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

function buildBus(ac: Ctx): GainNode {
  const input = ac.createGain();
  const limiter = ac.createWaveShaper();
  limiter.curve = softLimiterCurve();
  limiter.oversample = '2x'; // the curve is non-linear: oversample so rounding a peak does not alias
  input.connect(limiter);
  limiter.connect(ac.destination);
  return input;
}

/** Create the context if needed. Never gated on its running state: decoding does not need a running context. */
function ensureContext(): Ctx | null {
  if (ctx) return ctx;
  const Ctor: typeof AudioContext | undefined =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  realtime = true;
  busInput = null;
  return ctx;
}

/**
 * The context to play on, or null when audio is unavailable or still locked by the browser. Creating it lazily
 * keeps the browser's autoplay warning out of the console until a gesture has happened.
 */
export function getAudioContext(): Ctx | null {
  const ac = ensureContext();
  if (ac && realtime) {
    const live = ac as AudioContext;
    if (live.state === 'suspended') {
      void live.resume().catch(() => {});
      if (live.state === 'suspended') return null;
    }
  }
  return ac;
}

/** Where a sound's last node connects: the bus input for this context. */
export function outputOf(ac: Ctx): AudioNode {
  if (ac !== ctx) return ac.destination; // a foreign context (never expected): stay audible rather than silent
  if (!busInput) busInput = buildBus(ac);
  return busInput;
}

/** Test/bench seam: run every sound on an OfflineAudioContext so it can be rendered and measured. */
export function useAudioContextForBench(offline: Ctx | null): void {
  ctx = offline;
  busInput = null;
  realtime = offline === null;
  samples.clear();
}

/** Decode a sample once. Resolves null on any failure so callers can fall back. */
export function loadSample(url: string): Promise<AudioBuffer | null> {
  const cached = samples.get(url);
  if (cached instanceof Promise) return cached;
  if (cached) return Promise.resolve(cached);
  const ac = ensureContext();
  if (!ac) return Promise.resolve(null);
  const pending = (async () => {
    try {
      const response = await fetch(url);
      const data = await response.arrayBuffer();
      const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
        // The callback form is the one old Safari/WebView builds implement; it also returns a promise on modern ones.
        const maybe = ac.decodeAudioData(data, resolve, reject);
        if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
      });
      samples.set(url, buffer);
      return buffer;
    } catch {
      samples.set(url, null);
      return null;
    }
  })();
  samples.set(url, pending);
  return pending;
}

/** A decoded sample if it is ready right now, else null (play a fallback rather than wait). */
export function readySample(url: string): AudioBuffer | null {
  const cached = samples.get(url);
  return cached && !(cached instanceof Promise) ? cached : null;
}

/** Play a decoded buffer through the bus. False when audio is unavailable. */
export function playBuffer(buffer: AudioBuffer, options: Playback = {}): boolean {
  const ac = getAudioContext();
  if (!ac) return false;
  try {
    const source = ac.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = options.rate ?? 1;
    const gain = ac.createGain();
    const level = options.gain ?? 1;
    if (options.fadeInS && options.fadeInS > 0) {
      const t0 = ac.currentTime + (options.delay ?? 0);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(level, t0 + options.fadeInS);
    } else {
      gain.gain.value = level;
    }
    source.connect(gain);
    let tail: AudioNode = gain;
    // Always through the equal-power panner, even at 0: a mono source with no panner plays at full level in BOTH ears,
    // 3 dB hotter than the same sound panned anywhere else, so a tile's loudness would jump with where it landed.
    if (typeof ac.createStereoPanner === 'function') {
      const panner = ac.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0));
      gain.connect(panner);
      tail = panner;
    }
    tail.connect(outputOf(ac));
    source.start(ac.currentTime + (options.delay ?? 0), Math.max(0, options.offset ?? 0));
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the context and start decoding on the first real user gesture, so the first sound after a tap is ready.
 * Idempotent; removes its own listeners once it has run.
 */
export function installAudioUnlock(prime: () => void): void {
  if (typeof window === 'undefined') return;
  const events = ['pointerdown', 'keydown', 'touchstart'] as const;
  const unlock = () => {
    for (const name of events) window.removeEventListener(name, unlock, true);
    try {
      ensureContext();
      void getAudioContext(); // starts the resume that the gesture permits
      prime();
    } catch {
      /* no audio device: every sound already fails silently */
    }
  };
  for (const name of events) window.addEventListener(name, unlock, { capture: true, passive: true });
}
