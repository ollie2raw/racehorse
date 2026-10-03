/**
 * In-memory port of the three tournament match-state RPCs, for unit tests.
 *
 * ── SOURCE OF TRUTH ─────────────────────────────────────────────────────────
 * supabase/migrations/2026-08-31_tournament_match_rpcs.sql
 *
 * This file MUST mirror that plpgsql: same validation order, same error codes,
 * same return shape, same advancement / elimination / placement rules. If you
 * change the migration, change this too (and vice versa) — the pg16 smoke test
 * in that PR is what catches drift end-to-end; this keeps the fast unit tests
 * honest in between.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { applyMatchResult } from './engine';
import type { EnginePersistence } from './persistenceInterface';
import type { MatchRow, RegistrationRow } from './types';

/**
 * Test-only: drive a match `ready`/`waiting` → `in_progress` (as the real
 * dispatch + attach flow does) and then record the result. Use this instead of
 * calling `applyMatchResult` directly on a `ready` match with a `game_over`
 * source — `complete_tournament_match` rejects that (a real game-over can only
 * come from a match a human actually played). Same argument order as
 * `applyMatchResult`.
 */
export async function recordMatchResultForTest(
  io: Parameters<typeof applyMatchResult>[0],
  params: Parameters<typeof applyMatchResult>[1],
  persistence: EnginePersistence,
): Promise<void> {
  const m = await persistence.fetchMatchById(params.matchId);
  if (m && (m.status === 'waiting' || m.status === 'ready')) {
    if (m.status === 'waiting') await persistence.promoteTournamentMatch(params.matchId, 'ready');
    await persistence.promoteTournamentMatch(params.matchId, 'in_progress');
  }
  await applyMatchResult(io, params, persistence);
}

const isBot = (id: string | null | undefined): boolean =>
  typeof id === 'string' && id.startsWith('bot:fritz:');

/** Test-store adapter. Each test file wires its own store into these accessors. */
export type InMemoryMatchRpcStore = {
  /** Every match in the tournament the call touches. */
  listMatches(): MatchRow[];
  getMatch(id: string): MatchRow | undefined;
  patchMatch(id: string, patch: Partial<MatchRow>): void;
  listRegistrations(): RegistrationRow[];
  patchRegistration(userId: string, patch: Partial<RegistrationRow>): void;
  getWinTarget(tournamentId: string): number;
  getTournamentStatus(tournamentId: string): string | undefined;
  setTournament(tournamentId: string, patch: { status?: string; winner_id?: string }): void;
};

/** QF1→SF1.p1, QF2→SF1.p2, QF3→SF2.p1, QF4→SF2.p2; SF1→F.p1, SF2→F.p2. */
function advanceTarget(
  round: number,
  matchNumber: number,
): { nextRound: number; nextMatchNumber: number; nextSlot: 'player1' | 'player2' } | null {
  if (round === 1) {
    return {
      nextRound: 2,
      nextMatchNumber: Math.floor((matchNumber + 1) / 2),
      nextSlot: matchNumber % 2 === 1 ? 'player1' : 'player2',
    };
  }
  if (round === 2) {
    return { nextRound: 3, nextMatchNumber: 1, nextSlot: matchNumber === 1 ? 'player1' : 'player2' };
  }
  return null;
}

function canonicalScores(
  winnerId: string,
  p1: string | null,
  p2: string | null,
  source: string | null,
  winTarget: number,
  reportedP1: number | null | undefined,
  reportedP2: number | null | undefined,
): { player1_score: number; player2_score: number } {
  if (source === null || source === 'no_show' || source === 'forfeit') {
    return {
      player1_score: winnerId === p1 ? winTarget : 0,
      player2_score: winnerId === p2 ? winTarget : 0,
    };
  }
  // game_over
  const r1 = reportedP1 ?? 0;
  const r2 = reportedP2 ?? 0;
  if (r1 < 0 || r2 < 0) throw new Error('score_inconsistent');
  if ((winnerId === p1 && r1 < r2) || (winnerId === p2 && r2 < r1)) {
    throw new Error('score_inconsistent');
  }
  return { player1_score: r1, player2_score: r2 };
}

