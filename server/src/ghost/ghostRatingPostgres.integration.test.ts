import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const url = process.env.RACEHORSE_REMEDIATION_TEST_DATABASE_URL;
const allowed = Boolean(url && /^postgres(?:ql)?:\/\/[^/]*127\.0\.0\.1:55432\/racehorse_remediation$/.test(url));
const psqlBin = process.env.PSQL_BIN || 'psql';

function sql(query: string): string {
  if (!url || !allowed) throw new Error('Refusing nonlocal remediation test database');
  return execFileSync(psqlBin, ['-X', '-v', 'ON_ERROR_STOP=1', '-At', url, '-c', query], {
    encoding: 'utf8', timeout: 10_000,
  }).trim();
}

async function sqlAsync(query: string): Promise<string> {
  if (!url || !allowed) throw new Error('Refusing nonlocal remediation test database');
  const result = await execFileAsync(psqlBin, ['-X', '-v', 'ON_ERROR_STOP=1', '-At', url, '-c', query], {
    encoding: 'utf8', timeout: 10_000,
  });
  return result.stdout.trim();
}

function seed(): string {
  const userId = randomUUID();
  sql(`insert into auth.users(id) values ('${userId}')`);
  return userId;
}

function complete(userId: string, matchId: string, score = 60): string {
  return `select public.complete_ghost_rating_v2('${userId}','${matchId}',${score},10,'[]'::jsonb,'ghost',1000,true)`;
}

describe.skipIf(!allowed)('Ghost real PostgreSQL completion', () => {
  it('returns the original stored rating after a later completion step fails and retries', () => {
    const userId = seed();
    const matchId = randomUUID();
    const first = JSON.parse(sql(complete(userId, matchId)));
    // Simulate the next application write failing after this transaction committed.
    const retry = JSON.parse(sql(complete(userId, matchId)));
    expect(first.isNewGame).toBe(true);
    expect(retry.isNewGame).toBe(false);
    expect(retry.newRating).toBe(first.newRating);
    expect(retry.ratingDelta).toBe(first.ratingDelta);
    expect(sql(`select games_played from public.ghost_profiles where user_id='${userId}'`)).toBe('1');
    expect(sql(`select count(*) from public.ghost_games where match_id='${matchId}'`)).toBe('1');
  });

  it('serializes two independent matches for the same player', async () => {
    const userId = seed();
    const ids = [randomUUID(), randomUUID()];
    const [first, second] = await Promise.all(ids.map((id) => sqlAsync(complete(userId, id))));
    const results = [JSON.parse(first), JSON.parse(second)];
    expect(results.every((x) => x.isNewGame)).toBe(true);
    expect(sql(`select games_played from public.ghost_profiles where user_id='${userId}'`)).toBe('2');
    const stored = ids.map((id) => Number(sql(`select rating_after from public.ghost_games where match_id='${id}'`)));
    expect(stored).toContain(Number(sql(`select ghost_rating from public.ghost_profiles where user_id='${userId}'`)));
    expect(new Set(stored).size).toBe(2);
    const replay = JSON.parse(sql(complete(userId, ids[0])));
    expect(replay.newRating).toBe(stored[0]);
    expect(sql(`select games_played from public.ghost_profiles where user_id='${userId}'`)).toBe('2');
  });

  it('keeps both human seats when they share a live match ID', () => {
    const firstUser = seed();
    const secondUser = seed();
    const matchId = randomUUID();
    expect(JSON.parse(sql(complete(firstUser, matchId))).isNewGame).toBe(true);
    expect(JSON.parse(sql(complete(secondUser, matchId))).isNewGame).toBe(true);
    expect(sql(`select count(*) from public.ghost_games where match_id='${matchId}'`)).toBe('2');
  });
});
