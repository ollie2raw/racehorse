import {
  applyGameCommand,
  canonicalizeDailyFritzAuthorityStateV2,
  type GameState,
} from '@racehorse/game-core';
import {
  DailyFritzVerificationError,
  verifyDailyFritzHand,
  type DailyFritzOfficialStep,
  type VerifiedDailyFritzHandRecord,
} from './dailyFritzVerifier';

/**
 * The official engine steps of ONE verified Daily Fritz hand, with the state before and after each, for the post-game review
 * (docs/daily-fritz-review-design.md, DF-1).
 *
 * It does not re-implement verification. It runs `verifyDailyFritzHand` itself with a read-only observer, so the steps are exactly the
 * commands the verifier applied: the transcript's own actions AND the ones it infers for a degraded client (an omitted mandatory draw,
 * an omitted official Fritz turn), which really happened in the official game. Then it re-applies those commands to the initial state
 * and requires the terminal state to equal the verifier's own, so a replay can never describe a different game than the one verified.
 *
 * Best-effort by design: any failure is a reason, never a throw, and nothing here can change a verdict. A hand that is not
 * verifiable simply has no replay.
 */
export type DailyFritzReplayStep = DailyFritzOfficialStep & {
  readonly before: GameState;
  readonly after: GameState;
};

export type DailyFritzHandReplay =
  | {
      readonly ok: true;
      readonly initialState: GameState;
      readonly terminalState: GameState;
      readonly steps: readonly DailyFritzReplayStep[];
      /** Steps the verifier had to infer (omitted draws, omitted Fritz turns). 0 means the client's transcript was complete. */
      readonly inferredStepCount: number;
      readonly result: VerifiedDailyFritzHandRecord;
    }
  | { readonly ok: false; readonly code: string; readonly message: string };

type VerifyInput = Parameters<typeof verifyDailyFritzHand>[0];

export function replayVerifiedDailyFritzHand(input: Omit<VerifyInput, 'onStep'>): DailyFritzHandReplay {
  const observed: DailyFritzOfficialStep[] = [];
  let verified: ReturnType<typeof verifyDailyFritzHand>;
  try {
    verified = verifyDailyFritzHand({ ...input, onStep: (step) => observed.push(step) });
  } catch (error) {
    if (error instanceof DailyFritzVerificationError) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: 'unexpected', message: error instanceof Error ? error.message : 'Unexpected error.' };
  }

  try {
    const steps: DailyFritzReplayStep[] = [];
    let state = input.initialState;
    for (const step of observed) {
      const after = applyGameCommand(state, step.command).state;
      steps.push({ ...step, before: state, after });
      state = after;
    }
    if (canonicalizeDailyFritzAuthorityStateV2(state) !== canonicalizeDailyFritzAuthorityStateV2(verified.terminalState)) {
      return { ok: false, code: 'replay_diverged', message: 'The replayed steps do not end in the verified terminal state.' };
    }
    return {
      ok: true,
      initialState: input.initialState,
      terminalState: verified.terminalState,
      steps,
      inferredStepCount: observed.filter((step) => step.origin !== 'transcript').length,
      result: verified.result,
    };
  } catch (error) {
    return { ok: false, code: 'replay_failed', message: error instanceof Error ? error.message : 'Replay failed.' };
  }
}
