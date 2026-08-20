import { childLogger } from '../logger';
import type { Server } from 'socket.io';
import { completeGhostGame } from '../ghost/service';
import { verifyPlayerMoveLog } from '../ghost/verifier';
import { recordLeagueLiveResult } from '../league/results';
import { appendMatch } from '../stats/matchLog';
import { recordPublicOnlineMatch } from '../stats/recordPublicMatch';
import { writeMatchActivity } from '../social/activityWriter';
import { supabaseFetch } from '../supabaseUtils';
import { FRITZ_SYSTEM_ID } from '../ranking/glicko2';
import { processRealtimeMultiplayerGame, type Profile } from '../ranking/periodService';
import { isRankedGameSourceColumnsEnabled } from '../ranking/rankedGamePayload';
import { insertRankedGameIdempotent } from '../ranking/insertRankedGameIdempotent';
import { recordMatchEnd } from '../matchmaking/persistence';
import {
  applyTournamentGameOverFromRoom,
  findTournamentMatchByRoom,
} from '../scheduledTournament';
import {
  formatFritzActivityOpponentLabel,
  getPendingFritzMatchContext,
  resolvePendingFritzMatch,
} from '../shared/fritzMatchLifecycle';
import type { GameOverPersistInput } from '../multiplayer/roomSession';
import { emitMpAuthorityFunnel } from '../multiplayer/mpAuthorityTelemetry';
import type { GhostMoveLogEntry } from '../ghost/service';
import type { GhostMoveLogVerificationResult } from '../ghost/verifier';
import {
  rankingOutcomeApplied,
  rankingOutcomeDuplicate,
  rankingOutcomeEligibleNotApplied,
  rankingOutcomeNotRanked,
  rankingOutcomeVerificationSkipped,
} from '../multiplayer/rankingOutcome';
import {
  GAME_OVER_PERSIST_MAX_ATTEMPTS,
  GAME_OVER_PERSIST_RETRY_DELAYS_MS,
  MATCH_RESULT_PERSIST_FAILED_MESSAGE,
  markGameOverPersistFailed,
  markGameOverPersistSucceeded,
  type GameOverPersistOutcome,
} from '../multiplayer/gameOverPersistPolicy';
import type { Room } from '../rooms';

const log = childLogger('realtime:game-over');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function verifySeatMoveLog(moveLog: GhostMoveLogEntry[]): GhostMoveLogVerificationResult {
  if (moveLog.length === 0) return { ok: true };
  return verifyPlayerMoveLog(moveLog, { strictHandContinuity: true });
}

type HumanMoveLogVerificationFailure = {
  seatId: string;
  reason: string;
  entryIndex: number;
};

function evaluateHumanMoveLogVerification(
  roomCode: string,
  sourceMatchId: string,
  seats: Array<{ id: string; userId: string | null }>,
  ghostMoveLogs: Record<string, GhostMoveLogEntry[]>,
): { eligible: true } | { eligible: false; failure: HumanMoveLogVerificationFailure } {
  for (const seat of seats) {
    if (!seat.userId) continue;
    const moveLog = ghostMoveLogs[seat.id] ?? [];
    if (moveLog.length === 0) continue;
    const verification = verifySeatMoveLog(moveLog);
    if (!verification.ok) {
      const failure = {
        seatId: seat.id,
        reason: verification.reason,
        entryIndex: verification.entryIndex,
      };
      log.warn(
        {
          roomCode,
          sourceMatchId,
          seatId: failure.seatId,
          reason: failure.reason,
          entryIndex: failure.entryIndex,
        },
        'human live-room move log failed verification — recording without Glicko',
      );
      emitMpAuthorityFunnel('private_move_log_verification_failed', {
        roomCode,
        seatId: failure.seatId,
        failureCode: 'move_log_verification_failed',
        extra: {
          sourceMatchId,
          reason: failure.reason,
          entryIndex: failure.entryIndex,
        },
      });
      return { eligible: false, failure };
    }
  }
  return { eligible: true };
}

