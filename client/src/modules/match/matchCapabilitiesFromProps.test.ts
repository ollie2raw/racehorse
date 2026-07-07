import { describe, expect, it } from 'vitest';
import { buildMatchCapabilitiesFromBotProps } from './matchCapabilitiesFromProps.ts';

describe('buildMatchCapabilitiesFromBotProps', () => {
  it('maps daily-fritz mode and pre-game draw', () => {
    const caps = buildMatchCapabilitiesFromBotProps({
      mode: 'daily-fritz',
      dealSize: 7,
      winningScore: 60,
      isGuidedMode: false,
      isAuthoringMode: false,
      isAuthoringV2Mode: false,
      isGuidedV2Mode: false,
      isJourneyTrial: false,
      isDailyPuzzleRun: false,
      isStandaloneFritzMatch: false,
      enableGuidedMatchCandidateCapture: false,
      preGameDrawActive: true,
    });
    expect(caps.mode).toBe('daily-fritz');
    expect(caps.preGameDraw).toBe(true);
    expect(caps.overlays.size).toBe(0);
  });

  it('adds ranked overlay for standalone fritz', () => {
    const caps = buildMatchCapabilitiesFromBotProps({
      mode: 'bot',
      dealSize: 14,
      winningScore: 100,
      isGuidedMode: false,
      isAuthoringMode: false,
      isAuthoringV2Mode: false,
      isGuidedV2Mode: false,
      isJourneyTrial: false,
      isDailyPuzzleRun: false,
      isStandaloneFritzMatch: true,
      enableGuidedMatchCandidateCapture: false,
      preGameDrawActive: false,
    });
    expect(caps.overlays.has('ranked-pvf')).toBe(true);
    expect(caps.verifiedRanking).toBe(true);
  });
});