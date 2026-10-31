import { describe, expect, it } from 'vitest';
import { BUS, attackOffsetOf, softLimiterCurve } from './audioEngine';

const RATE = 44_100;

/** A stand-in for the one AudioBuffer method the onset detector uses. */
function fakeBuffer(samples: Float32Array): AudioBuffer {
  return { sampleRate: RATE, getChannelData: () => samples } as unknown as AudioBuffer;
}

/** `ms` of a quiet swell at `swellLevel`, then a loud click, then silence: the shape of the tile sample. */
function swellThenClick(swellMs: number, swellLevel: number, clickLevel = 1): Float32Array {
  const swell = Math.round((RATE * swellMs) / 1000);
  const data = new Float32Array(swell + Math.round(RATE * 0.05));
  for (let i = 0; i < swell; i += 1) data[i] = swellLevel * (i % 2 === 0 ? 1 : -1);
  for (let i = swell; i < swell + 40; i += 1) data[i] = clickLevel * (i % 2 === 0 ? 1 : -1);
  return data;
}

describe('attackOffsetOf', () => {
  it('skips a quiet swell and starts just before the click', () => {
    const offset = attackOffsetOf(fakeBuffer(swellThenClick(100, 0.02)));
    // The click is at 100 ms; the default lead keeps its first few ms.
    expect(offset).toBeGreaterThan(0.09);
    expect(offset).toBeLessThan(0.1);
  });

  it('starts at zero when the sound already begins with its hit', () => {
    expect(attackOffsetOf(fakeBuffer(swellThenClick(0, 0)))).toBe(0);
  });

  it('is zero for silence rather than skipping into nothing', () => {
    expect(attackOffsetOf(fakeBuffer(new Float32Array(RATE / 10)))).toBe(0);
  });

  it('never goes negative when the hit is right at the start', () => {
    const data = new Float32Array(RATE / 10);
    for (let i = 0; i < 40; i += 1) data[i + 100] = i % 2 === 0 ? 1 : -1; // click at ~2 ms: less than the lead
    expect(attackOffsetOf(fakeBuffer(data))).toBeGreaterThanOrEqual(0);
  });
});

describe('softLimiterCurve', () => {
  const curve = softLimiterCurve(8193);
  const at = (x: number) => curve[Math.round(((x + 1) / 2) * (curve.length - 1))];

  it('passes a quiet sample untouched, in both polarities', () => {
    expect(at(0.2)).toBeCloseTo(0.2, 3);
    expect(at(-0.2)).toBeCloseTo(-0.2, 3);
    expect(at(BUS.kneeLinear)).toBeCloseTo(BUS.kneeLinear, 3);
  });

  it('never exceeds the ceiling, however hot the input', () => {
    for (let i = 0; i < curve.length; i += 1) expect(Math.abs(curve[i])).toBeLessThanOrEqual(BUS.ceilingLinear + 1e-6);
  });

  it('rolls off smoothly above the knee: louder in is never quieter out', () => {
    let previous = 0;
    for (let x = 0; x <= 1; x += 0.01) {
      const y = at(x);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = y;
    }
  });

  it('is symmetric', () => {
    expect(at(0.8)).toBeCloseTo(-at(-0.8), 5);
  });
});
