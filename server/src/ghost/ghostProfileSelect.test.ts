import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCompositeLog, getGhostProfileSummary } from './service';

/**
 * `buildCompositeLog` reads exactly one thing off the stored log —
 * `recentGameStyles`, to reuse already-computed style snapshots. `states` is
 * rebuilt from the games' move logs on every call, so pulling the stored copy
 * (2.6 MB on the heaviest live account) transfers 2.59 MB that is discarded.
 *
 * These tests pin the narrowed query and prove the discard is genuinely a
 * discard: the summary must be identical whether the row arrives with the whole
 * column or only the sub-field.
 */
const USER = '00000000-0000-4000-8000-000000000abc';

function moveLog(turn: number) {
  return [
    {
      turn,
      actor: 'you',
      tile_played: '6|6',
      branch: 'left',
      board_state: `board:${'x'.repeat(40)}:${turn}`,
      hand_before: ['6|6', '3|4'],
      score_delta: 5,
      hand_number: 1,
    },
  ];
}

function game(i: number) {
  return {
    id: `game-${i}`,
    user_id: USER,
    played_at: `2026-08-${String(28 - (i % 27)).padStart(2, '0')}T00:00:00.000Z`,
    final_score: 60,
    opponent_score: 30,
    move_log: moveLog((i % 5) + 1),
  };
}

const GAMES = Array.from({ length: 20 }, (_, i) => game(i));

/** A stored log whose `states` differ wildly from anything rebuildable. */
const STORED_STATES = [
  {
    key: '99::board:poisoned',
    turn: 99,
    boardState: 'board:poisoned',
    recommendedMove: { tilePlayed: '0|0', branch: 'left', count: 999, bestScoreDelta: 99 },
    candidates: [{ tilePlayed: '0|0', branch: 'left', count: 999, bestScoreDelta: 99 }],
  },
];

const STORED_STYLES = [
  {
    gameId: 'game-0',
    playedAt: '2026-08-28T00:00:00.000Z',
    avgTurnPoints: 12.5,
    handSize: 4.25,
    doublesRate: 0.5,
    branchRate: 0.25,
    forcedDrawRate: 0.1,
    scoringConversion: 0.75,
    spinnerControl: 0.4,
    attackRate: 0.3,
  },
];

let requestedPaths: string[] = [];

type StoredLog = {
  generatedAt?: string;
  sourceGameIds?: string[];
  states?: unknown[];
  recentGameStyles?: unknown[];
} | null;

/**
 * Emulates PostgREST: when the select names the sub-field alias, Postgres
 * projects it server-side and `states` never leaves the database. Both branches
 * are fed from the same stored row so the equality test is meaningful.
 */
function stubSupabase(storedLog: StoredLog) {
  requestedPaths = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string) => {
      const path = String(url);
      requestedPaths.push(path);
      let body: unknown = [];
      if (path.includes('/rest/v1/ghost_profiles')) {
        const narrowed = path.includes('composite_log-%3ErecentGameStyles');
        const base = { user_id: USER, ghost_rating: 900, games_played: GAMES.length };
        body = [
          narrowed
            ? { ...base, recentGameStyles: storedLog?.recentGameStyles ?? null }
            : { ...base, last_updated: null, composite_log: storedLog, style_profile: null },
        ];
      } else if (path.includes('/rest/v1/ghost_games')) {
        body = GAMES;
      }
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
}

const profileQuery = () => requestedPaths.find((p) => p.includes('/rest/v1/ghost_profiles')) ?? '';

const pin = (s: Awaited<ReturnType<typeof getGhostProfileSummary>>) =>
  JSON.stringify({
    ...s,
    compositeLog: s.compositeLog ? { ...s.compositeLog, generatedAt: 'pinned' } : null,
  });

describe('ghost profile select narrowing', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL ??= 'https://stub.supabase.co';
    process.env.SUPABASE_SERVICE_KEY ??= 'stub-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for the recentGameStyles sub-field, not the whole composite_log column', async () => {
    stubSupabase({ recentGameStyles: STORED_STYLES }, 'composite_log');
    await getGhostProfileSummary(USER);

    expect(profileQuery()).toContain('composite_log-%3ErecentGameStyles');
    expect(profileQuery()).not.toMatch(/select=[^&]*[,=]composite_log(?![-%])/);
  });

  it('still issues exactly two Supabase reads', async () => {
    stubSupabase({ recentGameStyles: STORED_STYLES });
    await getGhostProfileSummary(USER);
    expect(requestedPaths).toHaveLength(2);
  });

  it('rebuilds byte-identical states from the sub-field as from the whole column', () => {
    const fullLog = {
      generatedAt: '2026-01-01T00:00:00.000Z',
      sourceGameIds: ['old-1', 'old-2'],
      states: STORED_STATES,
      recentGameStyles: STORED_STYLES,
    } as never;
    const subFieldOnly = { recentGameStyles: STORED_STYLES } as never;

    const fromFull = buildCompositeLog(GAMES as never, GAMES as never, fullLog);
    const fromSub = buildCompositeLog(GAMES as never, GAMES as never, subFieldOnly);

    // The bot's entire input.
    expect(JSON.stringify(fromSub.states)).toBe(JSON.stringify(fromFull.states));
    // And everything else the summary carries.
    expect(JSON.stringify(fromSub.recentGameStyles)).toBe(JSON.stringify(fromFull.recentGameStyles));
    expect(fromSub.sourceGameIds).toEqual(fromFull.sourceGameIds);
  });

  it('never lets a stored state reach the bot — states are always rebuilt from move logs', async () => {
    stubSupabase({
      generatedAt: '2026-01-01T00:00:00.000Z',
      sourceGameIds: ['old'],
      states: STORED_STATES,
      recentGameStyles: STORED_STYLES,
    });
    const summary = await getGhostProfileSummary(USER);

    const keys = summary.compositeLog?.states.map((s) => s.key) ?? [];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).not.toContain('99::board:poisoned');
    for (const state of summary.compositeLog?.states ?? []) {
      expect(state.boardState).toContain('board:xxx');
    }
  });

  it('reuses stored style snapshots, which is the only thing the sub-field is for', async () => {
    stubSupabase({ recentGameStyles: STORED_STYLES });
    const summary = await getGhostProfileSummary(USER);
    const reused = summary.compositeLog?.recentGameStyles.find((s) => s.gameId === 'game-0');
    expect(reused?.avgTurnPoints).toBe(12.5);
  });

  it('handles a profile with no stored log at all', async () => {
    stubSupabase(null);
    const summary = await getGhostProfileSummary(USER);
    expect(summary.compositeLog?.states.length).toBeGreaterThan(0);
    expect(summary.compositeLog?.recentGameStyles.length).toBeGreaterThan(0);
  });
});
