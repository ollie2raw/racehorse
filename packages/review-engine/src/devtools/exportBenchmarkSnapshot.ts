/**
 * Writes the fixed position the server's one-time CPU benchmark runs (server/workers/reviewBenchmark.snapshot.json): the corpus's hidden-hand midgame
 * fixture, a position whose cost is dominated by sampled hidden hands, which is what dominates a real review. The same file is read by the worker thread on the
 * server and by measureServerBenchmarkOnLaptop.ts here, so the laptop and the instance run the identical position.
 *   npx tsx packages/review-engine/src/devtools/exportBenchmarkSnapshot.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const fixture = REVIEW_FIXTURE_CORPUS.find((candidate) => candidate.snapshot.identifiers.decisionId === 'hidden-allocation-ambiguous-midgame');
if (!fixture) throw new Error('benchmark fixture not found');
const out = resolve(ROOT, 'server/workers/reviewBenchmark.snapshot.json');
writeFileSync(out, `${JSON.stringify(fixture.snapshot)}\n`);
process.stdout.write(`wrote ${out} (${JSON.stringify(fixture.snapshot).length} bytes)\n`);
