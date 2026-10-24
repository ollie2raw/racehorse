import type { JourneyMatchContext } from '../modules/match/contracts/matchScreenProps';
import type { JourneyActiveChallenge } from './journeyRuntime';

const DEFAULT_RIVAL_NAME = 'Fritz';

/**
 * "You start +15" when the player has a head start, "<Rival> starts +N" when the opponent does,
 * null when the match starts level. The head start is node-driven config (a match variant's
 * `scoreHandicap`); the match component only displays what it is given.
 */
export function formatJourneyHeadStart(
  handicap: { you: number; bot: number } | undefined,
  rivalName: string = DEFAULT_RIVAL_NAME,
): string | null {
  if (!handicap) return null;
  const net = handicap.you - handicap.bot;
  if (net > 0) return `You start +${net}`;
  if (net < 0) return `${rivalName} starts +${-net}`;
  return null;
}

export function buildJourneyMatchContext(challenge: JourneyActiveChallenge): JourneyMatchContext {
  const rivalName = challenge.rivalName?.trim() || DEFAULT_RIVAL_NAME;
  return {
    stageTitle: challenge.nodeTitle,
    rivalName,
    targetScore: challenge.winningScore,
    headStartLabel: formatJourneyHeadStart(challenge.scoreHandicap, rivalName),
  };
}
