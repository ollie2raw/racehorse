/**
 * How much of what a player is shown has a real explanation, measured on what the PRODUCTION review path produces.
 *
 * `reviewExplanationCoverageStudy.ts` measures the recorded corpus as it was written, by the older single-budget dispatcher, whose evaluations are 30 to 40% heuristic
 * (no point values, so no value-gap sentence is possible). Production never ends on a heuristic for a decision with a choice (`reviewProductionTierMix.ts`: 0%), so
 * that study understates what players get. This replays every decision through `completeReviewEvaluations` (the durable server job's escalation, including the
 * whole-hand second opinion) and classifies the headline each one renders, over the decisions where the player's move differed from the review's.
 *
 * Manually invoked:  npx tsx src/devtools/reviewProductionExplanationCoverage.ts [corpusDir] [maxDecisions] [outPath]
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isForcedDecision } from '@racehorse/game-core/review';
import { completeReviewEvaluations } from '../completeReviewEvaluations';
import { buildReviewCoachingFacts } from '../../../../client/src/analyzer/reviewCoachingFacts';
import { buildReviewCoachingProse } from '../../../../client/src/analyzer/reviewCoachingProse';
import { classifyNoDifferenceSplit, classifyRenderedExplanationProse } from './reviewExplanationCoverageStudy';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const dir = resolve(process.argv[2] ?? resolve(ROOT, 'packages/review-engine/fixtures/recorded-self-play'));
const maxDecisions = Number(process.argv[3] ?? '100000');
const outPath = process.argv[4] ? resolve(process.argv[4]) : null;

type Bucket = 'positional' | 'value-gap' | 'equal-value' | 'no-difference' | 'unconfirmed';
type Row = { id: string; samePlayed: boolean; bucket: Bucket; split: string | null; source: string; gap: number | null; headline: string; missKind: string };

const rows: Row[] = [];
const positions = replayRecordedSelfPlay(dir).slice(0, maxDecisions);
let done = 0;
for (const { snapshot, evaluation } of positions) {
  const id = snapshot.identifiers.decisionId;
  const result = completeReviewEvaluations({ snapshots: [snapshot], liveResultsByDecisionId: new Map([[id, evaluation]]) });
  const final = result.resultsByDecisionId.get(id) ?? evaluation;
  done += 1;
  if (done % 50 === 0) process.stderr.write(`${done}/${positions.length}\n`);
  if (isForcedDecision(final.candidates)) continue;
  const facts = buildReviewCoachingFacts(final, snapshot, true);
  const samePlayed = JSON.stringify(final.played.action) === JSON.stringify(final.best.action);
  const bucket: Bucket = facts.secondOpinionUnconfirmed ? 'unconfirmed' : (classifyRenderedExplanationProse(facts) ?? 'no-difference');
  rows.push({
    id,
    samePlayed,
    bucket,
    split: bucket === 'no-difference' ? classifyNoDifferenceSplit(facts) : null,
    source: final.evidence.source,
    gap: facts.deltas.referenceExpectedPointDifferential ?? null,
    headline: buildReviewCoachingProse(facts, true).headline,
    missKind: facts.missKind,
  });
}

const pct = (n: number, d: number) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);
const differed = rows.filter((r) => !r.samePlayed);
const count = (rs: Row[], b: Bucket) => rs.filter((r) => r.bucket === b).length;
const explained = differed.filter((r) => r.bucket !== 'no-difference');
const lines: string[] = [
  '# Production explanation coverage',
  '',
  `${positions.length} recorded decisions replayed through the production completion path (${rows.length} with a choice). Bot self-play, not human play.`,
  '',
  '## Where the player\'s move differed from the review\'s',
  '',
  '| rendered headline | count | share |',
  '| --- | ---: | ---: |',
  ...(['positional', 'value-gap', 'equal-value', 'unconfirmed', 'no-difference'] as Bucket[]).map((b) => `| ${b} | ${count(differed, b)} | ${pct(count(differed, b), differed.length)} |`),
  `| **explained (everything but no-difference)** | ${explained.length} | **${pct(explained.length, differed.length)}** |`,
  `| decisions where the move differed | ${differed.length} | |`,
  '',
  '"unconfirmed" is the softened wording from the second opinion ("the review leans toward X, but it is not clear-cut"): honest, but not a positional reason.',
  '',
  '## The unexplained ones (no-difference), by why',
  '',
  '| why | count |',
  '| --- | ---: |',
  ...['b', 'c', 'd', 'unavailable'].map((s) => `| ${s === 'b' ? 'exactly equal value (a true tie)' : s === 'c' ? 'positive gap below the 0.25 floor' : s === 'd' ? 'real gap, no positional feature favors the reference' : 'value unavailable'} | ${differed.filter((r) => r.bucket === 'no-difference' && r.split === s).length} |`),
  '',
  '## Evidence tier of the decisions that differed',
  '',
  ...['exact', 'search', 'heuristic'].map((s) => `- ${s}: ${differed.filter((r) => r.source === s).length}`),
  '',
  '## Samples of the "real gap, no positional feature" cases (the ones worth a better sentence)',
  '',
  ...differed.filter((r) => r.bucket === 'no-difference' && r.split === 'd').slice(0, 12).map((r) => `- ${r.id} (${r.missKind}, gap ${r.gap === null ? '—' : r.gap.toFixed(2)}): ${r.headline}`),
  '',
];
const text = lines.join('\n');
if (outPath) writeFileSync(outPath, text);
process.stdout.write(`${text}\n`);
