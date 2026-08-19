// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import { createDailyFritzChallengeIdentity } from '../../dailyFritz/dailyFritzChallengeIdentity.ts';
import {
  buildDailyFritzStorageKey,
  DAILY_FRITZ_SESSION_SCHEMA_VERSION,
  discardDailyFritzSnapshot,
  discardDailyFritzSnapshotBeforeReload,
  loadPersistedDailyFritzMatch,
  loadDailyFritzResumeSnapshot,
  parseDailyFritzPersistedSnapshot,
  persistDailyFritzSnapshot,
  reconcileDailyFritzResume,
  type DailyFritzPersistedSnapshot,
  type DailyFritzResumeRejection,
} from './dailyFritzSessionStorage.ts';

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

describe('Daily Fritz v3 session persistence', () => {
  beforeEach(() => window.localStorage.clear());
  it('round-trips a valid active hand without resetting cumulative scores', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    const value = snapshot();
    expect(persistDailyFritzSnapshot(key, value)).toBe(true);
    const loaded = loadPersistedDailyFritzMatch(key, 'attempt-1', 2, '2026-07-12', now, RUN_FP, undefined, undefined, AUTHORITY_REVISION, 1);
    expect(loaded?.match.players.you.score).toBe(35);
    expect(loaded?.match.players.bot.score).toBe(20);
  });
  it('rejects a local checkpoint that does not match the server hand index', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    const value = snapshot({ currentHandIndex: 4 });
    expect(persistDailyFritzSnapshot(key, value)).toBe(true);
    expect(loadPersistedDailyFritzMatch(key, 'attempt-1', 0, '2026-07-12', now, RUN_FP, undefined, undefined, AUTHORITY_REVISION, 1)).toBeNull();
    expect(loadPersistedDailyFritzMatch(key, 'attempt-1', 4, '2026-07-12', now, RUN_FP, undefined, undefined, AUTHORITY_REVISION, 1)).toBeNull();
  });
  it('rejects a checkpoint when the server run fingerprint changes', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    expect(persistDailyFritzSnapshot(key, snapshot())).toBe(true);
    expect(loadPersistedDailyFritzMatch(key, 'attempt-1', 2, '2026-07-12', now, 'different-fingerprint', undefined, undefined, AUTHORITY_REVISION, 1)).toBeNull();
  });
  it('rejects a checkpoint pinned to a different Fritz policy deployment', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    expect(persistDailyFritzSnapshot(key, snapshot({
      fritzPolicyVersion: 1,
      fritzPolicyContract: 'fritz-policy-v1-seeded-top-score',
    }))).toBe(true);
    expect(loadPersistedDailyFritzMatch(
      key,
      'attempt-1',
      2,
      '2026-07-12',
      now,
      RUN_FP,
      2,
      'fritz-policy-v2-deterministic-canonical-ties',
      AUTHORITY_REVISION,
      1,
    )).toBeNull();
  });
  it('rejects an unversioned legacy checkpoint when the attempt is policy-pinned', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    expect(persistDailyFritzSnapshot(key, snapshot())).toBe(true);
    expect(loadPersistedDailyFritzMatch(
      key,
      'attempt-1',
      2,
      '2026-07-12',
      now,
      RUN_FP,
      2,
      'fritz-policy-v2-deterministic-canonical-ties',
      AUTHORITY_REVISION,
      1,
    )).toBeNull();
  });
  it('rejects malformed, stale-date, version-mismatched, and impossible phase payloads', () => {
    expect(parseDailyFritzPersistedSnapshot({}, now)).toBeNull();
    expect(parseDailyFritzPersistedSnapshot(snapshot({ challenge: createDailyFritzChallengeIdentity('2026-07-11') }), now)).toBeNull();
    expect(parseDailyFritzPersistedSnapshot({ ...snapshot(), schemaVersion: 6 }, now)).toBeNull();
    expect(parseDailyFritzPersistedSnapshot(snapshot({ lifecyclePhase: 'hand_transition' }), now)).toBeNull();
  });
  it('retains coherent hand-transition and terminal evidence at the exact authority cursor', () => {
    const transitionMatch = createBotMatch(60, 7);
    transitionMatch.handNumber = 3;
    transitionMatch.handOver = true;
    const handResult = {
      winner: 'you' as const,
      reason: 'domino' as const,
      pointsAwarded: 10,
      loserPips: 10,
      calcText: '10 points',
      yourRemainingTiles: [],
      botRemainingTiles: [{ low: 1, high: 2 }],
    };
    expect(parseDailyFritzPersistedSnapshot(snapshot({ match: transitionMatch, lifecyclePhase: 'hand_transition', handResult }), now)?.lifecyclePhase).toBe('hand_transition');
    const completedMatch = { ...transitionMatch, handOver: false, gameOver: true };
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    persistDailyFritzSnapshot(key, snapshot({ match: completedMatch, lifecyclePhase: 'completed' }));
    expect(loadPersistedDailyFritzMatch(key, 'attempt-1', 2, '2026-07-12', now, RUN_FP, undefined, undefined, AUTHORITY_REVISION, 1)?.lifecyclePhase).toBe('completed');
  });
  it('resumes mid-hand with the exact server hand index and preserved board/boneyard', () => {
    const midHand = createBotMatch(60, 7);
    midHand.players.you.score = 18;
    midHand.players.bot.score = 12;
    midHand.boneyard = midHand.boneyard.slice(0, 5);
    midHand.handNumber = 3;
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    expect(persistDailyFritzSnapshot(key, snapshot({
      currentHandIndex: 2,
      lifecyclePhase: 'active_hand',
      match: midHand,
      movesUsed: 11,
    }))).toBe(true);
    const loaded = loadPersistedDailyFritzMatch(key, 'attempt-1', 2, '2026-07-12', now, RUN_FP, undefined, undefined, AUTHORITY_REVISION, 1);
    expect(loaded?.currentHandIndex).toBe(2);
    expect(loaded?.match.players.you.score).toBe(18);
    expect(loaded?.match.players.bot.score).toBe(12);
    expect(loaded?.match.boneyard).toHaveLength(5);
    expect(loaded?.match.handNumber).toBe(3);
    expect(loadPersistedDailyFritzMatch(key, 'attempt-1', 3, '2026-07-12', now, RUN_FP, undefined, undefined, AUTHORITY_REVISION + 1, 1)).toBeNull();
  });
  it('prevents an older revision or timestamp from overwriting newer state', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    expect(persistDailyFritzSnapshot(key, snapshot({ checkpointRevision: 5 }))).toBe(true);
    expect(persistDailyFritzSnapshot(key, snapshot({ checkpointRevision: 4, lastTransitionAt: '2026-07-12T18:02:00.000Z' }))).toBe(false);
    expect(JSON.parse(localStorage.getItem(key)!).checkpointRevision).toBe(5);
  });
  it('resume after next-hand request committed but response was lost discards the rejected terminal checkpoint before saving the authoritative hand', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    const terminalMatch = snapshot().match;
    terminalMatch.handOver = true;
    expect(persistDailyFritzSnapshot(key, snapshot({
      currentHandIndex: 2,
      authorityRevision: AUTHORITY_REVISION,
      lifecyclePhase: 'hand_transition',
      match: terminalMatch,
      handResult: {
        winner: 'you',
        reason: 'domino',
        pointsAwarded: 10,
        loserPips: 10,
        calcText: '10 points',
        yourRemainingTiles: [],
        botRemainingTiles: [{ low: 1, high: 2 }],
      },
      checkpointRevision: 19,
    }))).toBe(true);

    expect(loadPersistedDailyFritzMatch(
      key,
      'attempt-1',
      3,
      '2026-07-12',
      now,
      RUN_FP,
      undefined,
      undefined,
      AUTHORITY_REVISION + 1,
      1,
    )).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();

    const authoritativeHand = snapshot({
      currentHandIndex: 3,
      authorityRevision: AUTHORITY_REVISION + 1,
      match: { ...snapshot().match, handNumber: 4 },
      checkpointRevision: 1,
    });
    expect(persistDailyFritzSnapshot(key, authoritativeHand)).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(key)!).checkpointRevision).toBe(1);
  });
  it('discards a checkpoint re-persisted before an authority reload', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    expect(persistDailyFritzSnapshot(key, snapshot())).toBe(true);
    discardDailyFritzSnapshot(key);
    // The mounted persistence effect can recreate the rejected checkpoint
    // between the 409 response and the player's recovery click.
    expect(persistDailyFritzSnapshot(key, snapshot({ checkpointRevision: 3 }))).toBe(true);
    let checkpointAtReload: string | null = 'not-checked';

    discardDailyFritzSnapshotBeforeReload(key, () => {
      checkpointAtReload = window.localStorage.getItem(key);
    });

    expect(checkpointAtReload).toBeNull();
  });
  it('removes and replaces a checkpoint from the unsafe draw-presentation schema', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    window.localStorage.setItem(key, JSON.stringify({
      ...snapshot(),
      schemaVersion: 6,
      checkpointRevision: 99,
    }));

    expect(loadPersistedDailyFritzMatch(
      key,
      'attempt-1',
      2,
      '2026-07-12',
      now,
      RUN_FP,
      undefined,
      undefined,
      AUTHORITY_REVISION,
      1,
    )).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();

    expect(persistDailyFritzSnapshot(key, snapshot({ checkpointRevision: 1 }))).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(key)!).schemaVersion)
      .toBe(DAILY_FRITZ_SESSION_SCHEMA_VERSION);
  });
  it('migrates a coherent schema-8 hand onto the server authority revision', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    const legacy = snapshot({ checkpointRevision: 6 });
    const { authorityRevision: _authorityRevision, checkpointRevision, ...schema8 } = legacy;
    window.localStorage.setItem(key, JSON.stringify({
      ...schema8,
      schemaVersion: 8,
      revision: checkpointRevision,
    }));

    const loaded = loadPersistedDailyFritzMatch(
      key,
      'attempt-1',
      2,
      '2026-07-12',
      now,
      RUN_FP,
      undefined,
      undefined,
      AUTHORITY_REVISION,
      1,
    );

    expect(loaded?.authorityRevision).toBe(AUTHORITY_REVISION);
    expect(loaded?.checkpointRevision).toBe(6);
    const migrated = JSON.parse(window.localStorage.getItem(key)!);
    expect(migrated.schemaVersion).toBe(9);
    expect(migrated.revision).toBeUndefined();
  });
  it('rejects a schema-8 checkpoint that relabeled the previous match with the new hand index', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    const torn = snapshot({ currentHandIndex: 3, checkpointRevision: 6 });
    const { authorityRevision: _authorityRevision, checkpointRevision, ...schema8 } = torn;
    window.localStorage.setItem(key, JSON.stringify({
      ...schema8,
      schemaVersion: 8,
      revision: checkpointRevision,
    }));

    expect(loadPersistedDailyFritzMatch(
      key,
      'attempt-1',
      3,
      '2026-07-12',
      now,
      RUN_FP,
      undefined,
      undefined,
      AUTHORITY_REVISION,
      1,
    )).toBeNull();
  });
  it('repairs duplicate physical-tile evidence before a saved hand resumes', () => {
    const duplicatePlacement = {
      moveNumber: 1,
      handNumber: 1,
      player: 'you' as const,
      action: 'place' as const,
      tile: [0, 5] as [number, number],
      position: 'left' as const,
      boardEnds: [-1, -1] as [number, number],
      handBefore: [[0, 5]] as [number, number][],
      validMoves: [[0, 5]] as [number, number][],
      pipDelta: 5,
      pointsScored: 1,
      boardState: [],
      boardRenderState: null,
      handSnapshot: [[0, 5]] as [number, number][],
      engineBestMove: null,
    };
    const parsed = parseDailyFritzPersistedSnapshot(snapshot({
      moveLog: [
        duplicatePlacement,
        {
          ...duplicatePlacement,
          moveNumber: 3,
          position: 'right',
          boardEnds: [5, 5],
        },
      ],
    }), now);

    expect(parsed?.moveLog).toHaveLength(1);
    expect(parsed?.moveLog[0]?.moveNumber).toBe(1);
  });

  it('treats checkpoints without protocol provenance as legacy transcript v1', () => {
    const parsed = parseDailyFritzPersistedSnapshot(snapshot(), now);
    expect(parsed?.transcriptProtocolVersion).toBe(1);
  });

  it('preserves explicit protocol v2 provenance for new checkpoints', () => {
    const parsed = parseDailyFritzPersistedSnapshot(
      snapshot({ transcriptProtocolVersion: 2 }),
      now,
    );
    expect(parsed?.transcriptProtocolVersion).toBe(2);
  });

  describe.each([
    {
      name: 'resume before next-hand request is sent',
      local: { gameNumber: 1, currentHandIndex: 2, authorityRevision: 7, matchHandNumber: 3 },
      server: { gameNumber: 1, handIndex: 2, revision: 7 },
      accepted: true,
    },
    {
      name: 'resume while next-hand request is sent but not committed',
      local: { gameNumber: 1, currentHandIndex: 2, authorityRevision: 7, matchHandNumber: 3 },
      server: { gameNumber: 1, handIndex: 2, revision: 7 },
      accepted: true,
    },
    {
      name: 'resume after next-hand request committed but response was lost',
      local: { gameNumber: 1, currentHandIndex: 2, authorityRevision: 7, matchHandNumber: 3 },
      server: { gameNumber: 1, handIndex: 3, revision: 8 },
      accepted: false,
      reason: 'hand_mismatch' as DailyFritzResumeRejection,
    },
    {
      name: 'resume after next-hand response arrived before local cursor update',
      local: { gameNumber: 1, currentHandIndex: 2, authorityRevision: 7, matchHandNumber: 3 },
      server: { gameNumber: 1, handIndex: 3, revision: 8 },
      accepted: false,
      reason: 'hand_mismatch' as DailyFritzResumeRejection,
    },
    {
      name: 'resume after next-hand cursor updated before match state',
      local: { gameNumber: 1, currentHandIndex: 3, authorityRevision: 8, matchHandNumber: 3 },
      server: { gameNumber: 1, handIndex: 3, revision: 8 },
      accepted: false,
      reason: 'match_hand_mismatch' as DailyFritzResumeRejection,
    },
    {
      name: 'resume after next-hand match updated before local snapshot',
      local: { gameNumber: 1, currentHandIndex: 2, authorityRevision: 7, matchHandNumber: 3 },
      server: { gameNumber: 1, handIndex: 3, revision: 8 },
      accepted: false,
      reason: 'hand_mismatch' as DailyFritzResumeRejection,
    },
    {
      name: 'resume after next-hand local snapshot update',
      local: { gameNumber: 1, currentHandIndex: 3, authorityRevision: 8, matchHandNumber: 4 },
      server: { gameNumber: 1, handIndex: 3, revision: 8 },
      accepted: true,
    },
    {
      name: 'resume before record-game request is sent',
      local: { gameNumber: 1, currentHandIndex: 3, authorityRevision: 8, matchHandNumber: 4 },
      server: { gameNumber: 1, handIndex: 3, revision: 8 },
      accepted: true,
    },
    {
      name: 'resume while record-game request is sent but not committed',
      local: { gameNumber: 1, currentHandIndex: 3, authorityRevision: 8, matchHandNumber: 4 },
      server: { gameNumber: 1, handIndex: 3, revision: 8 },
      accepted: true,
    },
    {
      name: 'resume after record-game committed but response was lost',
      local: { gameNumber: 1, currentHandIndex: 3, authorityRevision: 8, matchHandNumber: 4 },
      server: { gameNumber: 2, handIndex: 0, revision: 9 },
      accepted: false,
      reason: 'game_mismatch' as DailyFritzResumeRejection,
    },
    {
      name: 'resume after record-game response arrived before local overlay update',
      local: { gameNumber: 1, currentHandIndex: 3, authorityRevision: 8, matchHandNumber: 4 },
      server: { gameNumber: 2, handIndex: 0, revision: 9 },
      accepted: false,
      reason: 'game_mismatch' as DailyFritzResumeRejection,
    },
    {
      name: 'resume before complete request with server set receipt committed',
      local: { gameNumber: 1, currentHandIndex: 3, authorityRevision: 8, matchHandNumber: 4 },
      server: { gameNumber: 1, handIndex: 3, revision: 9 },
      accepted: false,
      reason: 'revision_mismatch' as DailyFritzResumeRejection,
    },
    {
      name: 'resume after complete request committed but response was lost',
      local: { gameNumber: 1, currentHandIndex: 3, authorityRevision: 8, matchHandNumber: 4 },
      server: { gameNumber: 1, handIndex: 3, revision: 10 },
      accepted: false,
      reason: 'revision_mismatch' as DailyFritzResumeRejection,
    },
  ])('$name', ({ local, server, accepted, reason }) => {
    it('reconciles to one coherent authority cursor', () => {
      const value = snapshot({
        gameNumber: local.gameNumber,
        currentHandIndex: local.currentHandIndex,
        authorityRevision: local.authorityRevision,
        match: {
          ...snapshot().match,
          handNumber: local.matchHandNumber,
        },
      });
      const result = reconcileDailyFritzResume(value, {
        attemptId: 'attempt-1',
        challengeId: createDailyFritzChallengeIdentity('2026-07-12').challengeId,
        runFingerprint: RUN_FP,
        cursor: server,
      });
      expect(result.accepted).toBe(accepted);
      if (!accepted && !result.accepted) expect(result.reason).toBe(reason);
    });
  });
  it.each([
    { low: -1, high: 2 },
    { low: 1, high: -1 },
    { low: 7, high: 7 },
    { low: 1, high: 7 },
    { low: 1.5, high: 2 },
    { low: 1, high: '2' },
    { low: 1 },
  ])('rejects an invalid persisted tile %#', (tile) => {
    const value = snapshot();
    value.match.players.you.hand = [tile as never];
    expect(parseDailyFritzPersistedSnapshot(value, now)).toBeNull();
  });

  it('falls back to the server resume checkpoint when local storage is empty', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    const serverSnapshot = snapshot({ checkpointRevision: 5 });
    const loaded = loadDailyFritzResumeSnapshot(key, {
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
      resume_checkpoint: serverSnapshot as unknown as Record<string, unknown>,
    }, now);
    expect(loaded?.checkpointRevision).toBe(5);
    expect(window.localStorage.getItem(key)).not.toBeNull();
  });
});
