import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsState = vi.hoisted(() => ({ content: '' }));

vi.mock('node:fs', () => ({
  default: {
    promises: {
      mkdir: vi.fn(async () => undefined),
      appendFile: vi.fn(async (_path: string, data: string) => {
        fsState.content += data;
      }),
      readFile: vi.fn(async () => {
        if (!fsState.content) throw new Error('ENOENT');
        return fsState.content;
      }),
    },
  },
}));

import { appendMatch, computeWeeklyAwards } from './matchLog';

const baseEntry = {
  endedAtMs: Date.now(),
  roomCode: 'ROOM1',
  a: { seatId: 'p1', userId: 'u1', username: 'Alice' },
  b: { seatId: 'p2', userId: 'u2', username: 'Bob' },
  scoreA: 61,
  scoreB: 30,
  winnerSeatId: 'p1',
  pointDiff: 31,
};

beforeEach(() => {
  fsState.content = '';
  vi.clearAllMocks();
});

describe('appendMatch — MP-G4 idempotency', () => {
  it('a retry with the same sourceMatchId does not append a second line', async () => {
    const first = await appendMatch({ id: 'match-abc', ...baseEntry });
    const second = await appendMatch({ id: 'match-abc', ...baseEntry, scoreB: 999 });

    expect(second.id).toBe(first.id);
    // the second call returns the ORIGINAL entry, not the re-supplied one
    expect(second.scoreB).toBe(30);
    expect(fsState.content.trim().split('\n')).toHaveLength(1);
  });

  it('different sourceMatchIds each append', async () => {
    await appendMatch({ id: 'match-a', ...baseEntry });
    await appendMatch({ id: 'match-b', ...baseEntry });
    expect(fsState.content.trim().split('\n')).toHaveLength(2);
  });

  it('no id still appends every time (legacy behaviour)', async () => {
    await appendMatch({ ...baseEntry });
    await appendMatch({ ...baseEntry });
    expect(fsState.content.trim().split('\n')).toHaveLength(2);
  });
});

describe('computeWeeklyAwards — MP-G4 dedup-on-read backstop', () => {
  it('counts a duplicated match id once', async () => {
    const now = Date.now();
    const line = JSON.stringify({ id: 'dup-1', ...baseEntry, endedAtMs: now });
    fsState.content = `${line}\n${line}\n`;

    const awards = await computeWeeklyAwards(now);
    const mostWins = awards.awards.find((a) => a.key === 'mostWins');
    expect(mostWins?.leader?.value).toBe(1); // not 2
  });
});
