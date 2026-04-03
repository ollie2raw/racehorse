import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server, Socket } from 'socket.io';
import {
  completeGhostGame,
  getGhostProfileSummary,
  getGhostProfileSummaryByUsername,
} from './ghost/service';
import { assignPlayerToLeague } from './league/service';
import { generateLeagueFixtures } from './league/schedule';
import {
  recordLeagueAsyncResult,
  recordLeagueFixtureResult,
  openLeagueFixtureLiveRoom,
  recordLeagueLiveResult,
} from './league/results';
import { runLeagueForfeitJob } from './league/forfeit';
import { runLeagueSundayRollover } from './league/rollover';
import { getLeagueStateForPlayer } from './league/state';
import { getLeagueHistoryForPlayer } from './league/history';
import {
  makeCode,
  makeId,
  initStandings,
  buildRoundRobinMatches,
  sortedStandings,
  applyResult,
  type Tournament,
  type TournamentPlayer,
} from './tournament/tournament';
import { computeWeeklyAwards, appendMatch } from "./stats/matchLog";
import { supabaseFetch } from './supabaseUtils';
import { DEFAULT_RATING, DEFAULT_RD, FRITZ_SYSTEM_ID, isFritzId } from './ranking/glicko2';
import { startRankingCron } from './ranking/cron';
import { getLeaderboard, processRatingPeriod, processRealtimeMultiplayerGame } from './ranking/periodService';

import {
  createRoom,
  createReservedRoom,
  joinRoom,
  startGame,
  act,
  nextHand,
  readyForNextHand,
  getRoom,
  deleteRoom,
  getRoomLegalMoves,
  getRoomCanDraw,
  type Room,
} from './rooms';

const app = express();
app.use(cors());
app.use(express.json());

async function getAuthenticatedUserId(req: express.Request): Promise<string | null> {
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) return null;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase auth configuration is required.');
  }

  const response = await fetch(new URL('/auth/v1/user', supabaseUrl), {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return null;

  const user = (await response.json()) as { id?: unknown };
  return typeof user.id === 'string' ? user.id : null;
}

app.get('/health', (_, res) => {
  res.json({ ok: true });
});

app.get('/api/ranking/profile/:userId', async (req, res) => {
  const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
  if (!userId) {
    res.status(400).json({ error: 'userId is required.' });
    return;
  }

  try {
    const profileData = await supabaseFetch<any[]>(`/rest/v1/profiles?id=eq.${userId}`);
    const profile = profileData?.[0];
    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    // Get rank among non-provisional players
    const allProfiles = await supabaseFetch<any[]>(`/rest/v1/profiles?provisional=eq.false&order=glicko_rating.desc`);
    const rankIndex = allProfiles.findIndex(p => p.id === userId);
    
    res.json({
      ok: true,
      glicko_rating: profile.glicko_rating,
      glicko_rd: profile.glicko_rd,
      provisional: profile.provisional,
      ranked_games_played: profile.ranked_games_played,
      peak_rating: profile.peak_rating,
      rank: rankIndex >= 0 ? rankIndex + 1 : null
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load ranking profile.',
    });
  }
});

app.get('/api/ranking/leaderboard', async (req, res) => {
  const limit = Number(req.query.limit) || 50;
  try {
    const leaderboard = await getLeaderboard(limit);
    res.json({ ok: true, leaderboard });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load leaderboard.',
    });
  }
});

app.get('/api/ranking/history/:userId', async (req, res) => {
  const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
  if (!userId) {
    res.status(400).json({ error: 'userId is required.' });
    return;
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (authenticatedUserId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const profileData = await supabaseFetch<any[]>(`/rest/v1/profiles?id=eq.${userId}&limit=1`);
    const profile = profileData?.[0];
    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    const games = await supabaseFetch<any[]>(
      `/rest/v1/ranked_games?player_id=eq.${userId}` +
        `&rating_after=not.is.null&select=played_at,rating_after,rd_after,delta,opponent_id,player_score,opponent_score` +
        `&order=played_at.asc,id.asc`,
    );

    res.json({
      ok: true,
      games: games.map((game) => ({
        played_at: game.played_at,
        rating_after: Number(game.rating_after ?? 0),
        rd_after: Number(game.rd_after ?? 350),
        delta: Number(game.delta ?? 0),
        opponent_id: String(game.opponent_id ?? ''),
        player_score: Number(game.player_score ?? 0),
        opponent_score: Number(game.opponent_score ?? 0),
        is_fritz: isFritzId(game.opponent_id),
      })),
      currentRating: Number(profile.glicko_rating ?? DEFAULT_RATING),
      peakRating: Number(profile.peak_rating ?? profile.glicko_rating ?? DEFAULT_RATING),
      provisional: Boolean(profile.provisional),
      rd: Number(profile.glicko_rd ?? DEFAULT_RD),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load rating history.',
    });
  }
});

app.post('/api/ranking/process/:userId', async (req, res) => {
  const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
  const adminKey = req.body?.adminKey;

  if (adminKey !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!userId) {
    res.status(400).json({ error: 'userId is required.' });
    return;
  }

  try {
    const result = await processRatingPeriod(userId);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to process rating period.',
    });
  }
});

app.get('/api/ghost/profile/:userId', async (req, res) => {
  const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
  if (!userId) {
    res.status(400).json({ error: 'userId is required.' });
    return;
  }

  try {
    const summary = await getGhostProfileSummary(userId);
    res.json({ ok: true, summary });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load ghost profile.',
    });
  }
});

app.get('/api/ghost/profile-by-username/:username', async (req, res) => {
  const username = typeof req.params.username === 'string' ? req.params.username.trim() : '';
  if (!username) {
    res.status(400).json({ error: 'username is required.' });
    return;
  }

  try {
    const result = await getGhostProfileSummaryByUsername(username);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load ghost profile.',
    });
  }
});

app.post('/api/ghost/complete', async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  const opponentUserId =
    typeof req.body?.opponentUserId === 'string' && req.body.opponentUserId.trim()
      ? req.body.opponentUserId.trim()
      : null;
  const finalScore = Number(req.body?.finalScore);
  const opponentScore = Number(req.body?.opponentScore);
  const moveLog = Array.isArray(req.body?.moveLog) ? req.body.moveLog : null;

  if (!userId) {
    res.status(400).json({ error: 'userId is required.' });
    return;
  }
  if (!Number.isFinite(finalScore) || !Number.isFinite(opponentScore)) {
    res.status(400).json({ error: 'finalScore and opponentScore are required.' });
    return;
  }
  if (!moveLog) {
    res.status(400).json({ error: 'moveLog is required.' });
    return;
  }

  try {
    const result = await completeGhostGame({
      userId,
      opponentUserId,
      finalScore,
      opponentScore,
      moveLog,
    });
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to complete ghost game.',
    });
  }
});

app.post('/league/assign-player', async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  if (!userId) {
    res.status(400).json({ error: 'userId is required.' });
    return;
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (authenticatedUserId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const assignment = await assignPlayerToLeague(userId);
    res.json({ ok: true, assignment });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to assign player to league.',
    });
  }
});

app.post('/league/generate-fixtures', async (req, res) => {
  const leagueId = typeof req.body?.leagueId === 'string' ? req.body.leagueId.trim() : '';
  if (!leagueId) {
    res.status(400).json({ error: 'leagueId is required.' });
    return;
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const schedule = await generateLeagueFixtures(leagueId);
    res.json({
      ok: true,
      schedule,
      note:
        'Seven-member round robin requires 7 matchdays with one bye per day. This supersedes the earlier 6-day assumption.',
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate league fixtures.',
    });
  }
});

