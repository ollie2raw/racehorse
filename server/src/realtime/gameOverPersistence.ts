import { childLogger } from '../logger';
import type { Server } from 'socket.io';
import { completeGhostGame } from '../ghost/service';
import { recordLeagueLiveResult } from '../league/results';
import { appendMatch } from '../stats/matchLog';
import { recordPublicOnlineMatch } from '../stats/recordPublicMatch';
import { writeMatchActivity } from '../social/activityWriter';
import { supabaseFetch } from '../supabaseUtils';
import { FRITZ_SYSTEM_ID } from '../ranking/glicko2';
import { processRealtimeMultiplayerGame } from '../ranking/periodService';
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

const log = childLogger('realtime:game-over');

/**
 * Factory bound to the process `io` instance. Returns the scheduler used by `initRoomSession` `onGameOver`.
 */
export function createGameOverPersistScheduler(io: Server) {
  return function scheduleGameOverPersist(input: GameOverPersistInput): () => Promise<void> {
    const { room, sourceMatchId, cfg, aId, bId, a, b, scoreA, scoreB, winnerSeatId } = input;
    return async () => {
      try {
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
          const ratedLoserUserId = winnerSeatId === a.id ? b.userId : winnerSeatId === a.id ? a.userId : null;
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
        const rankingProfiles = new Map<string, any>();
        const rankedInsertResults = new Map<string, Awaited<ReturnType<typeof insertRankedGameIdempotent>>>();
        const rankedPlayedAt = new Date().toISOString();
        const rankedSourceColumnsEnabled = isRankedGameSourceColumnsEnabled();
        log.info({
          roomCode: room.code,
          sourceMatchId,
          rankedSourceColumnsEnabled,
        }, 'game-over persist ranked insert');

        for (const p of rankingParticipants) {
          if (p.me.userId) {
            const opponentId = p.opp.userId || (p.opp.id.startsWith('bot:fritz:') ? FRITZ_SYSTEM_ID : null);
            if (opponentId) {
              let profile = rankingProfiles.get(p.me.userId);
              if (!profile) {
                const profileData = await supabaseFetch<any[]>(`/rest/v1/profiles?id=eq.${p.me.userId}`);
                profile = profileData?.[0];
                if (profile) {
                  rankingProfiles.set(p.me.userId, profile);
                }
              }
              if (profile) {
                const insertResult = await insertRankedGameIdempotent({
                  playerId: p.me.userId,
                  opponentId,
                  playerScore: p.myScore,
                  opponentScore: p.oppScore,
                  gameType: opponentId === FRITZ_SYSTEM_ID ? 'fritz' : 'multiplayer',
                  ratingBefore: profile.glicko_rating,
                  rdBefore: profile.glicko_rd,
                  playedAt: rankedPlayedAt,
                  source: { sourceType: 'live_room', sourceMatchId },
                });
                rankedInsertResults.set(p.me.userId, insertResult);
              }

              const moveLog = room.ghostMoveLogs[p.me.id] ?? [];
              if (moveLog.length > 0) {
                await completeGhostGame({
                  userId: p.me.userId,
                  opponentUserId: opponentId,
                  finalScore: p.myScore,
                  opponentScore: p.oppScore,
                  moveLog,
                  matchId: sourceMatchId,
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
            try {
              const ratingResult = await processRealtimeMultiplayerGame({
                playerAProfile,
                playerBProfile,
                playerAGame: playerAInsert.game,
                playerBGame: playerBInsert.game,
              });
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
            } catch (err) {
              log.error({ err }, 'real-time ranking update failed');
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
            try {
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
            } catch (err) {
              log.error({ err }, 'live fixture finalization failed');
            }
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
      } catch (err) {
        log.warn({ err }, 'ranking/match logging failed');
      }
    };
  };
}