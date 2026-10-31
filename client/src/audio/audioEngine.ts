// client/src/audio/audioEngine.ts
//
// The one audio context and mix bus every Racehorse sound goes through.
//
//   source -> [pan] -> [gain] -> BUS INPUT -> glue compressor -> limiter -> speakers
//
// Why a bus: sounds used to connect straight to the speakers, so a score chime stacked on a clack could
// clip, nothing could be panned, and there was no single place to set the overall level. The glue
// compressor gently evens out stacked sounds; the limiter is a safety net so nothing can clip.
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
}

type Ctx = BaseAudioContext;

let ctx: Ctx | null = null;
let busInput: GainNode | null = null;
let realtime = true;
const samples = new Map<string, AudioBuffer | Promise<AudioBuffer | null> | null>();

/** Bus tuning. Exported so the audio bench can assert against the same numbers. */
export const BUS = {
  /** Gentle "glue": evens out sounds that land together without squashing a single hit. */
  glue: { thresholdDb: -18, kneeDb: 10, ratio: 3, attackS: 0.004, releaseS: 0.14 },
  /** Safety net: nothing leaves the bus above this. */
  limiter: { thresholdDb: -2, kneeDb: 0, ratio: 20, attackS: 0.001, releaseS: 0.08 },
} as const;

function buildBus(ac: Ctx): GainNode {
  const input = ac.createGain();
  const glue = ac.createDynamicsCompressor();
  glue.threshold.value = BUS.glue.thresholdDb;
  glue.knee.value = BUS.glue.kneeDb;
  glue.ratio.value = BUS.glue.ratio;
  glue.attack.value = BUS.glue.attackS;
  glue.release.value = BUS.glue.releaseS;
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = BUS.limiter.thresholdDb;
  limiter.knee.value = BUS.limiter.kneeDb;
  limiter.ratio.value = BUS.limiter.ratio;
  limiter.attack.value = BUS.limiter.attackS;
  limiter.release.value = BUS.limiter.releaseS;
  input.connect(glue);
  glue.connect(limiter);
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
    gain.gain.value = options.gain ?? 1;
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
    source.start(ac.currentTime + (options.delay ?? 0));
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
