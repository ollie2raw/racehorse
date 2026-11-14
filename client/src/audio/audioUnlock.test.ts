// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeAudioContext {
  static created = 0;
  static resumed = 0;
  state: 'suspended' | 'running' = 'suspended';
  destination = {};
  constructor() {
    FakeAudioContext.created += 1;
  }
  resume() {
    FakeAudioContext.resumed += 1;
    this.state = 'running';
    return Promise.resolve();
  }
  createGain() {
    return { connect: () => {} };
  }
  createWaveShaper() {
    return { connect: () => {}, curve: null, oversample: 'none' };
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  FakeAudioContext.created = 0;
  FakeAudioContext.resumed = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('requestIdleCallback', (run: () => void) => window.setTimeout(run, 0));
});

afterEach(() => {
  // A test that never made a gesture leaves its module's listeners on window; fire them so the next test starts clean.
  window.dispatchEvent(new Event('pointerdown'));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('installAudioUnlock', () => {
  it('creates the context in idle time without resuming it', async () => {
    const { installAudioUnlock } = await import('./audioEngine');
    installAudioUnlock(() => {});
    expect(FakeAudioContext.created).toBe(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(FakeAudioContext.created).toBe(1);
    expect(FakeAudioContext.resumed).toBe(0);
  });

  it('resumes inside the first gesture, on the context it already made', async () => {
    const { installAudioUnlock } = await import('./audioEngine');
    const prime = vi.fn();
    installAudioUnlock(prime);
    await vi.advanceTimersByTimeAsync(10);
    window.dispatchEvent(new Event('pointerdown'));
    expect(FakeAudioContext.created).toBe(1);
    expect(FakeAudioContext.resumed).toBe(1);
    expect(prime).toHaveBeenCalledTimes(1);
  });

  it('still works when the gesture comes before the idle callback', async () => {
    const { installAudioUnlock } = await import('./audioEngine');
    installAudioUnlock(() => {});
    window.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(10);
    expect(FakeAudioContext.created).toBe(1);
    expect(FakeAudioContext.resumed).toBe(1);
  });
});
