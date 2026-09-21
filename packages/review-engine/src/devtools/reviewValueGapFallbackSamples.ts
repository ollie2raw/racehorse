/** Writes every recorded self-play value-gap fallback for human review. */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReviewAction } from '@racehorse/game-core/review';
import { buildReviewCoachingFacts } from '../../../../client/src/analyzer/reviewCoachingFacts';
import { buildReviewCoachingProse, VALUE_GAP_MIN_POINTS } from '../../../../client/src/analyzer/reviewCoachingProse';
import { unresolvedValueGapMagnitude } from './reviewExplanationCoverageStudy';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SELF_PLAY_DIR = resolve(ROOT, 'packages/review-engine/fixtures/recorded-self-play');
const SAMPLE_PATH = resolve(ROOT, 'docs/review-value-gap-fallback-samples.md');

function actionText(action: ReviewAction): string {
  if (action.kind === 'play') return `${action.tile.low}-${action.tile.high} at ${action.position}`;
  return action.kind === 'draw' ? 'draw' : 'pass';
}

function valueText(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function points(value: number): string {
  return `${value} immediate ${Math.abs(value) === 1 ? 'point' : 'points'}`;
}

export function writeValueGapFallbackSamples(): number {
  const samples = replayRecordedSelfPlay(SELF_PLAY_DIR)
    .map(({ evaluation, snapshot, file }) => {
      const facts = buildReviewCoachingFacts(evaluation, snapshot, true);
      return { facts, snapshot, file, prose: buildReviewCoachingProse(facts, true) };
    })
    .filter(({ facts }) =>
      (unresolvedValueGapMagnitude(facts) ?? 0) > 0
      && (facts.deltas.expectedPointDifferential >= VALUE_GAP_MIN_POINTS
        || (facts.deltas.immediatePoints > 0 && facts.deltas.expectedPointDifferential >= 0)));
  const sections = samples.map(({ facts, snapshot, file, prose }, index) => [
    `## ${index + 1}. ${facts.evidence.source}`,
    '',
    `- Position: ${file}; hand ${snapshot.identifiers.handNumber}; decision ${snapshot.identifiers.decisionId}; score ${snapshot.preAction.scores.actor}-${snapshot.preAction.scores.opponent}; hand ${snapshot.preAction.actorHand.length}; boneyard ${snapshot.preAction.boneyard.physicalCount}.`,
    `- Played: ${actionText(facts.played.action)} (${points(facts.played.immediatePoints)})`,
    `- Reference: ${actionText(facts.best.action)} (${points(facts.best.immediatePoints)})`,
    `- Fallback: ${prose.headline}`,
    `- Value gaps: expectedPointDifferential ${valueText(facts.deltas.expectedPointDifferential)}; immediatePoints ${valueText(facts.deltas.immediatePoints)}${facts.deltas.winProbability === undefined ? '' : `; winProbability ${valueText(facts.deltas.winProbability)}`}.`,
    '',
  ].join('\n'));
  writeFileSync(SAMPLE_PATH, ['# Review value-gap fallback samples', '', `| cases | ${samples.length} |`, '', ...sections].join('\n'));
  return samples.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ cases: writeValueGapFallbackSamples() }));
}
