// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { JourneyContentDescriptor } from './journeyContentContract';

const mockDescriptor: JourneyContentDescriptor = {
  migrationClass: 'legacy',
  contentId: 'ch1-n02' as JourneyContentDescriptor['contentId'],
  nodeId: 'ch1-n02' as JourneyContentDescriptor['nodeId'],
  chapterId: 'ch1-fritz-trail',
  nodeType: 'match',
  title: 'Variant Match',
  ruleset: { kind: 'core_journey', id: 'racehorse-core-journey' as never },
  supportStatus: 'supported',
  runtimeAvailability: 'available',
  runtime: {
    kind: 'bot_match',
    fritzTier: 'master',
    dealSize: 7,
    trialFormat: 'fullMatch',
    winningScore: 60,
    blockedHandRule: 'noScore',
    endHandBonus: 'none',
    scoringMultiple: 1,
    scoreHandicap: { you: 0, bot: 15 },
  },
  completion: { kind: 'bot_result', owner: 'journey_match_bridge', requiredResult: 'win' },
  presentation: { tableContextId: null, rivalContextId: null },
  legacy: {
    actionKind: 'botMatchVariant',
    requestedCapability: 'bot_match',
    actualCapability: 'bot_match',
    fallback: null,
    requirements: [],
    completionCriteria: '',
    rewardText: '',
    briefingId: null,
    puzzleId: null,
  },
};

vi.mock('./journeyContentResolver', () => ({
  getJourneyContentDescriptor: () => mockDescriptor,
}));

import { buildJourneyBotTrial } from './journeyLaunch';
import type { JourneyNodeWithStatus } from './journeyTypes';

function makeNode(overrides: Partial<JourneyNodeWithStatus> = {}): JourneyNodeWithStatus {
  return {
    id: 'ch1-n02',
    chapterId: 'ch1-fritz-trail',
    chapterTitle: 'Chapter 1: The Fritz Trail',
    order: 2,
    title: 'Variant Match',
    subtitle: '',
    nodeType: 'match',
    difficulty: 'standard',
    requirements: [],
    rewardText: 'Test Reward',
    action: { kind: 'botMatchVariant', variantId: 'no-score-blocked-hands' },
    completionCriteria: '',
    status: 'unlocked',
    ...overrides,
  };
}

describe('buildJourneyBotTrial', () => {
  it("carries a botMatchVariant node's rule overrides onto the active challenge", () => {
    const challenge = buildJourneyBotTrial(makeNode());
    expect(challenge).not.toBeNull();
    expect(challenge?.blockedHandRule).toBe('noScore');
    expect(challenge?.endHandBonus).toBe('none');
    expect(challenge?.scoringMultiple).toBe(1);
    expect(challenge?.scoreHandicap).toEqual({ you: 0, bot: 15 });
  });
});