app.post('/league/report-result', async (req, res) => {
  const fixtureId = typeof req.body?.fixtureId === 'string' ? req.body.fixtureId.trim() : '';
  const homeScore = req.body?.homeScore;
  const awayScore = req.body?.awayScore;
  const submittedMode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : '';
  const playerMemberId =
    typeof req.body?.playerMemberId === 'string' ? req.body.playerMemberId.trim() : '';
  const opponentMemberId =
    typeof req.body?.opponentMemberId === 'string' ? req.body.opponentMemberId.trim() : '';
  const roomCode = typeof req.body?.roomCode === 'string' ? req.body.roomCode.trim() : '';

  if (!fixtureId) {
    res.status(400).json({ error: 'fixtureId is required.' });
    return;
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const parsedHomeScore = Number(homeScore);
    const parsedAwayScore = Number(awayScore);
    if (
      !Number.isInteger(parsedHomeScore) ||
      !Number.isInteger(parsedAwayScore) ||
      parsedHomeScore < 0 ||
      parsedAwayScore < 0 ||
      parsedHomeScore > 200 ||
      parsedAwayScore > 200
    ) {
      res.status(400).json({ error: 'Scores must be integers between 0 and 200.' });
      return;
    }

    const fixtureRows = await supabaseFetch<any[]>(
      `/rest/v1/fixtures?select=id,league_id,season,home_member_id,away_member_id,status&id=eq.${fixtureId}&limit=1`,
    );
    const fixture = fixtureRows?.[0];
    if (!fixture) {
      res.status(404).json({ error: 'Fixture not found.' });
      return;
    }
    if (fixture.status === 'completed' || fixture.status === 'forfeit') {
      res.status(409).json({ error: `Fixture ${fixtureId} is already ${fixture.status}.` });
      return;
    }
    const leagueRows = await supabaseFetch<any[]>(
      `/rest/v1/leagues?select=id,status&id=eq.${fixture.league_id}&limit=1`,
    );
    const league = leagueRows?.[0];
    if (!league || league.status !== 'active') {
      res.status(409).json({ error: 'This fixture is no longer playable.' });
      return;
    }

    const membershipRows = await supabaseFetch<any[]>(
      `/rest/v1/league_members?select=id,player_user_id,member_type&id=in.("${fixture.home_member_id}","${fixture.away_member_id}")`,
    );
    const homeMember = membershipRows.find((member) => member?.id === fixture.home_member_id) ?? null;
    const awayMember = membershipRows.find((member) => member?.id === fixture.away_member_id) ?? null;
    if (!homeMember || !awayMember) {
      res.status(500).json({ error: 'Fixture membership is invalid.' });
      return;
    }

    const reporterMember =
      homeMember.player_user_id === authenticatedUserId
        ? homeMember
        : awayMember.player_user_id === authenticatedUserId
          ? awayMember
          : null;
    if (!reporterMember) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const otherMember = reporterMember.id === homeMember.id ? awayMember : homeMember;
    const resolvedMode =
      submittedMode === 'ghost' || submittedMode === 'bot' || submittedMode === 'live'
        ? submittedMode
        : otherMember.member_type === 'bot'
          ? 'bot'
          : 'ghost';

    if (playerMemberId && playerMemberId !== reporterMember.id) {
      res.status(400).json({ error: 'playerMemberId does not match the reporting fixture member.' });
      return;
    }
    if (opponentMemberId && opponentMemberId !== otherMember.id) {
      res.status(400).json({ error: 'opponentMemberId does not match the fixture opponent.' });
      return;
    }

    if (resolvedMode === 'live' && (homeMember.member_type !== 'player' || awayMember.member_type !== 'player')) {
      res.status(400).json({ error: 'Live mode is only valid for player-vs-player fixtures.' });
      return;
    }
    if ((resolvedMode === 'ghost' || resolvedMode === 'bot') && fixture.status !== 'scheduled' && fixture.status !== 'provisional') {
      res.status(409).json({ error: `Fixture ${fixtureId} is not currently playable async.` });
      return;
    }
    if (resolvedMode === 'ghost' && otherMember.member_type !== 'player') {
      res.status(400).json({ error: 'Ghost mode is only valid for player-vs-player fixtures.' });
      return;
    }
    if (resolvedMode === 'bot' && otherMember.member_type !== 'bot' && submittedMode === 'bot') {
      // Bot stand-in submissions for real opponents are allowed, but only if explicitly handled by the client.
      // This stays permissive for the async-first league flow.
    }

    const result =
      resolvedMode === 'live'
        ? await recordLeagueLiveResult({
            fixtureId,
            playerMemberId: reporterMember.id,
            opponentMemberId: otherMember.id,
            homeScore: parsedHomeScore,
            awayScore: parsedAwayScore,
            sourceUserId: authenticatedUserId,
            roomCode: roomCode || null,
            metadata: { via: 'league-report-route' },
          })
        : await recordLeagueAsyncResult({
            fixtureId,
            mode: resolvedMode,
            playerMemberId: reporterMember.id,
            opponentMemberId: otherMember.id,
            homeScore: parsedHomeScore,
            awayScore: parsedAwayScore,
            sourceUserId: authenticatedUserId,
            metadata: { via: 'league-report-route' },
          });
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to record league result.',
    });
  }
});

app.post('/league/run-forfeits', async (req, res) => {
  if (req.body?.adminKey !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const throughDate =
    typeof req.body?.throughDate === 'string' && req.body.throughDate.trim()
      ? req.body.throughDate.trim()
      : undefined;

  try {
    const result = await runLeagueForfeitJob(throughDate);
    res.json({
      ok: true,
      result,
      note:
        'Current Step 5 behavior only auto-forfeits fixtures where exactly one side is a bot. Real-vs-real and bot-vs-bot scheduled fixtures are reported as skipped for now.',
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to run league forfeit job.',
    });
  }
});

app.post('/league/run-rollover', async (req, res) => {
  if (req.body?.adminKey !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const throughDate =
    typeof req.body?.throughDate === 'string' && req.body.throughDate.trim()
      ? req.body.throughDate.trim()
      : undefined;

  try {
    const result = await runLeagueSundayRollover(throughDate);
    res.json({
      ok: true,
      result,
      note:
        'Rollover is idempotent at the weekly level: once next-week active leagues exist, reruns will not create duplicate successor leagues.',
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to run league Sunday rollover.',
    });
  }
});

app.get('/league/state/:userId', async (req, res) => {
  const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
  if (!userId) {
    res.status(400).json({ error: 'userId is required.' });
    return;
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (authenticatedUserId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const state = await getLeagueStateForPlayer(userId);
    if (state?.todaysOpponent?.memberType === 'player') {
      const opponentMember =
        state.members.find((member) => member.id === state.todaysOpponent?.memberId) ?? null;
      const opponentUserId = opponentMember?.player_user_id ?? null;
      state.todaysOpponent.online = Boolean(opponentUserId && socketsByUserId.get(opponentUserId)?.size);
    }
    res.json({ ok: true, state });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load league state.',
    });
  }
});

app.get('/league/history/:userId', async (req, res) => {
  const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
  if (!userId) {
    res.status(400).json({ error: 'userId is required.' });
    return;
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (authenticatedUserId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const history = await getLeagueHistoryForPlayer(userId);
    res.json({ ok: true, history });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load league history.',
    });
  }
});

app.post('/league/fixture/:fixtureId/live-room', async (req, res) => {
  const fixtureId = typeof req.params.fixtureId === 'string' ? req.params.fixtureId.trim() : '';
  if (!fixtureId) {
    res.status(400).json({ error: 'fixtureId is required.' });
    return;
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const fixtureRows = await supabaseFetch<any[]>(
      `/rest/v1/fixtures?select=id,league_id,status,home_member_id,away_member_id,live_room_code&id=eq.${fixtureId}&limit=1`,
    );
    const fixture = fixtureRows?.[0];
    if (!fixture) {
      res.status(404).json({ error: 'Fixture not found.' });
      return;
    }
    if (fixture.status === 'completed' || fixture.status === 'forfeit') {
      res.status(409).json({ error: `Fixture ${fixtureId} is already ${fixture.status}.` });
      return;
    }
    const leagueRows = await supabaseFetch<any[]>(
      `/rest/v1/leagues?select=id,status&id=eq.${fixture.league_id}&limit=1`,
    );
    const league = leagueRows?.[0];
    if (!league || league.status !== 'active') {
      res.status(409).json({ error: 'This fixture is no longer available for live play.' });
      return;
    }

    const membershipRows = await supabaseFetch<any[]>(
      `/rest/v1/league_members?select=id,player_user_id,member_type&id=in.("${fixture.home_member_id}","${fixture.away_member_id}")`,
    );
    const homeMember = membershipRows.find((member) => member?.id === fixture.home_member_id) ?? null;
    const awayMember = membershipRows.find((member) => member?.id === fixture.away_member_id) ?? null;
    if (!homeMember || !awayMember) {
      res.status(500).json({ error: 'Fixture membership is invalid.' });
      return;
    }
    if (homeMember.member_type !== 'player' || awayMember.member_type !== 'player') {
      res.status(400).json({ error: 'Live play is only available for player-vs-player fixtures.' });
      return;
    }
    if (homeMember.player_user_id !== authenticatedUserId && awayMember.player_user_id !== authenticatedUserId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const existingCode =
      typeof fixture.live_room_code === 'string' && fixture.live_room_code.trim()
        ? fixture.live_room_code.trim().toUpperCase()
        : '';
    let roomCode = existingCode;
    if (roomCode) {
      try {
        getRoom(roomCode);
      } catch {
        createReservedRoom(roomCode, { winningScore: 30 });
      }
    } else {
      do {
        roomCode = `LG-${makeCode(4)}`;
        try {
          getRoom(roomCode);
          roomCode = '';
        } catch {
          // Unused room code, safe to reserve for this fixture.
        }
      } while (!roomCode);
      roomCode = createReservedRoom(roomCode, { winningScore: 30 }).code;
      await openLeagueFixtureLiveRoom(fixtureId, roomCode);
    }

    res.json({ ok: true, fixtureId, roomCode });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to open live room.',
    });
  }
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
});

