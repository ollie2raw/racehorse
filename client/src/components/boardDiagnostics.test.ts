import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  recordDailyFritzBoardMetric,
  recordDailyFritzLayoutDebug,
  traceCameraDebug,
  traceDailyFritzBoardEvent,
} from './boardDiagnostics';

describe('boardDiagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as typeof window & { __dailyFritzInteractionTrace?: unknown }).__dailyFritzInteractionTrace;
    delete (window as typeof window & { __dailyFritzLayoutDebug?: unknown }).__dailyFritzLayoutDebug;
    delete (window as typeof window & { __dailyFritzProfileActive?: unknown }).__dailyFritzProfileActive;
    delete (window as typeof window & { __dailyFritzProfile?: unknown }).__dailyFritzProfile;
  });

  it('traceDailyFritzBoardEvent always pushes to the interaction trace bucket', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    traceDailyFritzBoardEvent('[test]', { position: 'left' });
    const bucket = (window as typeof window & {
      __dailyFritzInteractionTrace?: Array<Record<string, unknown>>;
    }).__dailyFritzInteractionTrace;
    expect(bucket).toHaveLength(1);
    expect(bucket?.[0]?.tag).toBe('[test]');
    expect(bucket?.[0]?.position).toBe('left');
    if (import.meta.env.DEV) {
      expect(logSpy).toHaveBeenCalled();
    } else {
      expect(logSpy).not.toHaveBeenCalled();
    }
  });

  it('traceCameraDebug is silent unless BOARD_CAMERA_DEBUG localStorage flag is set', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    traceCameraDebug('[camera-debug]', { reason: 'test' });
    expect(logSpy).not.toHaveBeenCalled();
    window.localStorage.setItem('BOARD_CAMERA_DEBUG', '1');
    traceCameraDebug('[camera-debug]', { reason: 'test' });
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('recordDailyFritzBoardMetric accumulates only when profiling is active', () => {
    recordDailyFritzBoardMetric('boardRenderCount', 1);
    expect(
      (window as typeof window & { __dailyFritzProfile?: { boardRenderCount?: number } }).__dailyFritzProfile,
    ).toBeUndefined();
    (window as typeof window & { __dailyFritzProfileActive?: boolean }).__dailyFritzProfileActive = true;
    recordDailyFritzBoardMetric('boardRenderCount', 2);
    expect(
      (window as typeof window & { __dailyFritzProfile?: { boardRenderCount?: number } }).__dailyFritzProfile
        ?.boardRenderCount,
    ).toBe(2);
  });

  it('recordDailyFritzLayoutDebug pushes to layout bucket', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    recordDailyFritzLayoutDebug({ tag: '[layout-debug]', boardTileCount: 3 });
    const bucket = (window as typeof window & {
      __dailyFritzLayoutDebug?: Array<Record<string, unknown>>;
    }).__dailyFritzLayoutDebug;
    expect(bucket).toHaveLength(1);
    expect(bucket?.[0]?.boardTileCount).toBe(3);
    if (import.meta.env.DEV) {
      expect(logSpy).toHaveBeenCalledWith('[layout-debug]', bucket?.[0]);
    } else {
      expect(logSpy).not.toHaveBeenCalled();
    }
  });
});