async function persistGameOverOnce(io: Server, input: GameOverPersistInput): Promise<void> {
  const { room, sourceMatchId, cfg, aId, bId, a, b, scoreA, scoreB, winnerSeatId } = input;
  const winnerUserId =
    winnerSeatId === a.id ? a.userId : winnerSeatId === b.id ? b.userId : null;
  if (winnerUserId) {
    const applied = await applyTournamentGameOverFromRoom(io, room, {
      winnerUserId,
      player1Score: scoreA,
      player2Score: scoreB,
    });
    if (applied) return;
  }
  if (room.scheduledTournamentMatchId) {
    if (!winnerUserId) {
      log.warn({
        roomCode: room.code,
        matchId: room.scheduledTournamentMatchId,
      }, 'missing winner user id');
    }
    return;
  }
  const tournamentMatchByRoom = await findTournamentMatchByRoom(room.code).catch(() => null);
  if (tournamentMatchByRoom) {
    if (!winnerUserId) {
      log.warn({
        roomCode: room.code,
        matchId: tournamentMatchByRoom.id,
      }, 'missing winner user id');
    }
    return;
  }

  if (getPendingFritzMatchContext(room)) {
    await resolvePendingFritzMatch(room.code);
  }

  await appendMatch({
    endedAtMs: Date.now(),
    roomCode: room.code,
    tournamentId: typeof cfg.tournamentId === 'string' ? cfg.tournamentId : undefined,
    tournamentMatchId: typeof cfg.tournamentMatchId === 'string' ? cfg.tournamentMatchId : undefined,
    maxDeficitWinner: (() => {
      const t = room.leadTracker;
      if (!t) return 0;
      if (winnerSeatId === aId) return t.maxLeadB ?? 0;
      if (winnerSeatId === bId) return t.maxLeadA ?? 0;
      return 0;
    })(),
    a: { seatId: a.id, userId: a.userId, username: a.username },
    b: { seatId: b.id, userId: b.userId, username: b.username },
    scoreA,
    scoreB,
    winnerSeatId,
    pointDiff: Math.abs(scoreA - scoreB),
  });

  const fritzActivityCtx = getPendingFritzMatchContext(room);
  const winnerRoster = winnerSeatId === aId ? a : b;
  const loserRoster = winnerSeatId === aId ? b : a;
  const activityDisplayName = (p: typeof a) =>
    fritzActivityCtx && typeof p.id === 'string' && p.id.startsWith('bot:fritz:')
      ? formatFritzActivityOpponentLabel(fritzActivityCtx.fritzTier)
      : p.username;

  void writeMatchActivity({
    winnerUserId: winnerSeatId === aId ? a.userId : b.userId,
    loserUserId: winnerSeatId === aId ? b.userId : a.userId,
    winnerUsername: activityDisplayName(winnerRoster),
    loserUsername: activityDisplayName(loserRoster),
    mode: fritzActivityCtx ? 'bot' : 'online',
    winnerScore: winnerSeatId === aId ? scoreA : scoreB,
    loserScore: winnerSeatId === aId ? scoreB : scoreA,
    fritzTier: fritzActivityCtx?.fritzTier ?? null,
  }).catch(() => {});

  if (a.userId && b.userId && !fritzActivityCtx) {
    const ratedWinnerUserId = winnerSeatId === a.id ? a.userId : winnerSeatId === b.id ? b.userId : null;
    const ratedLoserUserId = winnerSeatId === a.id ? b.userId : winnerSeatId === b.id ? a.userId : null;
    if (ratedWinnerUserId && ratedLoserUserId) {
      void recordPublicOnlineMatch({
        roomCode: room.code,
        roomMatchId: sourceMatchId,
        winnerUserId: ratedWinnerUserId,
        loserUserId: ratedLoserUserId,
        winnerScore: winnerSeatId === a.id ? scoreA : scoreB,
        loserScore: winnerSeatId === a.id ? scoreB : scoreA,
      });
    }
  }

  const rankingParticipants = [
    { me: a, opp: b, myScore: scoreA, oppScore: scoreB },
    { me: b, opp: a, myScore: scoreB, oppScore: scoreA },
  ];

  const rankedPlayedAt = new Date().toISOString();
  const rankingProfiles = new Map<string, Profile>();
  const rankedInsertResults = new Map<
    string,
    Awaited<ReturnType<typeof insertRankedGameIdempotent>>
  >();
  const rankedSourceColumnsEnabled = isRankedGameSourceColumnsEnabled();
  let realtimeRankingApplied = false;
  log.info({
    roomCode: room.code,
    sourceMatchId,
    rankedSourceColumnsEnabled,
  }, 'game-over persist ranked insert');

  const isHumanVsHuman = Boolean(a.userId && b.userId && !fritzActivityCtx);
  const humanMoveLogVerification = isHumanVsHuman
    ? evaluateHumanMoveLogVerification(room.code, sourceMatchId, [a, b], room.ghostMoveLogs)
    : { eligible: true as const };
  const humanGlickoEligible = humanMoveLogVerification.eligible;

  for (const p of rankingParticipants) {
    if (p.me.userId) {
      const opponentId = p.opp.userId || (p.opp.id.startsWith('bot:fritz:') ? FRITZ_SYSTEM_ID : null);
      if (opponentId) {
        let profile = rankingProfiles.get(p.me.userId);
        if (!profile) {
          const profileData = await supabaseFetch<Profile[]>(`/rest/v1/profiles?id=eq.${p.me.userId}`);
          profile = profileData?.[0];
          if (profile) {
            rankingProfiles.set(p.me.userId, profile);
          }
        }
        if (profile && opponentId !== FRITZ_SYSTEM_ID && humanGlickoEligible) {
          const insertResult = await insertRankedGameIdempotent({
            playerId: p.me.userId,
            opponentId,
            playerScore: p.myScore,
            opponentScore: p.oppScore,
            gameType: 'multiplayer',
            ratingBefore: profile.glicko_rating ?? 0,
            rdBefore: profile.glicko_rd ?? 0,
            playedAt: rankedPlayedAt,
            source: { sourceType: 'live_room', sourceMatchId },
          });
          rankedInsertResults.set(p.me.userId, insertResult);
        }

        const moveLog = room.ghostMoveLogs[p.me.id] ?? [];
        if (moveLog.length > 0) {
          const isFritzOpponent = opponentId === FRITZ_SYSTEM_ID;
          const fritzVerification = isFritzOpponent ? verifySeatMoveLog(moveLog) : null;
          if (isFritzOpponent && fritzVerification && !fritzVerification.ok) {
            log.warn({
              roomCode: room.code,
              userId: p.me.userId,
              reason: fritzVerification.reason,
              entryIndex: fritzVerification.entryIndex,
            }, 'fritz in-room move log failed verification — recording without Glicko');
            emitMpAuthorityFunnel('private_move_log_verification_failed', {
              roomCode: room.code,
              seatId: p.me.id,
              failureCode: 'move_log_verification_failed',
              extra: {
                sourceMatchId,
                reason: fritzVerification.reason,
                entryIndex: fritzVerification.entryIndex,
              },
            });
          }
          const humanApplyGlicko = humanGlickoEligible ? undefined : false;
          await completeGhostGame({
            userId: p.me.userId,
            opponentUserId: opponentId,
            finalScore: p.myScore,
            opponentScore: p.oppScore,
            moveLog,
            matchId: sourceMatchId,
            applyGlicko: isFritzOpponent ? Boolean(fritzVerification?.ok) : humanApplyGlicko,
          });
        }
      }
    }
  }

  if (a.userId && b.userId) {
    const playerAProfile = rankingProfiles.get(a.userId);
    const playerBProfile = rankingProfiles.get(b.userId);
    const playerAInsert = rankedInsertResults.get(a.userId);
    const playerBInsert = rankedInsertResults.get(b.userId);
    if (
      playerAProfile &&
      playerBProfile &&
      playerAInsert?.isNew &&
      playerBInsert?.isNew &&
      playerAInsert.game &&
      playerBInsert.game
    ) {
      const ratingResult = await processRealtimeMultiplayerGame({
        playerAProfile,
        playerBProfile,
        playerAGame: playerAInsert.game,
        playerBGame: playerBInsert.game,
      });
      realtimeRankingApplied = true;
      log.info({
        playerA: a.userId,
        playerB: b.userId,
        sourceMatchId,
      }, 'Real-time update complete');

      if (room.matchmakingMatchId) {
        const matchWinnerUserId =
          winnerSeatId === a.id ? a.userId : winnerSeatId === b.id ? b.userId : null;
        void recordMatchEnd({
          matchId: room.matchmakingMatchId,
          status: 'completed',
          winnerId: matchWinnerUserId,
          playerARatingChange: ratingResult?.playerA?.delta ?? null,
          playerBRatingChange: ratingResult?.playerB?.delta ?? null,
          isSim: false,
        });
      }
    } else {
      log.warn({
        hasPlayerAProfile: !!playerAProfile,
        hasPlayerBProfile: !!playerBProfile,
        playerAIsNew: playerAInsert?.isNew ?? false,
        playerBIsNew: playerBInsert?.isNew ?? false,
        sourceMatchId,
      }, 'Skipping real-time update — duplicate or missing ranked insert');
    }
  }

  if (!isHumanVsHuman) {
    room.rankingOutcome = rankingOutcomeNotRanked();
  } else if (!humanGlickoEligible) {
    room.rankingOutcome = rankingOutcomeVerificationSkipped();
  } else if (realtimeRankingApplied) {
    room.rankingOutcome = rankingOutcomeApplied();
  } else if (
    (a.userId && rankedInsertResults.get(a.userId)?.isNew === false) ||
    (b.userId && rankedInsertResults.get(b.userId)?.isNew === false)
  ) {
    room.rankingOutcome = rankingOutcomeDuplicate();
  } else {
    room.rankingOutcome = rankingOutcomeEligibleNotApplied();
  }

  const linkedFixtureRows = await supabaseFetch<any[]>(
    `/rest/v1/fixtures?select=id,status,home_member_id,away_member_id,live_room_code&live_room_code=eq.${room.code}&limit=1`,
  );
  const linkedFixture = linkedFixtureRows?.[0];
  if (linkedFixture && linkedFixture.status !== 'completed' && linkedFixture.status !== 'forfeit') {
    const fixtureMembers = await supabaseFetch<any[]>(
      `/rest/v1/league_members?select=id,player_user_id&id=in.("${linkedFixture.home_member_id}","${linkedFixture.away_member_id}")`,
    );
    const homeMember = fixtureMembers.find((member) => member?.id === linkedFixture.home_member_id) ?? null;
    const awayMember = fixtureMembers.find((member) => member?.id === linkedFixture.away_member_id) ?? null;
    const livePlayers = [a, b];
    const homePlayer = livePlayers.find((player) => player.userId === homeMember?.player_user_id) ?? null;
    const awayPlayer = livePlayers.find((player) => player.userId === awayMember?.player_user_id) ?? null;

    if (homeMember && awayMember && homePlayer && awayPlayer) {
      const homeScore = homePlayer.id === a.id ? scoreA : scoreB;
      const awayScore = awayPlayer.id === a.id ? scoreA : scoreB;
      await recordLeagueLiveResult({
        fixtureId: linkedFixture.id,
        playerMemberId: homeMember.id,
        opponentMemberId: awayMember.id,
        homeScore,
        awayScore,
        sourceUserId: a.userId ?? b.userId ?? null,
        roomCode: room.code,
        metadata: { via: 'live-room-auto-finalize' },
      });
      log.info({
        fixtureId: linkedFixture.id,
        roomCode: room.code,
      }, 'Live fixture finalized');
    } else {
      log.warn({
        fixtureId: linkedFixture.id,
        roomCode: room.code,
        hasHomeMember: !!homeMember,
        hasAwayMember: !!awayMember,
        hasHomePlayer: !!homePlayer,
        hasAwayPlayer: !!awayPlayer,
      }, 'Skipping live fixture finalization — player mapping missing');
    }
  }
}

