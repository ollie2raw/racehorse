import type { JourneyActiveChallenge } from './journeyRuntime';
import { hasJourneyBriefing } from './journeyBriefings';
import { hasJourneyPuzzle } from './journeyPuzzles';
import type { JourneyNodeWithStatus } from './journeyTypes';

export function isJourneyCheckpointBriefingNode(node: JourneyNodeWithStatus): boolean {
  return node.nodeType === 'checkpoint' && hasJourneyBriefing(node.id);
}

export function isJourneyPuzzleNode(node: JourneyNodeWithStatus): boolean {
  return node.nodeType === 'puzzle' && hasJourneyPuzzle(node.id);
}

export function isJourneyBotTrialNode(node: JourneyNodeWithStatus): boolean {
  return (
    (node.nodeType === 'match' || node.nodeType === 'boss') &&
    node.action.kind === 'botMatch'
  );
}

export function buildJourneyBotTrial(node: JourneyNodeWithStatus): JourneyActiveChallenge | null {
  if (node.status === 'locked' || node.status === 'completed') return null;
  if (!isJourneyBotTrialNode(node)) return null;
  if (node.action.kind !== 'botMatch') return null;

  return {
    nodeId: node.id,
    returnMode: 'journey',
    fritzTier: node.action.fritzTier,
    dealSize: node.action.dealSize,
    trialFormat: node.action.trialFormat ?? (node.action.winningScore && node.action.winningScore < 60 ? 'shortRace' : 'fullMatch'),
    winningScore: node.action.winningScore ?? 60,
    nodeTitle: node.title,
  };
}
