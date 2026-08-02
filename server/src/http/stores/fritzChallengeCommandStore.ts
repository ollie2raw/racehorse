import { createHash } from 'crypto';
import { canonicalizeDailyFritzChallenge } from '../../dailyFritzPublishedChallenge';
import { supabaseFetch } from '../../supabaseUtils';

export type FritzChallengeCommandType =
  | 'accept_verified_hand'
  | 'record_verified_game'
  | 'finalize_verified_attempt';

export type FritzChallengeCommandResult<T extends Record<string, unknown>> = {
  outcome: 'committed' | 'rejected' | 'conflict';
  errorCode: string | null;
  replayed: boolean;
  committedRevision: number | null;
  response: T | null;
};

type CommandRow<T extends Record<string, unknown>> = {
  outcome: FritzChallengeCommandResult<T>['outcome'];
  error_code: string | null;
  replayed: boolean;
  committed_revision: number | null;
  response: T | null;
};

export type FritzChallengeCommandStoreDeps = { fetch: typeof supabaseFetch };
const DEFAULT_DEPS: FritzChallengeCommandStoreDeps = { fetch: supabaseFetch };

export function digestFritzChallengeCommand(value: unknown): string {
  return createHash('sha256').update(canonicalizeDailyFritzChallenge(value)).digest('hex');
}

function result<T extends Record<string, unknown>>(rows: CommandRow<T>[] | undefined): FritzChallengeCommandResult<T> {
  const row = rows?.[0];
  if (!row) throw new Error('Fritz Challenge command did not return a durable outcome.');
  return {
    outcome: row.outcome,
    errorCode: row.error_code,
    replayed: row.replayed,
    committedRevision: row.committed_revision == null ? null : Number(row.committed_revision),
    response: row.response,
  };
}

export async function commitFritzChallengeAttemptCommand<T extends Record<string, unknown>>(
  input: {
    userId: string;
    attemptId: string;
    operationId: string;
    commandType: FritzChallengeCommandType;
    expectedRevision: number;
    next: {
      status: 'started' | 'completed';
      currentGameNumber: 1 | 2 | 3;
      currentHandIndex: number;
      result: Record<string, unknown>;
      finalScore?: number | null;
      opponentScore?: number | null;
      pointDiff?: number | null;
      won?: boolean | null;
      movesUsed?: number | null;
      handsPlayed?: number | null;
    };
    handReceipt?: Record<string, unknown> | null;
    gameReceipt?: Record<string, unknown> | null;
    outbox: { eventType: string; payload: Record<string, unknown> };
  },
  deps: FritzChallengeCommandStoreDeps = DEFAULT_DEPS,
): Promise<FritzChallengeCommandResult<T>> {
  const requestDigest = digestFritzChallengeCommand({
    commandType: input.commandType,
    attemptId: input.attemptId,
    expectedRevision: input.expectedRevision,
    next: input.next,
    handReceipt: input.handReceipt ?? null,
    gameReceipt: input.gameReceipt ?? null,
  });
  const rows = await deps.fetch<CommandRow<T>[]>(
    '/rest/v1/rpc/commit_fritz_challenge_attempt_command',
    {
      method: 'POST',
      body: JSON.stringify({
        p_user_id: input.userId,
        p_attempt_id: input.attemptId,
        p_operation_id: input.operationId,
        p_command_type: input.commandType,
        p_request_digest: requestDigest,
        p_expected_revision: input.expectedRevision,
        p_new_status: input.next.status,
        p_new_current_game_number: input.next.currentGameNumber,
        p_new_current_hand_index: input.next.currentHandIndex,
        p_new_result: input.next.result,
        p_final_score: input.next.finalScore ?? null,
        p_opponent_score: input.next.opponentScore ?? null,
        p_point_diff: input.next.pointDiff ?? null,
        p_won: input.next.won ?? null,
        p_moves_used: input.next.movesUsed ?? null,
        p_hands_played: input.next.handsPlayed ?? null,
        p_hand_receipt: input.handReceipt ?? null,
        p_game_receipt: input.gameReceipt ?? null,
        p_outbox_event_type: input.outbox.eventType,
        p_outbox_payload: input.outbox.payload,
      }),
    },
  );
  return result(rows);
}
