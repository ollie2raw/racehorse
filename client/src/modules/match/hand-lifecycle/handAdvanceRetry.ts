import { dailyFritzDebugLog } from '../../daily/dailyFritzMatchDiagnostics.ts';

/** Schedules deferred advanceHand retries (reveal-window guard, network failures). */
export class HandAdvanceRetryScheduler {
  private timerId: ReturnType<typeof window.setTimeout> | null = null;

  schedule(delayMs: number, reason: string, advance: () => void): void {
    if (this.timerId) {
      window.clearTimeout(this.timerId);
    }
    this.timerId = window.setTimeout(() => {
      this.timerId = null;
      dailyFritzDebugLog('[hand-over] retry-scheduled', { reason, delayMs });
      advance();
    }, delayMs);
  }

  clear(): void {
    if (this.timerId) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  dispose(): void {
    this.clear();
  }
}