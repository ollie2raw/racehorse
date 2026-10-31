// client/src/devtools/soundBench.ts
//
// Renders every game sound OFFLINE (no speakers) through the real mix bus and measures it, so audio can be
// verified by numbers instead of by guessing. Driven by e2e/audio-bench.spec.ts in a real browser: only a
// browser has the Web Audio engine. Nothing in the app imports this file.
//
// What is measured, per sound:
//   peakDb      loudest sample (dBFS). The bus limiter keeps this under about -2; a clipped sound would read 0.
//   momentaryDb loudest 100 ms stretch (RMS, dBFS): a stand-in for how loud it SOUNDS, which peak alone is not.
//   activeMs    from first to last audible moment (above -50 dBFS).
//   dc          mean sample value over the audible part; should be about 0 (a DC offset thumps and wastes headroom).
//   centroidHz  spectral centroid at the loudest moment: low is dull and woody, high is bright and sharp.
//   balance     (right - left) / (right + left) energy, -1..1: where a panned sound sits in the stereo field.
import { loadSample, useAudioContextForBench } from '../audio/audioEngine';
import tileTapUrl from '../assets/sounds/freesound_community-thwump-85836.mp3';
import * as sound from '../utils/sound';

export interface SoundMetrics {
  name: string;
  peakDb: number;
  momentaryDb: number;
  activeMs: number;
  dc: number;
  centroidHz: number;
  balance: number;
}

const SAMPLE_RATE = 44_100;
const RENDER_SECONDS = 3;
const AUDIBLE = 10 ** (-50 / 20);

const toDb = (linear: number) => 20 * Math.log10(Math.max(linear, 1e-9));

/** In-place radix-2 FFT magnitude spectrum of a power-of-two window. */
function magnitudes(input: Float32Array): Float32Array {
  const n = input.length;
  const re = Float32Array.from(input);
  const im = new Float32Array(n);
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k += 1) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  const out = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i += 1) out[i] = Math.hypot(re[i], im[i]);
  return out;
}

export function analyse(name: string, left: Float32Array, right: Float32Array): SoundMetrics {
  const n = left.length;
  let peak = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i += 1) {
    const a = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (a > peak) peak = a;
    if (a > AUDIBLE) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) {
    return { name, peakDb: -120, momentaryDb: -120, activeMs: 0, dc: 0, centroidHz: 0, balance: 0 };
  }

  let sum = 0;
  let energyL = 0;
  let energyR = 0;
  for (let i = first; i <= last; i += 1) {
    sum += (left[i] + right[i]) / 2;
    energyL += left[i] * left[i];
    energyR += right[i] * right[i];
  }

  // Loudest 100 ms (hop 25 ms), RMS across both channels.
  const win = Math.round(SAMPLE_RATE * 0.1);
  const hop = Math.round(SAMPLE_RATE * 0.025);
  let bestRms = 0;
  let bestAt = first;
  for (let start = first; start <= Math.max(first, last - win); start += hop) {
    let acc = 0;
    const end = Math.min(n, start + win);
    for (let i = start; i < end; i += 1) acc += (left[i] * left[i] + right[i] * right[i]) / 2;
    const rms = Math.sqrt(acc / win);
    if (rms > bestRms) {
      bestRms = rms;
      bestAt = start;
    }
  }

  const fft = 2048;
  const frame = new Float32Array(fft);
  for (let i = 0; i < fft; i += 1) {
    const at = bestAt + i;
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fft - 1));
    frame[i] = at < n ? ((left[at] + right[at]) / 2) * hann : 0;
  }
  const spectrum = magnitudes(frame);
  let weighted = 0;
  let total = 0;
  for (let bin = 1; bin < spectrum.length; bin += 1) {
    weighted += (bin * SAMPLE_RATE / fft) * spectrum[bin];
    total += spectrum[bin];
  }

  return {
    name,
    peakDb: toDb(peak),
    momentaryDb: toDb(bestRms),
    activeMs: ((last - first) / SAMPLE_RATE) * 1000,
    dc: sum / (last - first + 1),
    centroidHz: total > 0 ? weighted / total : 0,
    balance: energyL + energyR > 0 ? (energyR - energyL) / (energyR + energyL) : 0,
  };
}

interface Case {
  name: string;
  play: () => void;
  needsTileSample?: boolean;
}

export const BENCH_CASES: Case[] = [
  { name: 'tile.standard', play: () => sound.playTileSound('standard', false), needsTileSample: true },
  { name: 'tile.deal', play: () => sound.playTileSound('deal', false), needsTileSample: true },
  { name: 'tile.slam', play: () => sound.playTileSound('slam', false), needsTileSample: true },
  { name: 'tile.standard@left', play: () => sound.playTileSound('standard', false, { pan: -0.55 }), needsTileSample: true },
  { name: 'tile.standard@right', play: () => sound.playTileSound('standard', false, { pan: 0.55 }), needsTileSample: true },
  { name: 'score.5', play: () => sound.playScoreSound(5, false) },
  { name: 'score.10', play: () => sound.playScoreSound(10, false) },
  { name: 'score.15', play: () => sound.playScoreSound(15, false) },
  { name: 'draw', play: () => sound.playDrawSound(false) },
  { name: 'blocked', play: () => sound.playBlockedSound(false) },
  { name: 'yourTurn', play: () => sound.playYourTurnSound(false) },
  { name: 'handWin', play: () => sound.playHandWinSound(false) },
  { name: 'handLose', play: () => sound.playHandLoseSound(false) },
  { name: 'matchWin', play: () => sound.playMatchWinSound(false) },
  { name: 'matchLose', play: () => sound.playMatchLoseSound(false) },
  { name: 'matchFound', play: () => sound.playMatchFoundSound(false) },
];

export async function renderSoundBench(): Promise<SoundMetrics[]> {
  const results: SoundMetrics[] = [];
  sound.freezeJitterForBench(true);
  for (const testCase of BENCH_CASES) {
    const offline = new OfflineAudioContext(2, SAMPLE_RATE * RENDER_SECONDS, SAMPLE_RATE);
    useAudioContextForBench(offline);
    if (testCase.needsTileSample) await loadSample(tileTapUrl);
    testCase.play();
    const rendered = await offline.startRendering();
    results.push(analyse(testCase.name, rendered.getChannelData(0), rendered.getChannelData(1)));
  }
  sound.freezeJitterForBench(false);
  useAudioContextForBench(null);
  return results;
}
