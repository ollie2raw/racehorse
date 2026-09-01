/**
 * `assertBracketConsistent` — the invariant-assertion helper called at the end
 * of tournament engine / harness tests (HARDENING_PLAN.md §1.6, Step 5).
 *
 * It checks the *observable* consequences of T-INV-1..10 against a set of rows,
 * so a test that drives a bracket through completions / no-shows / a cold-wake
 * catch-up tick can assert "and the bracket is still internally consistent"
 * without hand-writing the same 20 expectations each time.
 *
 * It also catches a spurious `tournament_match_winner_conflict` warn (D-3):
 * that log is the alert mechanism for a genuine two-producer winner
 * disagreement, so it must NOT fire on the non-conflict paths (single producer,
 * idempotent replay, cold-wake catch-up). Pass `capturedLogs` (see the
 * `vi.mock('../logger', …)` pattern used elsewhere) to enable that check.
 */

import type { MatchRow, RegistrationRow } from './types';

const isBot = (id: string | null | undefined): boolean =>
  typeof id === 'string' && id.startsWith('bot:fritz:');

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

const TERMINAL: ReadonlyArray<MatchRow['status']> = ['completed', 'bye'];
const PLAYABLE: ReadonlyArray<MatchRow['status']> = ['ready', 'in_progress'];

export type CapturedLog = { event?: unknown; msg?: unknown; [k: string]: unknown };

export type BracketConsistencyInput = {
  tournament: { id: string; status: string; winner_id: string | null };
  matches: MatchRow[];
  registrations: RegistrationRow[];
  /**
   * Warn/log records captured by the test (the `vi.mock('../logger', …)`
   * pattern). When provided, the helper asserts the number of
   * `tournament_match_winner_conflict` entries equals `expectedConflictLogs`.
   */
  capturedLogs?: CapturedLog[];
  /** Expected count of legitimate `tournament_match_winner_conflict` logs. Default 0. */
  expectedConflictLogs?: number;
};

