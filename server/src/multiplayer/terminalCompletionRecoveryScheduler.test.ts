import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const timeoutMock = vi.hoisted(() => vi.fn());
const intervalMock = vi.hoisted(() => vi.fn());
const trackMock = vi.hoisted(() => vi.fn(async (_n: string, fn: () => Promise<unknown>) => fn()));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('../platform/processLifecycle', () => ({
  processTimeout: timeoutMock,
  processInterval: intervalMock,
  trackProcessWork: trackMock,
}));
vi.mock('../supabaseUtils', () => ({ supabaseFetch: fetchMock }));
vi.mock('../realtime/gameOverPersistence', () => ({ replayGameOverCompletion: vi.fn() }));
vi.mock('./ratedForfeitCompletion', () => ({ completeRatedForfeit: vi.fn() }));
vi.mock('../operationalTelemetry', () => ({ recordOperationalFailure: vi.fn() }));

import {
  resetTerminalCompletionRecoveryForTests,
  scheduleTerminalCompletionRecovery,
} from './terminalCompletionRecovery';

describe('scheduleTerminalCompletionRecovery wiring', () => {
  beforeEach(() => {
    resetTerminalCompletionRecoveryForTests();
    timeoutMock.mockClear();
    intervalMock.mockClear();
    trackMock.mockClear();
    fetchMock.mockReset();
    delete process.env.TERMINAL_COMPLETION_RECOVERY_ENABLED;
    delete process.env.TERMINAL_COMPLETION_RECOVERY_BOOT_DELAY_MS;
  });
  afterEach(() => {
    delete process.env.TERMINAL_COMPLETION_RECOVERY_ENABLED;
    delete process.env.TERMINAL_COMPLETION_RECOVERY_BOOT_DELAY_MS;
  });

  it('registers one boot timeout and one interval through the process lifecycle, once', () => {
    scheduleTerminalCompletionRecovery();
    scheduleTerminalCompletionRecovery();
    expect(timeoutMock).toHaveBeenCalledTimes(1);
    expect(intervalMock).toHaveBeenCalledTimes(1);
    expect(timeoutMock.mock.calls[0]![0]).toBe('terminal-completion-recovery');
    expect(timeoutMock.mock.calls[0]![2]).toBe(15_000);
    expect(intervalMock.mock.calls[0]![2]).toBe(15 * 60_000);
  });

  it('honours the boot-delay override (clamped to 1s..15s)', () => {
    process.env.TERMINAL_COMPLETION_RECOVERY_BOOT_DELAY_MS = '2000';
    scheduleTerminalCompletionRecovery();
    expect(timeoutMock.mock.calls[0]![2]).toBe(2000);
  });

  it('schedules nothing when disabled', () => {
    process.env.TERMINAL_COMPLETION_RECOVERY_ENABLED = 'false';
    scheduleTerminalCompletionRecovery();
    expect(timeoutMock).not.toHaveBeenCalled();
    expect(intervalMock).not.toHaveBeenCalled();
  });

  it('runs each sweep as tracked process work and swallows scan failures', async () => {
    fetchMock.mockRejectedValue(new Error('db down'));
    scheduleTerminalCompletionRecovery();
    const sweep = timeoutMock.mock.calls[0]![1] as () => Promise<unknown>;
    await expect(sweep()).resolves.toBeUndefined();
    expect(trackMock).toHaveBeenCalledWith('terminal-completion-recovery', expect.any(Function));
  });
});
