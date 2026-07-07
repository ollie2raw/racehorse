import type { HandLifecyclePhase } from '@racehorse/match-protocol';
import { emitHandLifecycleDebugLog, logHandLifecycle } from '../hand-lifecycle/handLifecycleRules.ts';
import type { MatchEventBus } from '../events/MatchEventBus.ts';

export type MatchLifecycleTraceContext = {
  mode: string;
  getHandNumber: () => number;
};

/**
 * Owns hand/match lifecycle phase transitions and debug tracing.
 * Replaces scattered phase refs inside composition screens.
 */
export class MatchLifecycleController {
  private phase: HandLifecyclePhase = 'playing';
  private readonly eventBus: MatchEventBus;

  constructor(eventBus: MatchEventBus) {
    this.eventBus = eventBus;
  }

  getPhase(): HandLifecyclePhase {
    return this.phase;
  }

  reset(): void {
    this.phase = 'playing';
  }

  transition(
    phase: HandLifecyclePhase,
    context: MatchLifecycleTraceContext,
    detail?: Record<string, unknown>,
    hypothesisId?: string,
  ): void {
    const previousPhase = this.phase;
    logHandLifecycle({
      phase,
      previousPhase,
      mode: context.mode,
      handNumber: context.getHandNumber(),
      detail,
      hypothesisId,
    });
    this.phase = phase;
    this.eventBus.emit({ type: 'LifecyclePhaseChanged', phase, previousPhase });
    emitHandLifecycleDebugLog({
      location: 'MatchLifecycleController.transition',
      message: phase,
      hypothesisId,
      data: { mode: context.mode, handNumber: context.getHandNumber(), ...detail },
    });
  }

  onHandEndedFromBotAction(
    context: MatchLifecycleTraceContext,
    detail: {
      winner: string | null;
      reason: string;
      gameOver: boolean;
      handNumber: number;
    },
  ): void {
    this.transition('resolving-hand', context, {
      winner: detail.winner,
      reason: detail.reason,
      gameOver: detail.gameOver,
      handNumber: detail.handNumber,
    });
  }
}