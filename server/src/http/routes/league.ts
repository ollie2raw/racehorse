import type { Application, Request } from 'express';
import type { LeagueMemberRow, FixtureRow, LeagueRow } from '../../supabaseTypes';
import { setPrivateShortCache } from './cacheControl';
import { assignPlayerToLeague } from '../../league/service';
import { generateLeagueFixtures } from '../../league/schedule';
import {
  recordLeagueAsyncResult,
  recordLeagueLiveResult,
  openLeagueFixtureLiveRoom,
} from '../../league/results';
import { runLeagueForfeitJob } from '../../league/forfeit';
import { runLeagueSundayRollover } from '../../league/rollover';
import { getLeagueStateForPlayer } from '../../league/state';
import { getLeagueHistoryForPlayer } from '../../league/history';
import { createReservedRoom, getRoom } from '../../rooms';
import { makeCode } from '../../tournament/tournament';

export type LeagueRouteDeps = {
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  supabaseFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
  isAdminSecret: (value: unknown) => boolean;
  socketsByUserId: Map<string, Set<string>>;
};

export function registerLeagueRoutes(app: Application, deps: LeagueRouteDeps): void {
  const { getAuthenticatedUserId, supabaseFetch, isAdminSecret, socketsByUserId } = deps;

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
      const membershipRows = await supabaseFetch<LeagueMemberRow[]>(
        `/rest/v1/league_members?select=id&league_id=eq.${leagueId}&player_user_id=eq.${encodeURIComponent(authenticatedUserId)}&limit=1`,
      );
      if (!membershipRows?.[0]?.id) {
        res.status(403).json({ error: 'Forbidden' });
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

      const fixtureRows = await supabaseFetch<FixtureRow[]>(
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
      const leagueRows = await supabaseFetch<LeagueRow[]>(
        `/rest/v1/leagues?select=id,status&id=eq.${fixture.league_id}&limit=1`,
      );
      const league = leagueRows?.[0];
      if (!league || league.status !== 'active') {
        res.status(409).json({ error: 'This fixture is no longer playable.' });
        return;
      }

      const membershipRows = await supabaseFetch<LeagueMemberRow[]>(
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
      if (
        (resolvedMode === 'ghost' || resolvedMode === 'bot') &&
        fixture.status !== 'scheduled' &&
        fixture.status !== 'provisional'
      ) {
        res.status(409).json({ error: `Fixture ${fixtureId} is not currently playable async.` });
        return;
      }
      if (resolvedMode === 'ghost' && otherMember.member_type !== 'player') {
        res.status(400).json({ error: 'Ghost mode is only valid for player-vs-player fixtures.' });
        return;
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
    if (!isAdminSecret(req.body?.adminKey)) {
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
    if (!isAdminSecret(req.body?.adminKey)) {
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
      setPrivateShortCache(res, 30);
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
      setPrivateShortCache(res, 60);
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

      const fixtureRows = await supabaseFetch<FixtureRow[]>(
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
      const leagueRows = await supabaseFetch<LeagueRow[]>(
        `/rest/v1/leagues?select=id,status&id=eq.${fixture.league_id}&limit=1`,
      );
      const league = leagueRows?.[0];
      if (!league || league.status !== 'active') {
        res.status(409).json({ error: 'This fixture is no longer available for live play.' });
        return;
      }

      const membershipRows = await supabaseFetch<LeagueMemberRow[]>(
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
}