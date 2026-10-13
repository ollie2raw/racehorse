import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { holdPostgresRowLock, waitForBlockedPostgresCalls } from '../../test/support/postgresLockBarrier';

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

function seed(): { userId: string; gameId: string } {
  const userId = randomUUID();
  const gameId = randomUUID();
  sql(`insert into auth.users(id) values ('${userId}');
       insert into public.profiles(id,username) values ('${userId}','Ranked Test');
       insert into public.ranked_games(id,player_id) values ('${gameId}','${userId}')`);
  return { userId, gameId };
}

function commit(userId: string, gameId: string, before: number, after: number, count: number, rdBefore = 350): string {
  return `select public.commit_glicko_game_update('${userId}',${after},300,0.06,now(),true,${after},${count},'${gameId}',${after - before},${before},${rdBefore},0.06)`;
}

describe.skipIf(!allowed)('ranked rating real PostgreSQL claim', () => {
  it('consumes the same game once under overlap, including a retry after response loss', async () => {
    const { userId, gameId } = seed();
    const release = await holdPostgresRowLock(url!, `select 1 from public.ranked_games where id='${gameId}' for update`, psqlBin);
    const racing = Promise.allSettled([
      sqlAsync(commit(userId, gameId, 800, 810, 1)),
      sqlAsync(commit(userId, gameId, 800, 810, 1)),
    ]);
    try {
      await waitForBlockedPostgresCalls(url!, 'commit_glicko_game_update', 2, psqlBin);
    } finally {
      await release();
    }
    const attempts = await racing;
    expect(attempts.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((x) => x.status === 'rejected')).toHaveLength(1);
    expect(() => sql(commit(userId, gameId, 800, 810, 1))).toThrow(/ranked_already_processed/);
    expect(sql(`select count(*) from public.rating_periods where ranked_game_id='${gameId}'`)).toBe('1');
    expect(sql(`select ranked_games_played from public.profiles where id='${userId}'`)).toBe('1');
  });

  it('serializes different games for one player and rejects stale prior state', async () => {
    const { userId, gameId: firstId } = seed();
    const secondId = randomUUID();
    sql(`insert into public.ranked_games(id,player_id) values ('${secondId}','${userId}')`);
    const release = await holdPostgresRowLock(url!, `select 1 from public.profiles where id='${userId}' for update`, psqlBin);
    const racing = Promise.allSettled([
      sqlAsync(commit(userId, firstId, 800, 810, 1)),
      sqlAsync(commit(userId, secondId, 800, 820, 1)),
    ]);
    try {
      await waitForBlockedPostgresCalls(url!, 'commit_glicko_game_update', 2, psqlBin);
    } finally {
      await release();
    }
    const attempts = await racing;
    expect(attempts.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((x) => x.status === 'rejected')).toHaveLength(1);
    const firstApplied = sql(`select rating_after is not null from public.ranked_games where id='${firstId}'`) === 't';
    const winningRating = firstApplied ? 810 : 820;
    const pendingId = firstApplied ? secondId : firstId;
    sql(commit(userId, pendingId, winningRating, winningRating + 5, 2, 300));
    expect(sql(`select ranked_games_played from public.profiles where id='${userId}'`)).toBe('2');
    expect(Number(sql(`select glicko_rating from public.profiles where id='${userId}'`))).toBe(winningRating + 5);
    expect(sql(`select count(*) from public.rating_periods where user_id='${userId}'`)).toBe('2');
  });

  it('serializes a no-game decay against a new game', async () => {
    const { userId, gameId } = seed();
    const decay = `select public.commit_glicko_decay_update('${userId}',360,now(),800,350,0.06,0)`;
    const release = await holdPostgresRowLock(url!, `select 1 from public.profiles where id='${userId}' for update`, psqlBin);
    const racing = Promise.allSettled([
      sqlAsync(commit(userId, gameId, 800, 810, 1)),
      sqlAsync(decay),
    ]);
    try {
      await waitForBlockedPostgresCalls(url!, 'commit_glicko_game_update', 1, psqlBin);
      await waitForBlockedPostgresCalls(url!, 'commit_glicko_decay_update', 1, psqlBin);
    } finally {
      await release();
    }
    const attempts = await racing;
    expect(attempts.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((x) => x.status === 'rejected')).toHaveLength(1);
    expect(sql(`select count(*) from public.rating_periods where user_id='${userId}'`)).toBe('1');
    const gameApplied = sql(`select rating_after is not null from public.ranked_games where id='${gameId}'`) === 't';
    expect(sql(`select glicko_rd from public.profiles where id='${userId}'`)).toBe(gameApplied ? '300' : '360');
  });
});
