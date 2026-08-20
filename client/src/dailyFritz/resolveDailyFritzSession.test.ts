// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createBotMatch } from '../modules/match/runtime/botEngine';
import { createDailyFritzChallengeIdentity } from './dailyFritzChallengeIdentity';
import { resolveDailyFritzSession } from './resolveDailyFritzSession';
import type { DailyFritzStartResponse } from './api';
import {
  buildDailyFritzStorageKey,
  discardDailyFritzSnapshot,
  DAILY_FRITZ_SESSION_SCHEMA_VERSION,
  persistDailyFritzSnapshot,
  type DailyFritzPersistedSnapshot,
} from '../modules/daily/dailyFritzSessionStorage';

const now = new Date('2026-07-12T20:00:00.000Z');
const RUN_FP = 'abc123fingerprint00000000000000';
const AUTHORITY_REVISION = 7;

function snapshot(overrides: Partial<DailyFritzPersistedSnapshot> = {}): DailyFritzPersistedSnapshot {
  const match = createBotMatch(60, 7);
  match.handNumber = 3;
  match.players.you.score = 35;
  match.players.bot.score = 20;
  return {
    schemaVersion: DAILY_FRITZ_SESSION_SCHEMA_VERSION,
    challenge: createDailyFritzChallengeIdentity('2026-07-12'),
    classification: 'official',
    attemptId: 'attempt-1',
    runFingerprint: RUN_FP,
    gameNumber: 1,
    currentHandIndex: 2,
    authorityRevision: AUTHORITY_REVISION,
    lifecyclePhase: 'active_hand',
    match,
    handResult: null,
    movesUsed: 4,
    moveLog: [],
    transcript: null,
    verificationPhase: 'collecting',
    startedAt: '2026-07-12T18:00:00.000Z',
    lastTransitionAt: '2026-07-12T18:01:00.000Z',
    checkpointRevision: 2,
    ...overrides,
  };
}

function makeStartResponse(
  resumeCheckpoint: Record<string, unknown> | null | undefined,
  overrides: Partial<DailyFritzStartResponse> = {},
): DailyFritzStartResponse {
  return {
    ok: true,
    attempt_id: 'attempt-1',
    verified_match_id: 'verified-1',
    authority_revision: AUTHORITY_REVISION,
    run_date: '2026-07-12',
    run_fingerprint: RUN_FP,
    current_hand_index: 2,
    current_game_number: 1,
    set_result: null,
    fritz_tier: 'standard',
    deal_size: 7,
    winning_score: 100,
    first_hand: {
      player_tiles: [],
      fritz_tiles: [],
      boneyard: [],
      locked: [],
    },
    draw_winner: 'you',
    draw_player_tile: { low: 1, high: 2 },
    draw_fritz_tile: { low: 2, high: 3 },
    resume_checkpoint: resumeCheckpoint ?? undefined,
    ...overrides,
  };
}

describe('resolveDailyFritzSession', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns a playable snapshot from resume_checkpoint when authority matches', () => {
    const resolved = resolveDailyFritzSession(
      makeStartResponse(snapshot({ checkpointRevision: 5 }) as unknown as Record<string, unknown>),
      now,
    );
    expect(resolved?.checkpointRevision).toBe(5);
    expect(resolved?.match.players.you.score).toBe(35);
    expect(resolved?.currentHandIndex).toBe(2);
  });

  it('returns null when resume_checkpoint is absent', () => {
    expect(resolveDailyFritzSession(makeStartResponse(null), now)).toBeNull();
  });

  it('returns null when resume_checkpoint is malformed', () => {
    expect(resolveDailyFritzSession(makeStartResponse({ schemaVersion: 6 }), now)).toBeNull();
  });

  it('returns null when checkpoint cursor does not match start authority (torn checkpoint)', () => {
    const torn = snapshot({
      currentHandIndex: 3,
      authorityRevision: AUTHORITY_REVISION + 1,
      match: { ...snapshot().match, handNumber: 3 },
    });
    expect(resolveDailyFritzSession(
      makeStartResponse(torn as unknown as Record<string, unknown>, {
        current_hand_index: 3,
        authority_revision: AUTHORITY_REVISION + 1,
      }),
      now,
    )).toBeNull();
  });

  it('ignores stale localStorage and resolves from server checkpoint alone', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    const staleLocal = snapshot({
      currentHandIndex: 99,
      checkpointRevision: 999,
      match: { ...snapshot().match, handNumber: 100 },
    });
    persistDailyFritzSnapshot(key, staleLocal);

    const serverSnapshot = snapshot({ checkpointRevision: 5 });
    const resolved = resolveDailyFritzSession(
      makeStartResponse(serverSnapshot as unknown as Record<string, unknown>),
      now,
    );

    expect(resolved?.currentHandIndex).toBe(2);
    expect(resolved?.checkpointRevision).toBe(5);
    expect(JSON.parse(window.localStorage.getItem(key)!).currentHandIndex).toBe(99);
  });

  it('bootstrap seeding replaces stale localStorage with server authority', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    persistDailyFritzSnapshot(key, snapshot({
      currentHandIndex: 99,
      checkpointRevision: 999,
    }));

    const serverSnapshot = snapshot({ checkpointRevision: 5 });
    const resolved = resolveDailyFritzSession(
      makeStartResponse(serverSnapshot as unknown as Record<string, unknown>),
      now,
    );
    expect(resolved).not.toBeNull();
    discardDailyFritzSnapshot(key);
    persistDailyFritzSnapshot(key, resolved!);

    const seeded = JSON.parse(window.localStorage.getItem(key)!);
    expect(seeded.currentHandIndex).toBe(2);
    expect(seeded.checkpointRevision).toBe(5);
  });

  it('ignores corrupt localStorage without throwing', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    window.localStorage.setItem(key, '{not-json');

    const resolved = resolveDailyFritzSession(
      makeStartResponse(snapshot() as unknown as Record<string, unknown>),
      now,
    );
    expect(resolved?.currentHandIndex).toBe(2);
  });
});