type RoomPlayer = { id: string; username: string; userId: string | null };
type RoomJoinConfig = { username?: string; userId?: string | null };
type AckFn = (payload: any) => void;

const roomPlayersByCode = new Map<string, RoomPlayer[]>();
const RECONNECT_GRACE_MS = 90_000;
const ROOM_CLEANUP_GRACE_MS = 60_000;
type ReconnectSeat = {
  oldSocketId: string;
  username: string;
  userId: string | null;
  expiresAt: number;
};
const reconnectSeatsByCode = new Map<string, ReconnectSeat[]>();
const socketsByUserId = new Map<string, Set<string>>();
const roomCleanupTimersByCode = new Map<string, ReturnType<typeof setTimeout>>();
let finalizeTournamentMatchHook: ((room: any) => void) | null = null;

function normalizeUsername(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || 'Guest';
}

function normalizeUserId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  return raw || null;
}

function getRoomPlayersWithFallback(roomCode: string, socketIds: string[]): RoomPlayer[] {
  const existing = roomPlayersByCode.get(roomCode) ?? [];
  const byId = new Map(existing.map((p) => [p.id, p]));
  const next = socketIds.map((id) => byId.get(id) ?? { id, username: 'Guest', userId: null });
  roomPlayersByCode.set(roomCode, next);
  return next;
}

function pruneReconnectSeats(roomCode: string): ReconnectSeat[] {
  const now = Date.now();
  const seats = (reconnectSeatsByCode.get(roomCode) ?? []).filter((seat) => seat.expiresAt > now);
  if (seats.length > 0) reconnectSeatsByCode.set(roomCode, seats);
  else reconnectSeatsByCode.delete(roomCode);
  return seats;
}

function reserveReconnectSeat(roomCode: string, seat: Omit<ReconnectSeat, 'expiresAt'>) {
  const seats = pruneReconnectSeats(roomCode).filter((s) => s.oldSocketId !== seat.oldSocketId);
  seats.push({ ...seat, expiresAt: Date.now() + RECONNECT_GRACE_MS });
  reconnectSeatsByCode.set(roomCode, seats);
}

function clearRoomMetadata(roomCode: string) {
  roomPlayersByCode.delete(roomCode);
  reconnectSeatsByCode.delete(roomCode);
}

function cancelRoomCleanup(roomCode: string) {
  const timer = roomCleanupTimersByCode.get(roomCode);
  if (timer) {
    clearTimeout(timer);
    roomCleanupTimersByCode.delete(roomCode);
  }
}

function scheduleRoomCleanup(roomCode: string) {
  if (!roomCode || roomCleanupTimersByCode.has(roomCode)) return;
  const timer = setTimeout(() => {
    roomCleanupTimersByCode.delete(roomCode);
    let room;
    try {
      room = getRoom(roomCode);
    } catch {
      clearRoomMetadata(roomCode);
      return;
    }
    const activePlayers = room.players.filter((pid) => io.sockets.sockets.has(pid));
    if (activePlayers.length > 0) return;
    deleteRoom(roomCode);
    clearRoomMetadata(roomCode);
  }, ROOM_CLEANUP_GRACE_MS);
  roomCleanupTimersByCode.set(roomCode, timer);
}

function evaluateRoomLifecycle(roomCode: string | undefined) {
  if (!roomCode) return;
  let room;
  try {
    room = getRoom(roomCode);
  } catch {
    clearRoomMetadata(roomCode);
    cancelRoomCleanup(roomCode);
    return;
  }
  const activePlayers = room.players.filter((pid) => io.sockets.sockets.has(pid));
  if (activePlayers.length === 0 || room.state?.gameOver) {
    scheduleRoomCleanup(roomCode);
    return;
  }
  cancelRoomCleanup(roomCode);
}

function joinSocketToRoom(socketId: string, roomCode: string, preservePrefixes: string[] = []) {
  const target = io.sockets.sockets.get(socketId);
  if (!target) return;
  const currentRooms = [...target.rooms].filter(
    (joined) =>
      joined !== target.id && !preservePrefixes.some((prefix) => joined.startsWith(prefix)),
  );
  currentRooms.forEach((joined) => {
    target.leave(joined);
    evaluateRoomLifecycle(joined);
  });
  target.join(roomCode);
  target.data.roomId = roomCode;
}

function identityMatchesReconnectSeat(
  seat: ReconnectSeat,
  identity: { username: string; userId: string | null },
): boolean {
  // Prefer userId match — strongest signal
  if (seat.userId && identity.userId) {
    return seat.userId === identity.userId;
  }
  // If one has userId and the other doesn't, no match
  if (seat.userId || identity.userId) {
    return false;
  }
  // Both are guests — username match is acceptable only
  // if the username is not a generic default
  const genericNames = new Set(['guest', 'player', '']);
  const normalized = identity.username.toLowerCase().trim();
  if (genericNames.has(normalized)) {
    return false; // Too ambiguous to trust username alone
  }
  return seat.username === identity.username;
}

function migrateRoomSeat(roomCode: string, oldSocketId: string, newSocketId: string) {
  const room = getRoom(roomCode);
  const idx = room.players.indexOf(oldSocketId);
  if (idx < 0) return;
  room.players[idx] = newSocketId;

  if (room.state) {
    const nextPlayerIds = room.state.playerIds.map((pid) =>
      pid === oldSocketId ? newSocketId : pid,
    );
    const nextPlayers: Record<string, any> = { ...room.state.players };
    if (nextPlayers[oldSocketId]) {
      nextPlayers[newSocketId] = nextPlayers[oldSocketId];
      delete nextPlayers[oldSocketId];
    }
    room.state = {
      ...room.state,
      playerIds: nextPlayerIds,
      players: nextPlayers,
    } as any;
    if (room.lastBroadcastScores[oldSocketId] !== undefined) {
      room.lastBroadcastScores[newSocketId] = room.lastBroadcastScores[oldSocketId];
      delete room.lastBroadcastScores[oldSocketId];
    }
  }
  if (room.ghostMoveLogs[oldSocketId]) {
    room.ghostMoveLogs[newSocketId] = room.ghostMoveLogs[oldSocketId];
    delete room.ghostMoveLogs[oldSocketId];
  }

  if (room.nextHandReady.has(oldSocketId)) {
    room.nextHandReady.delete(oldSocketId);
    room.nextHandReady.add(newSocketId);
  }
  if (room.rematchReady.has(oldSocketId)) {
    room.rematchReady.delete(oldSocketId);
    room.rematchReady.add(newSocketId);
  }

  const roster = roomPlayersByCode.get(roomCode) ?? [];
  const rosterIdx = roster.findIndex((p) => p.id === oldSocketId);
  if (rosterIdx >= 0) {
    roster[rosterIdx] = { ...roster[rosterIdx], id: newSocketId };
    roomPlayersByCode.set(roomCode, roster);
  }
}

