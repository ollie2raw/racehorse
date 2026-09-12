// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { resolveInitialBotMatchState, type ResolveInitialBotMatchStateInput } from './resolveInitialBotMatchState.ts';

function baseInput(overrides: Partial<ResolveInitialBotMatchStateInput> = {}): ResolveInitialBotMatchStateInput {
  return {
    mode: 'bot',
    winningScore: 60,
    dealSize: 14,
    isAuthoringMode: false,
    isAuthoringV2Mode: false,
    isGuidedV2Mode: false,
    isGuidedMode: false,
    guidedTranscript: null,
    frozenLesson: null,
    resumablePersistedDailyFritzMatch: null,
    preGameDrawEligible: false,
    dailyFritzPackage: null,
    guidedInitSourceRef: { current: null },
    ...overrides,
  };
}

describe('resolveInitialBotMatchState', () => {
  it('forwards matchRuleOverrides onto the dealt state for a plain bot match', () => {
    const state = resolveInitialBotMatchState(
      baseInput({
        matchRuleOverrides: { blockedHandRule: 'noScore', scoreHandicap: { you: 0, bot: 15 } },
      }),
    );
    expect(state.blockedHandRule).toBe('noScore');
    expect(state.players.bot.score).toBe(15);
  });
});
