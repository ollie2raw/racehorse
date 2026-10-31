import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: true }));
const plugin = vi.hoisted(() => ({
  impact: vi.fn(() => Promise.resolve()),
  selectionChanged: vi.fn(() => Promise.resolve()),
  notification: vi.fn(() => Promise.resolve()),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }));
vi.mock('@capacitor/haptics', () => ({
  Haptics: plugin,
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

const { BIG_SCORE_POINTS, DOUBLE_TAP_GAP_MS, hapticsSupported, playHaptic, scoreCue } = await import('./haptics');
const { hapticsPreference } = await import('./hapticsPreference');

describe('haptics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    native.value = true;
    window.localStorage.clear();
    plugin.impact.mockClear();
    plugin.selectionChanged.mockClear();
    plugin.notification.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is a complete no-op on the web (no haptics there by design)', () => {
    native.value = false;
    expect(hapticsSupported()).toBe(false);
    for (const cue of ['tilePlaced', 'opponentTile', 'score', 'bigScore', 'blocked', 'handWon', 'handLost', 'matchWon', 'matchLost'] as const) {
      playHaptic(cue);
    }
    vi.advanceTimersByTime(1000);
    expect(plugin.impact).not.toHaveBeenCalled();
    expect(plugin.selectionChanged).not.toHaveBeenCalled();
    expect(plugin.notification).not.toHaveBeenCalled();
  });

  it('your tile is a light tap and the opponent\'s is only a faint selection tick', () => {
    playHaptic('tilePlaced');
    expect(plugin.impact).toHaveBeenCalledWith({ style: 'LIGHT' });
    playHaptic('opponentTile');
    expect(plugin.selectionChanged).toHaveBeenCalledTimes(1);
    expect(plugin.impact).toHaveBeenCalledTimes(1);
  });

  it('a score is firmer than a tile, and a big score firmer still', () => {
    playHaptic('score');
    expect(plugin.impact).toHaveBeenLastCalledWith({ style: 'MEDIUM' });
    playHaptic('bigScore');
    expect(plugin.impact).toHaveBeenLastCalledWith({ style: 'HEAVY' });
  });

  it('chooses the big cue from ten points up', () => {
    expect(scoreCue(BIG_SCORE_POINTS - 1)).toBe('score');
    expect(scoreCue(BIG_SCORE_POINTS)).toBe('bigScore');
    expect(scoreCue(25)).toBe('bigScore');
  });

  it('a blocked hand is a double tap', () => {
    playHaptic('blocked');
    expect(plugin.impact).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DOUBLE_TAP_GAP_MS);
    expect(plugin.impact).toHaveBeenCalledTimes(2);
  });

  it('turning haptics off between the two taps of a blocked hand stops the second', () => {
    playHaptic('blocked');
    hapticsPreference.set(false);
    vi.advanceTimersByTime(DOUBLE_TAP_GAP_MS);
    expect(plugin.impact).toHaveBeenCalledTimes(1);
  });

  it('endings use the system success and warning patterns', () => {
    playHaptic('handWon');
    expect(plugin.notification).toHaveBeenLastCalledWith({ type: 'SUCCESS' });
    playHaptic('matchWon');
    expect(plugin.notification).toHaveBeenLastCalledWith({ type: 'SUCCESS' });
    playHaptic('handLost');
    expect(plugin.notification).toHaveBeenLastCalledWith({ type: 'WARNING' });
    playHaptic('matchLost');
    expect(plugin.notification).toHaveBeenLastCalledWith({ type: 'WARNING' });
  });

  it('does nothing when the player turned haptics off, and is on by default', () => {
    expect(hapticsPreference.get()).toBe(true);
    hapticsPreference.set(false);
    playHaptic('tilePlaced');
    playHaptic('score');
    playHaptic('handWon');
    expect(plugin.impact).not.toHaveBeenCalled();
    expect(plugin.notification).not.toHaveBeenCalled();
    hapticsPreference.set(true);
    playHaptic('tilePlaced');
    expect(plugin.impact).toHaveBeenCalledTimes(1);
  });

  it('never throws into a move when the native call fails', async () => {
    plugin.impact.mockImplementationOnce(() => Promise.reject(new Error('no taptic engine')));
    expect(() => playHaptic('tilePlaced')).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
  });
});