function emitRematchStatus(roomCode: string) {
  let room;
  try {
    room = getRoom(roomCode);
  } catch {
    return;
  }
  const readyPlayerIds = room.players.filter((pid) => room.rematchReady.has(pid));
  io.to(room.code).emit('game:rematch:status', {
    roomCode: room.code,
    readyPlayerIds,
    readyCount: readyPlayerIds.length,
    needed: room.players.length,
  });
}

function clearSocketRematchReady(roomCode: string | undefined, socketId: string) {
  if (!roomCode) return;
  try {
    const room = getRoom(roomCode);
    const changed = room.rematchReady.delete(socketId);
    if (changed) emitRematchStatus(room.code);
  } catch {
    // room no longer exists
  }
}

/**
 * Send state update to all players in a room.
 * Each player receives:
 * - The game state
 * - Their legal moves (if it's their turn)
 * - Whether they can draw
 */
function broadcastStateUpdate(roomCode: string) {
  const room = getRoom(roomCode);
  if (!room.state) return;

  // WEEKLY_STATS_LOGGING (non-tournament only)
  const cfg = (room as any).config ?? {};
  const isTournamentRoom = Boolean(cfg.tournamentId);
  // WEEKLY_STATS_LEAD_TRACKER (score-based comeback)
  const pidsForLead = room.state.playerIds;
  if (Array.isArray(pidsForLead) && pidsForLead.length === 2) {
    const aId = pidsForLead[0];
    const bId = pidsForLead[1];
    const scoreA = room.state.players[aId]?.score ?? 0;
    const scoreB = room.state.players[bId]?.score ?? 0;
    const diff = scoreA - scoreB; // + means A is leading
    const t = ((room as any)._leadTracker ??= { aId, bId, maxLeadA: 0, maxLeadB: 0 });
    if (t.aId !== aId || t.bId !== bId) {
      (room as any)._leadTracker = { aId, bId, maxLeadA: 0, maxLeadB: 0 };
    } else {
      if (diff > 0) t.maxLeadA = Math.max(t.maxLeadA, diff);
      if (diff < 0) t.maxLeadB = Math.max(t.maxLeadB, -diff);
    }
  }

  if (room.state.gameOver && !isTournamentRoom && !(room as any)._matchLogged) {
    const pids = room.state.playerIds;
    if (Array.isArray(pids) && pids.length === 2) {
      const roster = roomPlayersByCode.get(room.code) ?? [];
      const byId = new Map(roster.map((p) => [p.id, p]));
      const aId = pids[0];
      const bId = pids[1];
      const a = byId.get(aId) ?? { id: aId, username: "Guest", userId: null };
      const b = byId.get(bId) ?? { id: bId, username: "Guest", userId: null };
      const scoreA = room.state.players[aId]?.score ?? 0;
      const scoreB = room.state.players[bId]?.score ?? 0;
      const winnerSocketId = room.state.winnerId ?? (scoreA >= scoreB ? aId : bId);

      void (async () => {
        try {
          await appendMatch({
            endedAtMs: Date.now(),
            roomCode: room.code,
            tournamentId: typeof cfg.tournamentId === 'string' ? cfg.tournamentId : undefined,
            tournamentMatchId: typeof cfg.tournamentMatchId === 'string' ? cfg.tournamentMatchId : undefined,
            maxDeficitWinner: (() => {
              const t = (room as any)._leadTracker;
              if (!t) return 0;
              if (winnerSocketId === aId) return t.maxLeadB ?? 0;
              if (winnerSocketId === bId) return t.maxLeadA ?? 0;
              return 0;
            })(),
            a: { socketId: a.id, userId: a.userId, username: a.username },
            b: { socketId: b.id, userId: b.userId, username: b.username },
            scoreA,
            scoreB,
            winnerSocketId,
            pointDiff: Math.abs(scoreA - scoreB),
          });

          // RANKED GAMES LOGGING
          const rankingParticipants = [
            { me: a, opp: b, myScore: scoreA, oppScore: scoreB },
            { me: b, opp: a, myScore: scoreB, oppScore: scoreA }
          ];
          const rankingProfiles = new Map<string, any>();
          const insertedRankedGames = new Map<string, any>();

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
                  const insertedGames = await supabaseFetch<any[]>('/rest/v1/ranked_games', {
                    method: 'POST',
                    headers: {
                      Prefer: 'return=representation',
                    },
                    body: JSON.stringify({
                      player_id: p.me.userId,
                      opponent_id: opponentId,
                      player_score: p.myScore,
                      opponent_score: p.oppScore,
                      game_type: opponentId === FRITZ_SYSTEM_ID ? 'fritz' : 'multiplayer',
                      rating_before: profile.glicko_rating,
                      rd_before: profile.glicko_rd,
                      played_at: new Date().toISOString()
                    })
                  });
                  const insertedGame = insertedGames?.[0];
                  if (insertedGame) {
                    insertedRankedGames.set(p.me.userId, insertedGame);
                  }
                }

                const moveLog = room.ghostMoveLogs[p.me.id] ?? [];
                if (moveLog.length > 0) {
                  await completeGhostGame({
                    userId: p.me.userId,
                    opponentUserId: opponentId,
                    finalScore: p.myScore,
                    opponentScore: p.oppScore,
                    moveLog,
                  });
                }
              }
            }
          }

          if (a.userId && b.userId) {
            const playerAProfile = rankingProfiles.get(a.userId);
            const playerBProfile = rankingProfiles.get(b.userId);
            const playerAGame = insertedRankedGames.get(a.userId);
            const playerBGame = insertedRankedGames.get(b.userId);

            if (playerAProfile && playerBProfile && playerAGame && playerBGame) {
              try {
                await processRealtimeMultiplayerGame({
                  playerAProfile,
                  playerBProfile,
                  playerAGame,
                  playerBGame,
                });
                console.log('[Ranking] Real-time update complete', {
                  playerA: a.userId,
                  playerB: b.userId,
                });
              } catch (err) {
                console.error('[Ranking] Real-time update failed:', err);
              }
            } else {
              console.warn('[Ranking] Skipping real-time update — missing data', {
                hasPlayerAProfile: !!playerAProfile,
                hasPlayerBProfile: !!playerBProfile,
                hasPlayerAGame: !!playerAGame,
                hasPlayerBGame: !!playerBGame,
              });
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
                console.log('[League] Live fixture finalized', {
                  fixtureId: linkedFixture.id,
                  roomCode: room.code,
                });
              } catch (err) {
                console.error('[League] Live fixture finalization failed:', err);
              }
            } else {
              console.warn('[League] Skipping live fixture finalization — player mapping missing', {
                fixtureId: linkedFixture.id,
                roomCode: room.code,
                hasHomeMember: !!homeMember,
                hasAwayMember: !!awayMember,
                hasHomePlayer: !!homePlayer,
                hasAwayPlayer: !!awayPlayer,
              });
            }
          }
        } catch (err) {
          console.warn('Ranking/Match logging failed', err);
        }
      })();
      (room as any)._matchLogged = true;
    }
  }

  // Self-heal Socket.IO room membership for active (human) match players.
  for (const pid of room.state.playerIds) {
    if (pid.startsWith('bot:fritz:')) continue;
    const playerSocket = io.sockets.sockets.get(pid);
    if (!playerSocket) continue;
    if (!playerSocket.rooms.has(roomCode)) {
      playerSocket.join(roomCode);
      playerSocket.data.roomId = roomCode;
    }
  }

  const sockets = io.sockets.adapter.rooms.get(roomCode);
  if (!sockets) return;
  const currentScores = Object.fromEntries(
    room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.score ?? 0]),
  );
  const previousScores = room.lastBroadcastScores;

  for (const socketId of sockets) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      const isPlayer = room.state.playerIds.includes(socketId);
      const legalMoves = isPlayer ? getRoomLegalMoves(roomCode, socketId) : [];
      const canDraw = isPlayer ? getRoomCanDraw(roomCode, socketId) : false;

      const handCounts = Object.fromEntries(
        room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.hand.length ?? 0]),
      );

      const maskedPlayers = Object.fromEntries(
        room.state.playerIds.map((pid) => {
          const playerState = room.state!.players[pid];
          const canReveal = room.state!.handOver || room.state!.gameOver || pid === socketId;
          return [
            pid,
            {
              ...playerState,
              hand: canReveal ? playerState.hand : [],
            },
          ];
        }),
      );

      const { __drawSequenceActive, ...stateForClient } = room.state as any;
      void __drawSequenceActive;
      socket.emit('state:update', {
        state: {
          ...stateForClient,
          players: maskedPlayers,
          handCounts,
        },
        legalMoves,
        canDraw,
      });

      if (
        room.state.handOver &&
        !room.state.gameOver &&
        room.lastHandEndedNotifiedHand !== room.state.handNumber
      ) {
        room.lastHandEndedNotifiedHand = room.state.handNumber;
        for (const pid of room.state.playerIds) {
          if (pid.startsWith('bot:fritz:')) continue;
          const playerSocket = io.sockets.sockets.get(pid);
          if (!playerSocket) continue;
          const opponentId = room.state.playerIds.find((id) => id !== pid) ?? null;
          const opponentHand = opponentId ? (room.state.players[opponentId]?.hand ?? []) : [];
          const myHand = room.state.players[pid]?.hand ?? [];

          // Compute awards directly from remaining tiles — do NOT use score deltas
          // (scores are already applied to room.state before this runs)
          const opponentPipSum = opponentHand.reduce((s, t) => s + t.high + t.low, 0);
          const myPipSum = myHand.reduce((s, t) => s + t.high + t.low, 0);

          // Winner is whoever went out (hand.length === 0), or lowest pips in blocked hand
          const iWentOut = myHand.length === 0;
          const opponentWentOut = opponentHand.length === 0;

          const youScoreDelta = iWentOut
            ? Math.round(opponentPipSum / 5)
            : opponentWentOut
            ? 0
            : myPipSum <= opponentPipSum
            ? Math.round(opponentPipSum / 5) // blocked hand, I had lower pips
            : 0;

          const opponentScoreDelta = opponentWentOut
            ? Math.round(myPipSum / 5)
            : iWentOut
            ? 0
            : opponentPipSum <= myPipSum
            ? Math.round(myPipSum / 5) // blocked hand, opponent had lower pips
            : 0;

          playerSocket.emit('hand:ended', {
            handNumber: room.state.handNumber,
            opponentRemainingTiles: opponentHand,
            pointsAwarded: {
              you: youScoreDelta,
              opponent: opponentScoreDelta,
            },
          });
        }
      }
    }
  }

  room.lastBroadcastScores = currentScores;

  // TOURNAMENT_SPECTATE_BROADCAST
  // Spectator-safe broadcast to anyone in the Socket.IO room (hands hidden)
  if (room.state) {
    const { __drawSequenceActive, ...stateForSpectatorsBase } = room.state as any;
    void __drawSequenceActive;
    const stateForSpectators = {
      ...stateForSpectatorsBase,
      players: Object.fromEntries(
        room.state.playerIds.map((pid) => {
          const ps = room.state!.players[pid];
          return [pid, { ...ps, hand: [] }];
        }),
      ),
      handCounts: Object.fromEntries(
        room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.hand.length ?? 0]),
      ),
    };
    io.to(room.code).emit('state:spectate', { state: stateForSpectators });
  }

  const roomAfter = (() => { try { return getRoom(roomCode); } catch { return null; } })();

  // Auto-ready bots for next hand
  if (roomAfter?.state?.handOver && !roomAfter.state.gameOver) {
    for (const pid of roomAfter.players) {
      if (pid.startsWith('bot:fritz:') && !roomAfter.nextHandReady.has(pid)) {
        setTimeout(async () => {
          try {
            const result = await readyForNextHand(roomCode, pid, io);
            if (result.started) {
              broadcastStateUpdate(roomCode);
              const freshRoom = (() => { try { return getRoom(roomCode); } catch { return null; } })();
              if (freshRoom?.state && !freshRoom.state.handOver && !freshRoom.state.gameOver) {
                // no-op
              }
            }
          } catch (e) {
            console.warn('[bot] auto-ready error', e);
          }
        }, 800);
      }
    }
  }

  if (room.state.gameOver) {
    if (isTournamentRoom) {
      finalizeTournamentMatchHook?.(room);
    }
    evaluateRoomLifecycle(room.code);
  }
}

