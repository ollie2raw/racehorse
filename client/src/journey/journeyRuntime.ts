import type { BlockedHandRule, EndHandBonus } from '@racehorse/game-core';
import type { BotDealSize } from '../bot/botEngine';
import type { FritzTier } from '../bot/fritzConfig';
import type { AppMode } from '../types';

export type JourneyActiveChallenge = {
  nodeId: string;
  returnMode: AppMode;
  fritzTier: FritzTier;
  dealSize: BotDealSize;
  trialFormat: 'fullMatch' | 'shortRace';
  winningScore: number;
  blockedHandRule?: BlockedHandRule;
  endHandBonus?: EndHandBonus;
  scoringMultiple?: number;
  scoreHandicap?: { you: number; bot: number };
  nodeTitle: string;
};

let activeChallenge: JourneyActiveChallenge | null = null;

export function getJourneyActiveChallenge(): JourneyActiveChallenge | null {
  return activeChallenge;
}

export function setJourneyActiveChallenge(challenge: JourneyActiveChallenge | null): void {
  activeChallenge = challenge;
}

export function clearJourneyActiveChallenge(): void {
  activeChallenge = null;
}
