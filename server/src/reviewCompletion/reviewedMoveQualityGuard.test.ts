/**
 * FUTURE-PERSISTENCE GUARD for move quality.
 *
 *   Move quality must not be persisted, published, ranked, rewarded, or exposed to another user until the played action is
 *   server-authoritative (server-issued or server-attested snapshots).
 *
 * Today the value is "reviewed": the candidate set and the evaluation are the server's, but the played action is the client's claim,
 * so a player can raise their own number by claiming better moves (reviewCompletion tripwire test). The type and the runtime gate
 * (`assertMoveQualityShareable`) make that hard to forget; this test makes it hard to bypass: it reads the production sources and
 * fails the moment any file other than the ones below starts using the reviewed value, the shareability gate, or the legacy
 * `avg_move_quality` column. Adding a consumer is therefore a deliberate edit to this allowlist, in review, with the rule above in view.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ROOTS = ['server/src', 'client/src', 'client/scripts', 'packages/review-engine/src', 'packages/game-core/src'];

/** Production sources: no tests, fixtures, build output or dependencies. */
function productionFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__' || name === '__fixtures__' || name === 'fixtures') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) productionFiles(path, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.(test|spec)\.[tj]sx?$/.test(name) && !/\.behaviorTests\.ts$/.test(name)) out.push(path);
  }
  return out;
}

const FILES = ROOTS.flatMap((root) => productionFiles(join(REPO, root))).map((path) => ({ path: relative(REPO, path), text: readFileSync(path, 'utf8') }));

/** What may mention each token. Keep these lists short: every entry is a place the trust rule must be re-checked. */
const RULES: Array<{ name: string; token: RegExp; allowed: string[]; why: string }> = [
  {
    name: 'the reviewed (owner-only) move quality',
    token: /deriveReviewedMoveQuality|reviewedMoveQuality|ReviewedMoveQuality/,
    allowed: [
      'packages/review-engine/src/reviewedMoveQuality.ts', // the definition
      'packages/review-engine/src/index.ts', // its export
      'server/src/reviewCompletion/reviewCompletionWorker.ts', // returned to the job's OWNER on the review read, nothing else
      'client/scripts/summarizeReviewedMoveQualityDifferential.mjs', // offline audit summary of exported rows; no server access
    ],
    why: 'it is owner-only: its played action is client-asserted',
  },
  {
    name: 'the shareability gate',
    token: /assertMoveQualityShareable|ShareableMoveQuality|MoveQualityNotShareableError/,
    allowed: ['packages/review-engine/src/reviewedMoveQuality.ts', 'packages/review-engine/src/index.ts'],
    why: 'nothing may be shared yet, so nothing may call the gate; the first caller must be reviewed against the rule above',
  },
  {
    name: 'the legacy avg_move_quality column',
    token: /avg_move_quality/,
    allowed: [
      'client/src/stats/statsApi.ts', // a comment: the browser read path avoids the column
      'client/src/stats/statsDerivations.ts', // legacy read-side type; the column is never selected, so it is always null
    ],
    why: 'no server code may write or read it: the old client-asserted path was removed, and a production column may or may not exist',
  },
];

type SourceFile = { path: string; text: string };
type Rule = (typeof RULES)[number];
const usersOf = (files: SourceFile[], rule: Rule): string[] => files.filter((f) => rule.token.test(f.text)).map((f) => f.path).sort();
const unexpectedUsersOf = (files: SourceFile[], rule: Rule): string[] => usersOf(files, rule).filter((path) => !rule.allowed.includes(path));

describe('move quality persistence guard', () => {
  it('rejects an attempt to persist, rank, reward, publish or expose the value (synthetic violations are detected)', () => {
    const synthetic: SourceFile[] = [
      { path: 'server/src/stats/persistMoveQuality.ts', text: "supabaseFetch('/rest/v1/matches', { body: { avg_move_quality: reviewedMoveQuality.avgMoveQuality } })" },
      { path: 'server/src/ranking/moveQualityRank.ts', text: 'const q = deriveReviewedMoveQuality(job); rankPlayers(q.avgMoveQuality)' },
      { path: 'server/src/rewards/moveQualityBadge.ts', text: 'if (deriveReviewedMoveQuality(job).avgMoveQuality > 90) grantBadge()' },
      { path: 'server/src/social/publishQuality.ts', text: 'const shareable = assertMoveQualityShareable(q); feed.publish(shareable)' },
      { path: 'client/src/screens/ProfileScreen.tsx', text: '<span>{data.reviewedMoveQuality.avgMoveQuality}</span>' },
      // the allowlisted definition is not flagged
      { path: 'packages/review-engine/src/reviewedMoveQuality.ts', text: 'deriveReviewedMoveQuality assertMoveQualityShareable' },
    ];
    const byRule = Object.fromEntries(RULES.map((rule) => [rule.name, unexpectedUsersOf(synthetic, rule)]));
    expect(byRule['the reviewed (owner-only) move quality']).toEqual([
      'client/src/screens/ProfileScreen.tsx', // exposed to another user
      'server/src/ranking/moveQualityRank.ts', // ranked
      'server/src/rewards/moveQualityBadge.ts', // rewarded
      'server/src/stats/persistMoveQuality.ts', // persisted
    ]);
    expect(byRule['the shareability gate']).toEqual(['server/src/social/publishQuality.ts']); // published
    expect(byRule['the legacy avg_move_quality column']).toEqual(['server/src/stats/persistMoveQuality.ts']);
    // and the real tree has none of these
    for (const rule of RULES) expect(unexpectedUsersOf(FILES, rule), rule.name).toEqual([]);
  });

  it('scans a real tree (the guard cannot pass vacuously)', () => {
    const paths = FILES.map((f) => f.path);
    expect(paths).toContain('server/src/reviewCompletion/reviewCompletionWorker.ts');
    expect(paths).toContain('packages/review-engine/src/reviewedMoveQuality.ts');
    expect(paths).toContain('client/src/stats/statsDerivations.ts');
    expect(FILES.length).toBeGreaterThan(500);
  });

  for (const rule of RULES) {
    it(`only the allowlisted files use ${rule.name}`, () => {
      const users = FILES.filter((f) => rule.token.test(f.text)).map((f) => f.path).sort();
      const unexpected = users.filter((path) => !rule.allowed.includes(path));
      expect(
        unexpected,
        `${unexpected.join(', ')} now use ${rule.name}. Rule: move quality must not be persisted, published, ranked, rewarded, or exposed to another user until the played action is server-authoritative (${rule.why}). If this use is safe, add the file to the allowlist in reviewedMoveQualityGuard.test.ts and say why.`,
      ).toEqual([]);
      // and the allowlist stays honest: every entry still uses the token
      const stale = rule.allowed.filter((path) => !users.includes(path));
      expect(stale, `stale allowlist entries for ${rule.name}: ${stale.join(', ')}`).toEqual([]);
    });
  }

  it('the review job read is the only place the server returns it, and it never touches the database', () => {
    const worker = FILES.find((f) => f.path === 'server/src/reviewCompletion/reviewCompletionWorker.ts')!.text;
    const uses = worker.split('\n').filter((line) => /deriveReviewedMoveQuality/.test(line) && !/^\s*(\/\/|\*|import|deriveReviewedMoveQuality,)/.test(line));
    expect(uses.length).toBe(2);
    // both uses are response fields of the owner's own job read
    for (const line of uses) expect(line).toMatch(/^\s*reviewedMoveQuality: deriveReviewedMoveQuality\(job\),$/);
    expect(worker).not.toMatch(/supabaseFetch|rest\/v1\/matches|avg_move_quality/);
  });
});
