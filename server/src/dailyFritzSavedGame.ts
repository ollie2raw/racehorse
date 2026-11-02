import type { DailyFritzSetGameNumber } from './dailyFritz';
import type { DailyFritzPublishedChallenge } from './dailyFritzPublishedChallenge';
import { replayVerifiedDailyFritzHand } from './dailyFritzHandReplay';
import type { StoredDailyFritzHandRecord } from './dailyFritzHandRecords';
import { buildDailyFritzGameRecord, type OkHandReplay } from './gameRecords/dailyFritzGameRecord';
import type { MultiplayerRecordDraft } from './gameRecords/multiplayerRecord';
import { replayMultiplayerRecord } from './gameRecords/multiplayerReplay';
import { buildHandVerificationInput } from './http/routes/dailyFritzVerificationGlue';
import { readAuthorityLedger } from './http/routes/dailyFritzVerificationPolicy';
import { normalizeDailyFritzSetResult, type DailyFritzAttemptRecord, type DailyFritzRunRecord } from './http/stores/dailyFritzStore';

/**
 * One finished Daily Fritz game, derived when asked for (docs/daily-fritz-review-design.md, DF-3b).
 *
 * Nothing is written. The attempt's verified ledger says which hands make up the game and what the verified result was; the hand transcripts the server kept
 * (DF-2) supply the moves; each hand is rebuilt from EXACTLY the inputs verification used (`buildHandVerificationInput`) and replayed through the verifier itself
 * (DF-1); the game is assembled in the multiplayer record format (DF-3a) and must then replay through that format's own pure replay to the ledger's scores.
 * Anything that does not line up is a reason, never a guess: a game is either reviewable and provably the game that was verified, or it is not offered.
 */

export type DailyFritzSavedGame = {
  /** Stable id for this game in the review's own storage. Not a database key. */
  sourceMatchId: string;
  mode: 'dfz';
  runDate: string;
  gameNumber: DailyFritzSetGameNumber;
  dealSize: 7 | 14 | null;
  winningScore: number;
  result: { you: number; opponent: number; winner: 'you' | 'opponent' | null };
  verification: 'replay_verified';
  playedAt: string | null;
  /** The opponent is always Fritz. */
  opponentName: 'Fritz';
  /** Engine steps the verifier had to infer for this game (0 means the client's transcripts were complete). */
  inferredStepCount: number;
  record: MultiplayerRecordDraft;
};

export type DeriveSavedGameResult = { ok: true; game: DailyFritzSavedGame } | { ok: false; reason: string };

export function dailyFritzSavedGameId(attemptId: string, gameNumber: number): string {
  return `dfz:${attemptId}:${gameNumber}`;
}

/** One finished, verified Daily Fritz game as the Games page lists it. */
export type DailyFritzGameListEntry = {
  sourceMatchId: string;
  attemptId: string;
  runDate: string;
  gameNumber: DailyFritzSetGameNumber;
  result: { you: number; opponent: number; winner: 'you' | 'opponent' | null };
  hands: number;
  completedAt: string | null;
  /** Every hand the ledger names for this game is stored, so the review can be offered. The read can still decline (see `deriveDailyFritzSavedGame`). */
  reviewable: boolean;
};

/**
 * The user's verified games, newest first, each marked reviewable when all of its hands are stored. Only games in the verified ledger are listed: an unverified
 * or never-strand game has no authoritative record to review.
 */
export function listDailyFritzGames(
  attempts: readonly DailyFritzAttemptRecord[],
  storedDigests: ReadonlyArray<{ attempt_id: string; game_number: number; transcript_digest: string }>,
): DailyFritzGameListEntry[] {
  const stored = new Set(storedDigests.map((row) => `${row.attempt_id}:${row.game_number}:${row.transcript_digest}`));
  const entries: DailyFritzGameListEntry[] = [];
  for (const attempt of attempts) {
    const setResult = normalizeDailyFritzSetResult(attempt.result);
    for (const game of readAuthorityLedger(attempt.result).games) {
      if (game.handDigests.length === 0) continue;
      entries.push({
        sourceMatchId: dailyFritzSavedGameId(attempt.id, game.gameNumber),
        attemptId: attempt.id,
        runDate: attempt.runDate,
        gameNumber: game.gameNumber as DailyFritzSetGameNumber,
        result: { you: game.playerScore, opponent: game.fritzScore, winner: game.playerScore > game.fritzScore ? 'you' : game.fritzScore > game.playerScore ? 'opponent' : null },
        hands: game.handDigests.length,
        completedAt: setResult?.games.find((g) => g.gameNumber === game.gameNumber)?.completedAt ?? null,
        reviewable: game.handDigests.every((digest) => stored.has(`${attempt.id}:${game.gameNumber}:${digest}`)),
      });
    }
  }
  return entries.sort((a, b) => (a.runDate === b.runDate ? b.gameNumber - a.gameNumber : a.runDate < b.runDate ? 1 : -1));
}