io.on('connection', (socket: Socket) => {
/* ROOM_REACTIONS_CHAT_EMOTE */
  const leaveExistingSocketRooms = () => {
    const previousRooms = [...socket.rooms].filter((roomId) => roomId !== socket.id);
    previousRooms.forEach((roomId) => {
      socket.leave(roomId);
      evaluateRoomLifecycle(roomId);
    });
    socket.data.roomId = undefined;
  };

  const removeSocketPresence = () => {
    const userId = normalizeUserId(socket.data?.userId);
    if (!userId) return;
    const set = socketsByUserId.get(userId);
    if (!set) return;
    set.delete(socket.id);
    if (set.size === 0) socketsByUserId.delete(userId);
  };

  socket.on(
    'presence:identify',
    (payload: { userId?: string | null; username?: string }, cb?: AckFn) => {
    const userId = normalizeUserId(payload?.userId);
    if (!userId) return cb?.({ ok: false });
    console.log('[presence] identify received', userId);
    removeSocketPresence();
    socket.data.userId = userId;
    socket.data.username = normalizeUsername(payload?.username ?? socket.data?.username);
    const existing = socketsByUserId.get(userId) ?? new Set<string>();
    existing.add(socket.id);
    socketsByUserId.set(userId, existing);
    cb?.({ ok: true });
  });

  socket.on('presence:online', (argUserIds: unknown, cb?: AckFn) => {
    const userIds = Array.isArray(argUserIds)
      ? argUserIds
          .map((id) => normalizeUserId(id))
          .filter((id): id is string => Boolean(id))
      : [];
    const onlineUserIds = userIds.filter((id) => (socketsByUserId.get(id)?.size ?? 0) > 0);
    console.log(
      '[presence] online check',
      JSON.stringify({
        requested: userIds.length,
        online: onlineUserIds.length,
        registeredUsers: socketsByUserId.size,
      }),
    );
    cb?.({ ok: true, onlineUserIds });
  });

  socket.on(
    'friend:invite',
    (payload: { toUserId: string; fromUsername: string; roomCode: string; inviteUrl: string }) => {
      const roomCode = String(payload?.roomCode ?? '').trim().toUpperCase();
      try {
        getRoom(roomCode);
      } catch {
        console.log(`[friend:invite] ERROR room_not_found code=${roomCode} from=${socket.id}`);
        socket.emit('friend:invite:error', { ok: false, error: 'room_not_found' });
        return;
      }
      const toUserId = normalizeUserId(payload?.toUserId);
      if (!toUserId) return;
      const targetSockets = socketsByUserId.get(toUserId);
      if (!targetSockets) return;
      for (const socketId of targetSockets) {
        io.to(socketId).emit('friend:invited', {
          fromUsername: normalizeUsername(payload?.fromUsername),
          roomCode,
          inviteUrl: String(payload?.inviteUrl ?? ''),
        });
      }
    },
  );

  const nowMs = () => Date.now();
  const clampString = (s: string, max: number) => {
    const t = (s ?? '').trim();
    return t.length > max ? t.slice(0, max) : t;
  };

  const makeRateLimiter = (burst: number, perMs: number) => {
    let tokens = burst;
    let last = nowMs();
    return () => {
      const t = nowMs();
      const refill = ((t - last) / perMs) * burst;
      tokens = Math.min(burst, tokens + refill);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    };
  };

  const canSendChat = makeRateLimiter(6, 10_000);
  const canSendEmote = makeRateLimiter(10, 10_000);

  socket.on('room:chat:send', (payload: { text: string }) => {
    try {
      if (!canSendChat()) return;
      const roomId = (socket.data?.roomId as string | undefined) ?? undefined;
      if (!roomId) return;

      const text = clampString(String(payload?.text ?? ''), 200);
      if (!text) return;

      const msg = {
        id: `${nowMs()}-${Math.random().toString(16).slice(2)}`,
        t: nowMs(),
        from: {
          userId: (socket.data?.userId as string | undefined) ?? null,
          username: (socket.data?.username as string | undefined) ?? 'Player',
        },
        text,
      };

      socket.to(roomId).emit('room:chat', msg);
    } catch (e) {
      console.warn('room:chat:send failed', e);
    }
  });

  socket.on('room:emote:send', (payload: { emote: string }) => {
    try {
      if (!canSendEmote()) return;
      const roomId = (socket.data?.roomId as string | undefined) ?? undefined;
      if (!roomId) return;

      const emote = clampString(String(payload?.emote ?? ''), 16);
      if (!emote) return;

      const evt = {
        id: `${nowMs()}-${Math.random().toString(16).slice(2)}`,
        t: nowMs(),
        from: {
          userId: (socket.data?.userId as string | undefined) ?? null,
          username: (socket.data?.username as string | undefined) ?? 'Player',
        },
        emote,
      };

      socket.to(roomId).emit('room:emote', evt);
    } catch (e) {
      console.warn('room:emote:send failed', e);
    }
  });

  // WEEKLY_STATS
  socket.on("stats:weekly", async (cb?: any) => {
    try {
      const awards = await computeWeeklyAwards(Date.now());
      cb?.({ ok: true, awards });
    } catch {
      cb?.({ ok: false, error: "stats_failed" });
    }
  });


  console.log('Client connected:', socket.id);

  // TOURNAMENT_HELPERS
  // Global in-memory tournament storage (per server process).
  const tournamentsById = ((globalThis as any).__tournamentsById ??= new Map<string, Tournament>()) as Map<
    string,
    Tournament
  >;
  const tournamentsByCode = ((globalThis as any).__tournamentsByCode ??= new Map<string, string>()) as Map<
    string,
    string
  >;

  const emitTournament = (t: Tournament) => {
    const standings = sortedStandings(t.standings);
    io.to(`tourn:${t.id}`).emit('tournament:state', {
      id: t.id,
      hostSocketId: t.hostSocketId,
      lobbyCode: t.lobbyCode,
      status: t.status,
      players: t.players,
      matches: t.matches,
      currentMatchIndex: t.currentMatchIndex,
      activeMatchId: t.activeMatchId ?? null,
      activeRoomCode: t.activeRoomCode ?? null,
      standings,
    });
  };

  const getTournamentForSocket = (): Tournament | null => {
    const tid = (socket.data?.tournamentId as string | undefined) ?? undefined;
    if (!tid) return null;
    return tournamentsById.get(tid) ?? null;
  };

  const startNextMatch = (t: Tournament) => {
    // advance to next pending match
    while (t.currentMatchIndex < t.matches.length && t.matches[t.currentMatchIndex].status === 'done') {
      t.currentMatchIndex += 1;
    }
    if (t.currentMatchIndex >= t.matches.length) {
      t.status = 'complete';
      t.activeMatchId = null;
      t.activeRoomCode = null;
      emitTournament(t);
      return;
    }

    const m = t.matches[t.currentMatchIndex];
    m.status = 'active';
    t.activeMatchId = m.id;

    // Create a normal 2-player room for this match with a 30-point winning score.
    // Attach tournament metadata so we can record results later on gameOver.
    const room = createRoom(m.a, {
      winningScore: 30,
      tournamentId: t.id,
      tournamentMatchId: m.id,
      tournamentMode: 'round_robin',
    } as any);

    // Defensive: ensure config is accessible later even if createRoom doesn't persist arbitrary config
    (room as any).config = { ...(room as any).config, winningScore: 30, tournamentId: t.id, tournamentMatchId: m.id };

    m.roomCode = room.code;
    t.activeRoomCode = room.code;

    // Join the second player in the engine + socket room
    joinRoom(room.code, m.b);
    joinSocketToRoom(m.a, room.code, ['tourn:']);
    joinSocketToRoom(m.b, room.code, ['tourn:']);

    // Room roster for UI
    const pa = t.players.find((p) => p.socketId === m.a);
    const pb = t.players.find((p) => p.socketId === m.b);
    const roomPlayers = [
      { id: m.a, username: pa?.username ?? 'Player', userId: pa?.userId ?? null },
      { id: m.b, username: pb?.username ?? 'Player', userId: pb?.userId ?? null },
    ];
    roomPlayersByCode.set(room.code, roomPlayers);
    io.to(room.code).emit('room:update', { players: roomPlayers });

    // Announce active match (players + spectators)
    io.to(`tourn:${t.id}`).emit('tournament:match:assigned', {
      matchId: m.id,
      roomCode: room.code,
      a: m.a,
      b: m.b,
      aName: roomPlayers[0].username,
      bName: roomPlayers[1].username,
    });

    // Start match now
    void startGame(room.code, io)
      .then(() => {
        broadcastStateUpdate(room.code);
        emitTournament(t);
      })
      .catch((err) => {
        console.warn('[tournament] failed to start match room', err);
      });

  };

  const maybeFinalizeTournamentMatch = (room: any) => {
    if (!room?.state?.gameOver) return;

    const cfg = (room as any).config ?? {};
    const tid = cfg.tournamentId as string | undefined;
    const mid = cfg.tournamentMatchId as string | undefined;
    if (!tid || !mid) return;

    const t = tournamentsById.get(tid);
    if (!t) return;

    const match = t.matches.find((mm) => mm.id === mid);
    if (!match || match.status === 'done') return;

    const a = match.a;
    const b = match.b;
    const scoreA = room.state.players[a]?.score ?? 0;
    const scoreB = room.state.players[b]?.score ?? 0;
    const winner = scoreA >= scoreB ? a : b;

    applyResult(t, mid, winner, scoreA, scoreB);

    // advance (one match at a time)
    t.currentMatchIndex += 1;
    t.activeMatchId = null;
    t.activeRoomCode = null;

    emitTournament(t);
    startNextMatch(t);
  };
  finalizeTournamentMatchHook = maybeFinalizeTournamentMatch;

// TOURNAMENT_HANDLERS
  socket.on('tournament:create', (arg1?: unknown, arg2?: unknown) => {
    const config = (
      arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) ? arg1 : {}
    ) as { username?: unknown; userId?: unknown };
    const cb = (typeof arg1 === 'function' ? arg1 : arg2) as any;
    try {
            const username = normalizeUsername(config.username ?? socket.data?.username);
      const userId = normalizeUserId(config.userId ?? socket.data?.userId);
      socket.data.username = username;
      socket.data.userId = userId;

      const id = makeId('t');
      const lobbyCode = makeCode(4);

      const players: TournamentPlayer[] = [{
        socketId: socket.id,
        username,
        userId,
      }];

      const t: Tournament = {
        id,
        lobbyCode,
        hostSocketId: socket.id,
        status: 'lobby',
        players,
        matches: [],
        currentMatchIndex: 0,
        standings: initStandings(players),
        activeMatchId: null,
        activeRoomCode: null,
      };

      (globalThis as any).__tournamentsById.set(id, t);
      (globalThis as any).__tournamentsByCode.set(lobbyCode, id);

      socket.data.tournamentId = id;
      socket.join(`tourn:${id}`);

      cb?.({ ok: true, id, lobbyCode });
      // broadcast lobby state
      io.to(`tourn:${id}`).emit('tournament:lobby:update', { players: t.players, lobbyCode, hostSocketId: t.hostSocketId });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'create_failed';
      console.warn('[tournament:create] failed', e);
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('tournament:join', (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    const lobbyCode = String(argCode ?? '');
    const config = (
      arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? arg2 : {}
    ) as { username?: unknown; userId?: unknown };
    const cb = (typeof arg2 === 'function' ? arg2 : arg3) as any;
    try {
      const code = String(lobbyCode ?? '').trim().toUpperCase();
      const tid = (globalThis as any).__tournamentsByCode.get(code) as string | undefined;
      if (!tid) return cb?.({ ok: false, error: 'not_found' });

      const t = (globalThis as any).__tournamentsById.get(tid) as Tournament | undefined;
      if (!t) return cb?.({ ok: false, error: 'not_found' });
      if (t.status !== 'lobby') return cb?.({ ok: false, error: 'already_started' });

      if (!t.players.some((p) => p.socketId === socket.id)) {
                const username = normalizeUsername(config.username ?? socket.data?.username);
        const userId = normalizeUserId(config.userId ?? socket.data?.userId);
        socket.data.username = username;
        socket.data.userId = userId;
        t.players.push({ socketId: socket.id, username, userId });
        t.standings[socket.id] = {
          socketId: socket.id,
          username,
          played: 0,
          wins: 0,
          losses: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        };
      }

      socket.data.tournamentId = tid;
      socket.join(`tourn:${tid}`);

      cb?.({ ok: true, id: tid, lobbyCode: t.lobbyCode });
      io.to(`tourn:${tid}`).emit('tournament:lobby:update', { players: t.players, lobbyCode: t.lobbyCode, hostSocketId: t.hostSocketId });
    } catch (e) {
      cb?.({ ok: false, error: 'join_failed' });
    }
  });

  socket.on('tournament:add_bot', (arg1?: unknown, arg2?: unknown) => {
    const cb = (typeof arg2 === 'function' ? arg2 : typeof arg1 === 'function' ? arg1 : undefined) as AckFn | undefined;
    cb?.({ ok: false, error: 'bots_disabled' });
  });

  socket.on('tournament:remove_bot', (arg1?: unknown, arg2?: unknown) => {
    const cb = (typeof arg2 === 'function' ? arg2 : typeof arg1 === 'function' ? arg1 : undefined) as AckFn | undefined;
    cb?.({ ok: false, error: 'bots_disabled' });
  });

  socket.on('tournament:start', (cb?: any) => {
    try {
      const t = getTournamentForSocket();
      if (!t) return cb?.({ ok: false, error: 'no_tournament' });
      if (socket.id != t.hostSocketId) return cb?.({ ok: false, error: 'not_host' });
      if (t.status !== 'lobby') return cb?.({ ok: false, error: 'already_started' });
      // Tournament bots are disabled; prune any stale bot entries before start.
      const humanPlayers = t.players.filter(
        (p) => !p.isBot && !p.socketId.startsWith('bot:fritz:') && !p.username.startsWith('Fritz'),
      );
      t.players = humanPlayers;
      t.standings = Object.fromEntries(
        Object.entries(t.standings).filter(([socketId]) =>
          humanPlayers.some((player) => player.socketId === socketId),
        ),
      ) as typeof t.standings;

      if (t.players.length < 2) return cb?.({ ok: false, error: 'need_2' });

      t.status = 'running';
      t.matches = buildRoundRobinMatches(t.players);
      t.currentMatchIndex = 0;
      t.activeMatchId = null;
      t.activeRoomCode = null;

      emitTournament(t);
      startNextMatch(t);

      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: 'start_failed' });
    }
  });


  socket.on('room:create', (arg1?: unknown, arg2?: unknown) => {
    const config = (
      arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) ? arg1 : {}
    ) as RoomJoinConfig;
    const cb = (typeof arg1 === 'function' ? arg1 : arg2) as AckFn | undefined;
    const username = normalizeUsername(config.username);
    const userId = normalizeUserId(config.userId);
    const {
      username: _ignoredUsername,
      userId: _ignoredUserId,
      ...roomConfig
    } = config as Record<string, unknown>;
    console.log(`[room:create] socket=${socket.id}`);
    try {
      clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
      leaveExistingSocketRooms();
      const room = createRoom(socket.id, roomConfig as Record<string, unknown>);
      socket.join(room.code);
      socket.data.roomId = room.code;
      socket.data.username = username;
      socket.data.userId = userId;
      const roomPlayers: RoomPlayer[] = [{ id: socket.id, username, userId }];
      roomPlayersByCode.set(room.code, roomPlayers);
      console.log(`[room:create] created room=${room.code}, players=${room.players.length}`);
      cb?.({ ok: true, roomCode: room.code, you: socket.id, players: roomPlayers });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[room:create] ERROR: ${message}`);
      cb?.({ ok: false, error: message });
    }
  });

  
socket.on('room:spectate', (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    const cb = (
      typeof arg3 === 'function' ? arg3 : typeof arg2 === 'function' ? arg2 : undefined
    ) as AckFn | undefined;
    const config =
      arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? (arg2 as RoomJoinConfig) : {};
    const username = normalizeUsername(config.username);
    const userId = normalizeUserId(config.userId);
    const code = String(argCode ?? '').trim().toUpperCase();
    try {
      if (!code) return cb?.({ ok: false, error: 'missing_code' });
      clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
      leaveExistingSocketRooms();

      let room: Room | null = null;
      try {
        room = getRoom(code);
      } catch {
        return cb?.({ ok: false, error: 'not_found' });
      }

      // Socket room only — DO NOT join the game engine.
      socket.join(code);
      socket.data.roomId = code;
      socket.data.username = username;
      socket.data.userId = userId;

      // Send roster snapshot
      const roster = roomPlayersByCode.get(code) ?? [];
      socket.emit('room:update', { players: roster });

      // Send a spectator-safe snapshot to just this socket.
      if (room.state) {
        const stateWithCounts = {
          ...room.state,
          players: Object.fromEntries(
            room.state.playerIds.map((pid: string) => {
              const playerState = room.state!.players[pid];
              const canReveal = room.state!.handOver || room.state!.gameOver || pid === socket.id;
              return [
                pid,
                {
                  ...playerState,
                  hand: canReveal ? playerState.hand : [],
                },
              ];
            }),
          ),
          handCounts: Object.fromEntries(
            room.state.playerIds.map((pid: string) => [pid, room.state!.players[pid]?.hand.length ?? 0]),
          ),
        };
        socket.emit('state:update', {
          state: stateWithCounts,
          legalMoves: [],
          canDraw: false,
        });
      }

      cb?.({ ok: true, roomCode: code, players: roster });
    } catch (e) {
      cb?.({ ok: false, error: 'spectate_failed' });
    }
  });

  socket.on('room:join', (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    const cb = (
      typeof arg3 === 'function' ? arg3 : typeof arg2 === 'function' ? arg2 : undefined
    ) as AckFn | undefined;
    const explicitConfig =
      arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? (arg2 as RoomJoinConfig) : null;
    const codeFromObject =
      argCode && typeof argCode === 'object' && !Array.isArray(argCode)
        ? (argCode as { roomCode?: unknown; username?: unknown; userId?: unknown })
        : null;
    const configFromCodeObject: RoomJoinConfig | null = codeFromObject
      ? {
          username:
            typeof codeFromObject.username === 'string' ? codeFromObject.username : undefined,
          userId: typeof codeFromObject.userId === 'string' ? codeFromObject.userId : null,
        }
      : null;
    const config = explicitConfig ?? configFromCodeObject ?? {};
    const username = normalizeUsername(config.username);
    const userId = normalizeUserId(config.userId);
    const rawCode = codeFromObject?.roomCode ?? argCode;
    const roomCode = String(rawCode ?? '')
      .trim()
      .toUpperCase();
    console.log(`[room:join] socket=${socket.id}, code=${roomCode}`);
    try {
      clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
      leaveExistingSocketRooms();
      let room: Room | null = null;
      let roster: RoomPlayer[] = [];
      let migratedByUserId = false;
      const existingRoom = getRoom(roomCode);
      roster = (
        roomPlayersByCode.get(roomCode) ??
        getRoomPlayersWithFallback(roomCode, existingRoom.players)
      ).slice();
      if (existingRoom && userId) {
        const existingPlayer = roster.find((player) => player.userId === userId);
        if (existingPlayer) {
          migrateRoomSeat(roomCode, existingPlayer.id, socket.id);
          roster = roster
            .map((player) =>
              player.id === existingPlayer.id ? { ...player, id: socket.id, username, userId } : player,
            )
            .filter((player) => player.id !== existingPlayer.id);
          roomPlayersByCode.set(roomCode, roster);
          socket.data.roomId = roomCode;
          room = existingRoom;
          migratedByUserId = true;
        }
      }
      if (!migratedByUserId) {
        try {
          room = joinRoom(roomCode, socket.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'unknown error';
          if (!message.toLowerCase().includes('room is full')) {
            throw err;
          }
          const seats = pruneReconnectSeats(roomCode);
          const match = seats.find((seat) =>
            identityMatchesReconnectSeat(seat, {
              username,
              userId,
            }),
          );
          if (!match) throw err;
          migrateRoomSeat(roomCode, match.oldSocketId, socket.id);
          reconnectSeatsByCode.set(
            roomCode,
            seats.filter((seat) => seat.oldSocketId !== match.oldSocketId),
          );
          roster = roster
            .map((player) =>
              player.id === match.oldSocketId ? { ...player, id: socket.id, username, userId } : player,
            )
            .filter((player) => player.id !== match.oldSocketId);
          room = getRoom(roomCode);
        }
      }
      if (!room) throw new Error('Room not found.');
      socket.join(room.code);
      socket.data.roomId = room.code;
      socket.data.username = username;
      socket.data.userId = userId;
      const existingIdx = roster.findIndex((p) => p.id === socket.id);
      if (existingIdx >= 0) {
        roster[existingIdx] = { id: socket.id, username, userId };
      } else {
        roster.push({ id: socket.id, username, userId });
      }
      roomPlayersByCode.set(room.code, roster);
      io.to(room.code).emit('room:update', { players: roster });
      console.log(`[room:join] joined room=${room.code}, players=${room.players.length}`);
      const stateWithCounts = room.state
        ? {
            ...room.state,
            players: Object.fromEntries(
              room.state.playerIds.map((pid) => {
                const playerState = room.state!.players[pid];
                const canReveal = room.state!.handOver || room.state!.gameOver || pid === socket.id;
                return [
                  pid,
                  {
                    ...playerState,
                    hand: canReveal ? playerState.hand : [],
                  },
                ];
              }),
            ),
            handCounts: Object.fromEntries(
              room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.hand.length ?? 0]),
            ),
          }
        : null;
      const rejoinLegalMoves = room.state ? getRoomLegalMoves(room.code, socket.id) : [];
      const rejoinCanDraw = room.state ? getRoomCanDraw(room.code, socket.id) : false;
      cb?.({
        ok: true,
        roomCode: room.code,
        you: socket.id,
        players: roster,
        state: stateWithCounts,
        legalMoves: rejoinLegalMoves,
        canDraw: rejoinCanDraw,
      });
      // Broadcast updated state so the rejoined socket
      // receives legal moves immediately as a fallback.
      if (room.state) {
        try {
          broadcastStateUpdate(room.code);
        } catch {
          // non-fatal
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[room:join] ERROR: ${message}`);
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('room:leave', (roomCode: unknown) => {
    const code = typeof roomCode === 'string' ? roomCode.trim().toUpperCase() : '';
    if (!code) return;

    // Leave the socket.io channel immediately
    socket.leave(code);
    socket.data.roomId = undefined;

    // Remove from room players list
    try {
      const room = getRoom(code);
      room.players = room.players.filter((pid) => pid !== socket.id);

      // Remove from roomPlayersByCode metadata
      const meta = roomPlayersByCode.get(code) ?? [];
      roomPlayersByCode.set(code, meta.filter((p) => p.id !== socket.id));

      // Clear any reconnect seat for this socket
      const seats = reconnectSeatsByCode.get(code) ?? [];
      reconnectSeatsByCode.set(code, seats.filter((s) => s.oldSocketId !== socket.id));

      // Notify remaining players
      const remainingMeta = roomPlayersByCode.get(code) ?? [];
      io.to(code).emit('room:update', { players: remainingMeta });

      // Evaluate cleanup
      evaluateRoomLifecycle(code);
    } catch {
      // Room may already be gone — no-op
    }
  });

  socket.on('game:start', async (code, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[game:start] socket=${socket.id}, code=${roomCode}`);
    try {
      const existingRoom = getRoom(roomCode);
      const liveCount = io.sockets.adapter.rooms.get(roomCode)?.size ?? 0;
      const rosterCount = (
        roomPlayersByCode.get(roomCode) ??
        getRoomPlayersWithFallback(roomCode, existingRoom.players)
      ).length;
      if (liveCount < 2 || rosterCount < 2) {
        if (typeof cb === 'function') cb({ ok: false, error: 'waiting_for_players' });
        return;
      }
      const room = await startGame(roomCode, io);
      console.log(
        `[game:start] game started, handNumber=${room.state?.handNumber}, handOver=${room.state?.handOver}`,
      );
      broadcastStateUpdate(room.code);
      if (typeof cb === 'function') cb({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[game:start] ERROR: ${message}`);
      if (typeof cb === 'function') cb({ ok: false, error: message });
    }
  });

  socket.on('game:action', async (code, action, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[game:action] socket=${socket.id}, code=${roomCode}, action=${action?.type}`);
    try {
      const existingRoom = getRoom(roomCode);
      if (!existingRoom.players.includes(socket.id)) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Spectators cannot act.' });
        return;
      }
      const room = await act(roomCode, socket.id, action, io, (code) => broadcastStateUpdate(code));
      broadcastStateUpdate(room.code);
      maybeFinalizeTournamentMatch(room);
      if (typeof cb === 'function') cb({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[game:action] ERROR: ${message}`);
      if (typeof cb === 'function') cb({ ok: false, error: message });
    }
  });

  socket.on('hand:next', async (code, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[hand:next] socket=${socket.id}, code=${roomCode}`);
    try {
      const room = await nextHand(roomCode, io);
      console.log(`[hand:next] new hand started, handNumber=${room.state?.handNumber}`);
      broadcastStateUpdate(room.code);
      maybeFinalizeTournamentMatch(room);
      if (typeof cb === 'function') cb({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[hand:next] ERROR: ${message}`);
      if (typeof cb === 'function') cb({ ok: false, error: message });
    }
  });

  socket.on('hand:ready', async (code, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    try {
      const result = await readyForNextHand(roomCode, socket.id, io);
      if (result.started) {
        broadcastStateUpdate(result.room.code);
        maybeFinalizeTournamentMatch(result.room);
      }
      cb?.({ ok: true, started: result.started });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('game:rematch', async (code: unknown, cb?: AckFn) => {
    const roomCode = String(code ?? '').trim().toUpperCase();
    try {
      const room = getRoom(roomCode);
      const cfg = (room as any).config ?? {};

      if (cfg.tournamentId) {
        return cb?.({ ok: false, error: 'Rematch is unavailable in tournament rooms.' });
      }
      if (!room.players.includes(socket.id)) {
        return cb?.({ ok: false, error: 'Only room players can request rematch.' });
      }
      if (!room.state) {
        return cb?.({ ok: false, error: 'Game not started.' });
      }
      if (!room.state.gameOver) {
        return cb?.({ ok: false, error: 'Rematch is only available after game over.' });
      }

      room.rematchReady.add(socket.id);
      emitRematchStatus(room.code);

      const bothReady =
        room.players.length === 2 && room.players.every((playerId) => room.rematchReady.has(playerId));
      if (!bothReady) {
        return cb?.({ ok: true, started: false });
      }

      room.rematchReady.clear();
      (room as any)._matchLogged = false;
      (room as any)._leadTracker = {
        aId: room.players[0],
        bId: room.players[1],
        maxLeadA: 0,
        maxLeadB: 0,
      };
      await startGame(room.code, io);
      broadcastStateUpdate(room.code);
      io.to(room.code).emit('game:rematch:started', { roomCode: room.code });
      emitRematchStatus(room.code);
      cb?.({ ok: true, started: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('player:dragging', (code: unknown, payload?: { dragging?: boolean }) => {
    const roomCode = String(code ?? '').trim().toUpperCase();
    if (!roomCode) return;
    try {
      const room = getRoom(roomCode);
      if (!room.players.includes(socket.id)) return;
      socket.to(roomCode).emit('player:dragging', {
        playerId: socket.id,
        dragging: Boolean(payload?.dragging),
      });
    } catch {
      // ignore invalid room
    }
  });

  socket.on('disconnect', () => {
    removeSocketPresence();
    const roomCode = (socket.data?.roomId as string | undefined) ?? undefined;
    if (roomCode) {
      try {
        const room = getRoom(roomCode);
        if (room.players.includes(socket.id)) {
          reserveReconnectSeat(roomCode, {
            oldSocketId: socket.id,
            username: normalizeUsername(socket.data?.username),
            userId: normalizeUserId(socket.data?.userId),
          });
        }
      } catch {
        // room no longer exists
      }
    }
    clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
    evaluateRoomLifecycle(roomCode);
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = 3001;

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  startRankingCron();
});