export function collectBracketConsistencyViolations(input: BracketConsistencyInput): string[] {
  const v: string[] = [];
  const { tournament, matches, registrations } = input;
  const tMatches = matches.filter((m) => m.tournament_id === tournament.id);
  const byRoundNumber = new Map<string, MatchRow>();

  // ── shape (T-INV-8) ──────────────────────────────────────────────────────
  if (tMatches.length !== 7) {
    v.push(`expected 7 match rows, found ${tMatches.length}`);
  }
  for (const [round, count] of [[1, 4], [2, 2], [3, 1]] as const) {
    const got = tMatches.filter((m) => m.round === round).length;
    if (got !== count) v.push(`round ${round}: expected ${count} matches, found ${got}`);
  }
  for (const m of tMatches) {
    const key = `${m.round}/${m.match_number}`;
    if (byRoundNumber.has(key)) v.push(`duplicate match at round ${key}`);
    byRoundNumber.set(key, m);
  }

  // ── per-match winner integrity (T-INV-1, T-INV-2) ─────────────────────────
  for (const m of tMatches) {
    const terminal = TERMINAL.includes(m.status);
    if (terminal && m.status === 'completed') {
      if (m.winner_id == null) {
        v.push(`match ${m.round}/${m.match_number} is completed with a null winner_id`);
      } else if (m.winner_id !== m.player1_id && m.winner_id !== m.player2_id) {
        v.push(
          `match ${m.round}/${m.match_number} winner_id ${m.winner_id} is not a participant ` +
            `(${m.player1_id} / ${m.player2_id})`,
        );
      }
      if (m.completed_at == null) {
        v.push(`match ${m.round}/${m.match_number} is completed without a completed_at`);
      }
    }
    if (!terminal && (m.winner_id != null || m.completed_at != null)) {
      v.push(
        `match ${m.round}/${m.match_number} is ${m.status} but carries winner_id/completed_at`,
      );
    }
  }

  // ── advancement (T-INV-5) + feeder gating (T-INV-6) ───────────────────────
  for (const m of tMatches) {
    const tgt = advanceTarget(m.round, m.match_number);
    if (!tgt) continue;
    const feederB = tMatches.find(
      (x) =>
        advanceTarget(x.round, x.match_number)?.nextRound === tgt.nextRound &&
        advanceTarget(x.round, x.match_number)?.nextMatchNumber === tgt.nextMatchNumber &&
        x.id !== m.id,
    );
    const target = byRoundNumber.get(`${tgt.nextRound}/${tgt.nextMatchNumber}`);
    if (!target) {
      v.push(`match ${m.round}/${m.match_number} has no advancement target row`);
      continue;
    }
    const slotVal = tgt.nextSlot === 'player1' ? target.player1_id : target.player2_id;

    if (m.status === 'completed' && m.winner_id != null) {
      if (slotVal !== m.winner_id) {
        v.push(
          `match ${m.round}/${m.match_number} winner ${m.winner_id} is not in ` +
            `${tgt.nextRound}/${tgt.nextMatchNumber}.${tgt.nextSlot} (found ${slotVal})`,
        );
      }
    } else if (!TERMINAL.includes(m.status) && slotVal != null) {
      v.push(
        `${tgt.nextRound}/${tgt.nextMatchNumber}.${tgt.nextSlot} is filled (${slotVal}) but its ` +
          `feeder ${m.round}/${m.match_number} is only ${m.status}`,
      );
    }

    // T-INV-6: target is past `waiting` only if BOTH feeders are terminal.
    if (PLAYABLE.includes(target.status) || target.status === 'completed') {
      const bothFeedersTerminal =
        TERMINAL.includes(m.status) && !!feederB && TERMINAL.includes(feederB.status);
      if (!bothFeedersTerminal) {
        v.push(
          `match ${target.round}/${target.match_number} is ${target.status} but its feeders are ` +
            `not both terminal (${m.round}/${m.match_number}=${m.status}` +
            `${feederB ? `, ${feederB.round}/${feederB.match_number}=${feederB.status}` : ', <missing>'})`,
        );
      }
    }
  }

  // ── one live match per user (T-INV-7) ────────────────────────────────────
  const liveCountByUser = new Map<string, number>();
  for (const m of tMatches) {
    if (!PLAYABLE.includes(m.status)) continue;
    for (const pid of [m.player1_id, m.player2_id]) {
      if (pid == null || isBot(pid)) continue;
      liveCountByUser.set(pid, (liveCountByUser.get(pid) ?? 0) + 1);
    }
  }
  for (const [user, count] of liveCountByUser) {
    if (count > 1) v.push(`user ${user} is in ${count} ready/in_progress matches at once`);
  }

  // ── elimination / placement / champion (T-INV-10) ────────────────────────
  const regByUser = new Map(registrations.map((r) => [r.user_id, r]));
  for (const m of tMatches) {
    if (m.status !== 'completed' || m.winner_id == null) continue;
    const loser =
      m.winner_id === m.player1_id ? m.player2_id : m.winner_id === m.player2_id ? m.player1_id : null;
    if (loser == null || isBot(loser)) continue;
    const reg = regByUser.get(loser);
    if (!reg) {
      v.push(`loser ${loser} of ${m.round}/${m.match_number} has no registration row`);
    } else if (reg.status !== 'eliminated' && reg.status !== 'winner') {
      v.push(
        `loser ${loser} of ${m.round}/${m.match_number} has registration status ${reg.status}, ` +
          `expected eliminated`,
      );
    }
  }

  const final = byRoundNumber.get('3/1');
  const finalDone = final?.status === 'completed' && final.winner_id != null;
  if (finalDone) {
    if (tournament.status !== 'completed') {
      v.push(`final is completed but tournament status is ${tournament.status}`);
    }
    if (tournament.winner_id !== final!.winner_id) {
      v.push(
        `tournament winner_id ${tournament.winner_id} does not match final winner ${final!.winner_id}`,
      );
    }
    if (!isBot(final!.winner_id)) {
      const champReg = regByUser.get(final!.winner_id!);
      if (champReg?.status !== 'winner') {
        v.push(`champion ${final!.winner_id} registration status is ${champReg?.status}, expected winner`);
      }
      if (champReg?.placement !== 1) {
        v.push(`champion ${final!.winner_id} placement is ${champReg?.placement}, expected 1`);
      }
    }
    // Every human who played a completed match has a placement by exit round.
    const exitRoundByUser = new Map<string, number>();
    for (const m of tMatches) {
      if (m.status !== 'completed' || m.winner_id == null) continue;
      const loser =
        m.winner_id === m.player1_id ? m.player2_id : m.winner_id === m.player2_id ? m.player1_id : null;
      if (loser == null || isBot(loser)) continue;
      exitRoundByUser.set(loser, m.round);
    }
    for (const [user, round] of exitRoundByUser) {
      const expected = round === 3 ? 2 : round === 2 ? 3 : 5;
      const got = regByUser.get(user)?.placement;
      if (got !== expected) {
        v.push(`user ${user} lost in round ${round}, placement is ${got}, expected ${expected}`);
      }
    }
  } else {
    if (tournament.status === 'completed') {
      v.push(`tournament status is completed but the final match is ${final?.status ?? '<missing>'}`);
    }
  }

  // ── T-INV-3 / D-3: no spurious winner-conflict logging ───────────────────
  if (input.capturedLogs) {
    const expected = input.expectedConflictLogs ?? 0;
    const conflicts = input.capturedLogs.filter(
      (l) => l.event === 'tournament_match_winner_conflict' || l.msg === 'tournament_match_winner_conflict',
    );
    if (conflicts.length !== expected) {
      v.push(
        `expected ${expected} tournament_match_winner_conflict log(s), found ${conflicts.length}`,
      );
    }
  }

  return v;
}

export function assertBracketConsistent(
  input: BracketConsistencyInput,
  context = 'bracket',
): void {
  const violations = collectBracketConsistencyViolations(input);
  if (violations.length === 0) return;
  throw new Error(
    `[invariant:${context}] ${violations.length} bracket-consistency violation(s):\n` +
      violations.map((s) => `  - ${s}`).join('\n'),
  );
}

/** Convenience: assert against the `{ tournament, matches, regs }` store shape used by the testkit. */
export function assertBracketConsistentForStore(
  store: {
    tournament: { id: string; status: string; winner_id: string | null };
    matches: MatchRow[];
    regs: RegistrationRow[];
  },
  opts?: { capturedLogs?: CapturedLog[]; expectedConflictLogs?: number; context?: string },
): void {
  assertBracketConsistent(
    {
      tournament: store.tournament,
      matches: store.matches,
      registrations: store.regs,
      capturedLogs: opts?.capturedLogs,
      expectedConflictLogs: opts?.expectedConflictLogs,
    },
    opts?.context,
  );
}