export function deriveDailyFritzSavedGame(input: {
  attempt: DailyFritzAttemptRecord;
  run: DailyFritzRunRecord;
  publishedChallenge: DailyFritzPublishedChallenge | null;
  gameNumber: DailyFritzSetGameNumber;
  handRecords: readonly StoredDailyFritzHandRecord[];
}): DeriveSavedGameResult {
  const { attempt, run, publishedChallenge, gameNumber, handRecords } = input;
  const ledger = readAuthorityLedger(attempt.result);
  const verifiedGame = ledger.games.find((game) => game.gameNumber === gameNumber);
  if (!verifiedGame) return { ok: false, reason: 'game_not_verified' };
  if (verifiedGame.handDigests.length === 0) return { ok: false, reason: 'no_hands' };

  const replays: OkHandReplay[] = [];
  for (const digest of verifiedGame.handDigests) {
    // The ledger names the authoritative transcript of each hand by digest; a hand verified twice may have more than one stored row.
    const hand = ledger.hands.find((candidate) => candidate.gameNumber === gameNumber && candidate.transcriptDigest === digest);
    if (!hand) return { ok: false, reason: 'hand_not_in_ledger' };
    const stored = handRecords.find((row) => row.hand_index === hand.handIndex && row.transcript_digest === digest);
    if (!stored) return { ok: false, reason: `missing_hand_record:${hand.handIndex}` };

    let replay: ReturnType<typeof replayVerifiedDailyFritzHand>;
    try {
      replay = replayVerifiedDailyFritzHand(
        buildHandVerificationInput({
          transcript: stored.transcript,
          attempt,
          run,
          userId: attempt.userId,
          gameNumber,
          handIndex: hand.handIndex,
          publishedChallenge,
        }),
      );
    } catch (error) {
      // attempt-level refusals (a retired policy, a challenge that no longer matches) throw before the verifier runs
      return { ok: false, reason: `hand_not_replayable:${hand.handIndex}:${error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'unexpected'}` };
    }
    if (!replay.ok) return { ok: false, reason: `hand_not_replayable:${hand.handIndex}:${replay.code}` };
    if (replay.result.transcriptDigest !== digest) return { ok: false, reason: `digest_changed:${hand.handIndex}` };
    replays.push(replay);
  }

  const built = buildDailyFritzGameRecord(replays);
  if (!built.ok) return { ok: false, reason: `record_not_buildable:${built.reason}` };
  const replayed = replayMultiplayerRecord(built.record);
  if (!replayed.ok) return { ok: false, reason: `record_does_not_replay:${replayed.reason}` };

  // The saved game must be the verified game: the ledger's own scores, not merely something that replays.
  const { you, opponent } = built.record.finalScores;
  if (you !== verifiedGame.playerScore || opponent !== verifiedGame.fritzScore) return { ok: false, reason: 'ledger_score_mismatch' };

  const tiles = built.record.config.tilesPerPlayer;
  const completedAt = normalizeDailyFritzSetResult(attempt.result)?.games.find((game) => game.gameNumber === gameNumber)?.completedAt ?? null;
  return {
    ok: true,
    game: {
      sourceMatchId: dailyFritzSavedGameId(attempt.id, gameNumber),
      mode: 'dfz',
      runDate: attempt.runDate,
      gameNumber,
      dealSize: tiles === 7 || tiles === 14 ? tiles : null,
      winningScore: built.record.config.winningScore,
      result: { you, opponent, winner: built.record.winnerId === 'you' ? 'you' : built.record.winnerId === 'opponent' ? 'opponent' : null },
      verification: 'replay_verified',
      playedAt: completedAt,
      opponentName: 'Fritz',
      inferredStepCount: built.inferredStepCount,
      record: built.record,
    },
  };
}
