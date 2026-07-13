import type { JourneyActiveChallenge } from './journeyRuntime';
import { hasJourneyBriefing } from './journeyBriefings';
import { hasJourneyPuzzle } from './journeyPuzzles';
import { getJourneyContentDescriptor } from './journeyContentResolver';
import type { JourneyRuntimeCapability } from './journeyContentContract';
import type { JourneyNodeWithStatus } from './journeyTypes';

export function isJourneyCheckpointBriefingNode(node: JourneyNodeWithStatus): boolean {
  const descriptor = getJourneyContentDescriptor(node.id);
  return descriptor?.runtime.kind === 'briefing_acknowledgement' && hasJourneyBriefing(node.id);
}

export function isJourneyPuzzleNode(node: JourneyNodeWithStatus): boolean {
  const descriptor = getJourneyContentDescriptor(node.id);
  return (
    (descriptor?.runtime.kind === 'static_decision' || descriptor?.runtime.kind === 'interactive_board_decision') &&
    hasJourneyPuzzle(node.id)
  );
}

export function isJourneyBotTrialNode(node: JourneyNodeWithStatus): boolean {
  const runtime = getJourneyTrialRuntime(node);
  return runtime !== null;
}

export function getJourneyTrialRuntime(
  node: JourneyNodeWithStatus | null,
): Extract<JourneyRuntimeCapability, { kind: 'bot_match' | 'boss_match' }> | null {
  if (!node) return null;
  const descriptor = getJourneyContentDescriptor(node.id);
  if (!descriptor) return null;
  if (descriptor.runtime.kind !== 'bot_match' && descriptor.runtime.kind !== 'boss_match') return null;
  return descriptor.runtime;
}

export function buildJourneyBotTrial(node: JourneyNodeWithStatus): JourneyActiveChallenge | null {
  if (node.status === 'locked' || node.status === 'completed') return null;
  const runtime = getJourneyTrialRuntime(node);
  if (!runtime) return null;

  return {
    nodeId: node.id,
    returnMode: 'journey',
    fritzTier: runtime.fritzTier,
    dealSize: runtime.dealSize,
    trialFormat: runtime.trialFormat,
    winningScore: runtime.winningScore,
    nodeTitle: node.title,
  };
}