export function makeInMemoryMatchRpc(
  store: InMemoryMatchRpcStore,
): Pick<EnginePersistence, 'completeTournamentMatch' | 'promoteTournamentMatch'> {
  const botTierFor = (round: number): 'standard' | 'elite' | 'master' =>
    round === 3 ? 'master' : round === 2 ? 'elite' : 'standard';

  return {
    async completeTournamentMatch(params) {
      const match = store.getMatch(params.matchId);
      if (!match) throw new Error('match_not_found');

      // 2 ── already completed → idempotent / conflict-explicit
      if (match.status === 'completed') {
        return {
          status: match.status,
          winner_id: match.winner_id,
          winner_source: match.winner_source,
          player1_score: match.player1_score,
          player2_score: match.player2_score,
          applied: false,
          conflict: match.winner_id !== params.winnerId,
          advanced_to_match_id: null,
          advanced_to_slot: null,
          advanced_to_status: null,
          tournament_completed: match.round === 3,
          round_now_complete: null,
          placements: null,
        };
      }

      // 3 ── playable state
      if (match.status === 'waiting') throw new Error('match_not_playable');
      if (match.status === 'bye' && !params.byeWalkover) throw new Error('match_not_playable');

      const winTarget = store.getWinTarget(match.tournament_id);
      const bye = params.byeWalkover === true;

      if (!bye) {
        const hasHuman = !(isBot(match.player1_id) && isBot(match.player2_id));
        // 4 ── game_over only from a match a human actually played
        if (params.winnerSource === 'game_over' && hasHuman && match.status !== 'in_progress') {
          throw new Error('game_over_on_non_started_match');
        }
        // 5 ── no_show / forfeit only from a live match
        if (
          (params.winnerSource === 'no_show' || params.winnerSource === 'forfeit') &&
          match.status !== 'ready' &&
          match.status !== 'in_progress'
        ) {
          throw new Error('invalid_source_for_status');
        }
        // 6 ── T-INV-2
        if (
          match.player1_id == null ||
          match.player2_id == null ||
          (params.winnerId !== match.player1_id && params.winnerId !== match.player2_id)
        ) {
          throw new Error('winner_not_participant');
        }
      } else if (params.winnerId !== (match.player1_id ?? match.player2_id)) {
        throw new Error('winner_not_participant');
      }

      // 7 ── canonical scores (T-INV-4)
      const scores = canonicalScores(
        params.winnerId,
        match.player1_id,
        match.player2_id,
        params.winnerSource,
        winTarget,
        params.reportedPlayer1Score,
        params.reportedPlayer2Score,
      );

      // 8 ── write completion
      store.patchMatch(match.id, {
        status: 'completed',
        winner_id: params.winnerId,
        winner_source: params.winnerSource,
        status_reason: params.statusReason ?? null,
        no_show_user_id: params.noShowUserId ?? null,
        forfeit_user_id: params.forfeitUserId ?? null,
        player1_score: scores.player1_score,
        player2_score: scores.player2_score,
        completed_at: new Date().toISOString(),
      });

      // 9 ── eliminate the human loser
      if (!bye) {
        const loserId =
          params.winnerId === match.player1_id
            ? match.player2_id
            : params.winnerId === match.player2_id
              ? match.player1_id
              : null;
        if (loserId && !isBot(loserId)) {
          const reg = store.listRegistrations().find((r) => r.user_id === loserId);
          if (reg && reg.status !== 'winner') {
            store.patchRegistration(loserId, { status: 'eliminated' });
          }
        }
      }

      const roundDone = () =>
        store
          .listMatches()
          .filter((m) => m.round === match.round)
          .every((m) => m.status === 'completed' || m.status === 'bye');

      // 10 ── round 3 → complete the tournament
      if (match.round === 3) {
        if (!isBot(params.winnerId)) {
          store.patchRegistration(params.winnerId, { status: 'winner', placement: 1 });
        }
        for (const m of store.listMatches().filter((x) => x.status === 'completed')) {
          const loser =
            m.winner_id === m.player1_id
              ? m.player2_id
              : m.winner_id === m.player2_id
                ? m.player1_id
                : null;
          if (!loser || isBot(loser)) continue;
          const reg = store.listRegistrations().find((r) => r.user_id === loser);
          if (reg && reg.placement == null) {
            store.patchRegistration(loser, { placement: m.round === 3 ? 2 : m.round === 2 ? 3 : 5 });
          }
        }
        if (store.getTournamentStatus(match.tournament_id) === 'in_progress') {
          store.setTournament(match.tournament_id, { status: 'completed', winner_id: params.winnerId });
        }
        return {
          status: 'completed',
          winner_id: params.winnerId,
          winner_source: params.winnerSource,
          player1_score: scores.player1_score,
          player2_score: scores.player2_score,
          applied: true,
          conflict: false,
          advanced_to_match_id: null,
          advanced_to_slot: null,
          advanced_to_status: null,
          tournament_completed: true,
          round_now_complete: roundDone(),
          placements: store
            .listRegistrations()
            .filter((r) => r.placement != null && !isBot(r.user_id))
            .map((r) => ({ user_id: r.user_id, placement: r.placement as number })),
        };
      }

      // 10 ── rounds 1 & 2 → advance the winner
      const tgt = advanceTarget(match.round, match.match_number);
      if (!tgt) throw new Error('no_advance_target');
      const target = store
        .listMatches()
        .find((m) => m.round === tgt.nextRound && m.match_number === tgt.nextMatchNumber);
      if (!target) {
        // Corrupt bracket (a 7-row bracket always has this target). The
        // completion is real — do not undo it; return the flag so Node logs it.
        return {
          status: 'completed',
          winner_id: params.winnerId,
          winner_source: params.winnerSource,
          player1_score: scores.player1_score,
          player2_score: scores.player2_score,
          applied: true,
          conflict: false,
          advance_target_missing: true,
          advanced_to_match_id: null,
          advanced_to_slot: null,
          advanced_to_status: null,
          tournament_completed: false,
          round_now_complete: roundDone(),
          placements: null,
        };
      }

      const slotCol = tgt.nextSlot === 'player1' ? 'player1_id' : 'player2_id';
      const otherCol = tgt.nextSlot === 'player1' ? 'player2_id' : 'player1_id';
      let advancedStatus: MatchRow['status'] = target.status;
      if (target[slotCol] == null || target[slotCol] === params.winnerId) {
        advancedStatus = target[otherCol] != null ? 'ready' : 'waiting';
        store.patchMatch(target.id, {
          [slotCol]: params.winnerId,
          status: advancedStatus,
          bot_tier:
            isBot(params.winnerId) || isBot(target[otherCol])
              ? botTierFor(tgt.nextRound)
              : null,
        } as Partial<MatchRow>);
      }

      return {
        status: 'completed',
        winner_id: params.winnerId,
        winner_source: params.winnerSource,
        player1_score: scores.player1_score,
        player2_score: scores.player2_score,
        applied: true,
        conflict: false,
        advanced_to_match_id: target.id,
        advanced_to_slot: tgt.nextSlot,
        advanced_to_status: advancedStatus,
        tournament_completed: false,
        round_now_complete: roundDone(),
        placements: null,
      };
    },

    async promoteTournamentMatch(matchId, toStatus, opts = {}) {
      const match = store.getMatch(matchId);
      if (!match) throw new Error('match_not_found');
      if (match.status === 'completed' || match.status === 'bye') {
        return {
          status: match.status,
          ready_at: match.ready_at,
          ready_deadline_at: match.ready_deadline_at,
          started_at: match.started_at,
          room_code: match.room_code,
          conflict: true,
        };
      }
      if (match.status === toStatus) {
        return {
          status: match.status,
          ready_at: match.ready_at,
          ready_deadline_at: match.ready_deadline_at,
          started_at: match.started_at,
          room_code: match.room_code,
          conflict: false,
        };
      }
      if (toStatus === 'ready') {
        if (match.status !== 'waiting' || match.player1_id == null || match.player2_id == null) {
          throw new Error('invalid_promotion');
        }
        store.patchMatch(matchId, {
          status: 'ready',
          ready_at: match.ready_at ?? opts.readyAt ?? new Date().toISOString(),
          ready_deadline_at: match.ready_deadline_at ?? opts.readyDeadlineAt ?? null,
          room_code: opts.roomCode ?? match.room_code,
          status_reason: null,
        });
      } else {
        if (match.status !== 'ready' && match.status !== 'in_progress') {
          throw new Error('invalid_promotion');
        }
        store.patchMatch(matchId, {
          status: 'in_progress',
          started_at: match.started_at ?? opts.startedAt ?? new Date().toISOString(),
          room_code: opts.roomCode ?? match.room_code,
          status_reason: null,
        });
      }
      const after = store.getMatch(matchId)!;
      return {
        status: after.status,
        ready_at: after.ready_at,
        ready_deadline_at: after.ready_deadline_at,
        started_at: after.started_at,
        room_code: after.room_code,
        conflict: false,
      };
    },
  };
}

