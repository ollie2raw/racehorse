/**
 * Prints the features of one non-forced corpus decision by its index in the cold-run order (reviewColdCorpusRun.ts), including the hidden-hand state space
 * C(n,k) and which solver path and tier the dispatcher's own coverage arithmetic implies. Used to explain what makes a decision expensive.
 *   npx tsx packages/review-engine/src/devtools/describeCorpusDecision.ts <index> [index...]
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { resolveHiddenPoolEligibility } from '../hiddenPoolEligibility';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const dir = resolve(ROOT, 'packages/review-engine/fixtures/recorded-self-play');
const positions = replayRecordedSelfPlay(dir).filter(({ evaluation }) => evaluation.candidates.length > 1);
const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return Math.round(result);
};
for (const arg of process.argv.slice(2)) {
  const index = Number(arg);
  const { snapshot } = positions[index]!;
  const { eligibleForOpponent } = resolveHiddenPoolEligibility(snapshot);
  const k = snapshot.preAction.opponentTileCount;
  const space = choose(eligibleForOpponent.length, k);
  process.stdout.write(
    `#${index} ${snapshot.identifiers.gameId} move ${snapshot.identifiers.actionNumber}: hand ${snapshot.preAction.actorHand.length}, opponent tiles ${k}, eligible hidden ${eligibleForOpponent.length}, `
    + `C(n,k)=${space}, drawable ${snapshot.preAction.boneyard.drawableCount}, legal actions ${snapshot.legalActions.length}\n`,
  );
}