function emitGameOverPersistFailed(io: Server, room: Room, sourceMatchId: string, err: unknown): void {
  const sequence = room.state?.sequence ?? null;
  const errorMessage = err instanceof Error ? err.message : String(err);
  emitMpAuthorityFunnel('private_game_over_persist_failed', {
    roomCode: room.code,
    failureCode: 'room_persistence_failed',
    sequence,
    extra: {
      sourceMatchId,
      matchId: room.matchId,
      attempts: GAME_OVER_PERSIST_MAX_ATTEMPTS,
      error: errorMessage,
    },
  });
  io.to(room.code).emit('match:result_persist_failed', {
    roomCode: room.code,
    matchId: room.matchId,
    sourceMatchId,
    sequence,
    message: MATCH_RESULT_PERSIST_FAILED_MESSAGE,
  });
  log.warn(
    {
      roomCode: room.code,
      matchId: room.matchId,
      sourceMatchId,
      sequence,
      error: errorMessage,
    },
    'game-over persist gave up after retries',
  );
}

/**
 * Factory bound to the process `io` instance. Returns the scheduler used by `initRoomSession` `onGameOver`.
 * Bounded retries; `matchLogged` is set only after a successful attempt.
 */
export function createGameOverPersistScheduler(io: Server) {
  return function scheduleGameOverPersist(
    input: GameOverPersistInput,
  ): () => Promise<GameOverPersistOutcome> {
    const { room, sourceMatchId } = input;
    return async () => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < GAME_OVER_PERSIST_MAX_ATTEMPTS; attempt += 1) {
        const delayMs = GAME_OVER_PERSIST_RETRY_DELAYS_MS[attempt] ?? 0;
        if (delayMs > 0) {
          await sleep(delayMs);
        }
        try {
          await persistGameOverOnce(io, input);
          markGameOverPersistSucceeded(room);
          emitMpAuthorityFunnel('private_game_over_persist_succeeded', {
            roomCode: room.code,
            sequence: room.state?.sequence ?? null,
            extra: {
              sourceMatchId,
              matchId: room.matchId,
              attempt: attempt + 1,
            },
          });
          return 'succeeded';
        } catch (err) {
          lastError = err;
          log.warn(
            {
              err,
              roomCode: room.code,
              sourceMatchId,
              matchId: room.matchId,
              sequence: room.state?.sequence ?? null,
              attempt: attempt + 1,
              maxAttempts: GAME_OVER_PERSIST_MAX_ATTEMPTS,
            },
            'game-over persist attempt failed',
          );
        }
      }

      markGameOverPersistFailed(room);
      emitGameOverPersistFailed(io, room, sourceMatchId, lastError);
      return 'failed';
    };
  };
}