/**
 * Convenience adapter for the common test store shape
 * `{ tournament: ScheduledTournamentRow; matches: MatchRow[]; regs: RegistrationRow[] }`.
 *
 * Also ports generate_tournament_bracket v2
 * (supabase/migrations/2026-09-29_tournament_bracket_rpc_repair.sql): same
 * checks in the same order, same error codes, same repair rules. Keep in step
 * with that file.
 */
export function inMemoryMatchRpcForArrayStore(store: {
  tournament: { id: string; win_target: number; status: string; winner_id: string | null; max_players?: number };
  matches: MatchRow[];
  regs: RegistrationRow[];
}): Pick<EnginePersistence, 'completeTournamentMatch' | 'promoteTournamentMatch' | 'generateTournamentBracket'> {
  const rpc = makeInMemoryMatchRpc({
    listMatches: () => store.matches,
    getMatch: (id) => store.matches.find((m) => m.id === id),
    patchMatch: (id, patch) => {
      const m = store.matches.find((x) => x.id === id);
      if (m) Object.assign(m, patch);
    },
    listRegistrations: () => store.regs,
    patchRegistration: (userId, patch) => {
      const r = store.regs.find((x) => x.user_id === userId);
      if (r) Object.assign(r, patch);
    },
    getWinTarget: () => store.tournament.win_target,
    getTournamentStatus: () => store.tournament.status,
    setTournament: (_id, patch) => {
      if (patch.status !== undefined) store.tournament.status = patch.status;
      if (patch.winner_id !== undefined) store.tournament.winner_id = patch.winner_id;
    },
  });

  let nextMatchSeq = store.matches.length + 1;
  const newMatch = (tournamentId: string, round: number, matchNumber: number, p1: string | null, p2: string | null, status: MatchRow['status'], botTier: MatchRow['bot_tier']): MatchRow => ({
    id: `m-${nextMatchSeq++}`,
    tournament_id: tournamentId,
    round: round as MatchRow['round'],
    match_number: matchNumber,
    player1_id: p1,
    player2_id: p2,
    winner_id: null,
    room_code: '',
    status,
    ready_at: null,
    ready_deadline_at: null,
    started_at: null,
    completed_at: null,
    player1_joined_at: null,
    player2_joined_at: null,
    winner_source: null,
    status_reason: null,
    forfeit_user_id: null,
    no_show_user_id: null,
    bot_tier: botTier ?? null,
    player1_score: null,
    player2_score: null,
  });
  const matchesOf = (tid: string) => store.matches.filter((m) => m.tournament_id === tid);
  const hasSlot = (tid: string, round: number, matchNumber: number) =>
    store.matches.some((m) => m.tournament_id === tid && m.round === round && m.match_number === matchNumber);

  return {
    ...rpc,
    async generateTournamentBracket({ tournamentId, qfPairs, seeds }) {
      const t = store.tournament;
      if (t.id !== tournamentId) throw new Error('tournament_not_found');
      if (t.status === 'cancelled' || t.status === 'completed') throw new Error('tournament_not_startable');
      const existing = matchesOf(tournamentId).length;
      const sorted = () =>
        matchesOf(tournamentId)
          .slice()
          .sort((a, b) => a.round - b.round || a.match_number - b.match_number)
          .map((m) => ({ ...m }));

      if (t.status === 'in_progress' && existing >= 7) {
        return { created: false, repaired: false, matches: sorted() };
      }

      let created = false;
      let repaired = false;
      if (t.status === 'upcoming' || t.status === 'registration_open') {
        const registered = new Set(store.regs.filter((r) => r.status === 'registered').map((r) => r.user_id));
        const seeded = new Set(seeds.map((x) => x.user_id));
        const same = registered.size === seeded.size && [...registered].every((id) => seeded.has(id));
        if (!same) throw new Error('registrations_changed');
        if (seeds.length > (t.max_players ?? 8)) throw new Error('tournament_full');
        if (existing > 0) {
          const played = matchesOf(tournamentId).some(
            (m) => (m.status !== 'waiting' && m.status !== 'bye') || m.winner_id != null,
          );
          if (played) throw new Error('bracket_partial_conflict');
          for (let i = store.matches.length - 1; i >= 0; i -= 1) {
            if (store.matches[i].tournament_id === tournamentId) store.matches.splice(i, 1);
          }
          repaired = true;
        }
        created = true;
      } else {
        repaired = true;
      }

      for (const pair of qfPairs) {
        if (hasSlot(tournamentId, 1, pair.match_number)) continue;
        const status = pair.player1_id == null || pair.player2_id == null ? 'bye' : 'waiting';
        store.matches.push(newMatch(tournamentId, 1, pair.match_number, pair.player1_id, pair.player2_id, status, pair.bot_tier));
      }
      for (const [round, matchNumber] of [[2, 1], [2, 2], [3, 1]] as const) {
        if (!hasSlot(tournamentId, round, matchNumber)) {
          store.matches.push(newMatch(tournamentId, round, matchNumber, null, null, 'waiting', null));
        }
      }
      for (const { user_id, seed } of seeds) {
        const reg = store.regs.find((r) => r.user_id === user_id && r.status === 'registered');
        if (reg) {
          reg.status = 'active';
          reg.seed = seed;
        }
      }
      if (t.status !== 'in_progress') t.status = 'in_progress';

      for (const qf of matchesOf(tournamentId).filter((m) => m.round === 1 && m.status === 'bye')) {
        const winnerId = qf.player1_id ?? qf.player2_id;
        if (winnerId) {
          await rpc.completeTournamentMatch({ matchId: qf.id, winnerId, winnerSource: null, byeWalkover: true });
        }
      }
      return { created, repaired, matches: sorted() };
    },
  };
}
