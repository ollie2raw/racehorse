import type { Room } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import type { GameActionAck } from './gameActionIdempotency';
import {
  buildLiveSessionRow,
  cancelScheduledLiveRoomPersistence,
  type LiveRosterEntry,
} from './roomLivePersistence';
import {
  captureRoomDurabilityFence,
  markRoomDurabilityPersistFailure,
  markRoomDurabilityPersistSuccess,
} from './roomDurability';

type CommandRpcRow = {
  outcome: 'ready' | 'committed' | 'rejected';
  error_code: string | null;
  replayed: boolean;
  authority_revision: number | null;
  response: Record<string, unknown> | null;
};

export type LiveRoomCommandPreflight =
  | { kind: 'ready'; authorityRevision: number }
  | { kind: 'replay'; ack: GameActionAck; authorityRevision: number }
  | { kind: 'rejected'; ack: GameActionAck; authorityRevision: number | null };

export type LiveRoomCommandCommit =
  | { kind: 'committed'; ack: GameActionAck; authorityRevision: number; replayed: boolean }
  | { kind: 'rejected'; ack: GameActionAck; authorityRevision: number | null };

function firstRpcRow(rows: CommandRpcRow[] | undefined, operation: string): CommandRpcRow {
  const row = rows?.[0];
  if (!row) throw new Error(`${operation}_empty_response`);
  return row;
}

function responseToAck(row: CommandRpcRow): GameActionAck {
  const response = row.response ?? {};
  const sequence = typeof response.sequence === 'number' ? response.sequence : null;
  const forcedDraw = response.forcedDraw;
  return {
    ok: response.ok === true && row.outcome === 'committed',
    sequence,
    ...(forcedDraw && typeof forcedDraw === 'object'
      ? { forcedDraw: forcedDraw as GameActionAck['forcedDraw'] }
      : {}),
    ...(typeof response.error === 'string'
      ? { error: response.error }
      : row.error_code
        ? { error: row.error_code }
        : {}),
    ...(row.replayed ? { duplicate: true } : {}),
  };
}

export function isTransactionalMultiplayerCommandsEnabled(): boolean {
  return String(process.env.MULTIPLAYER_TRANSACTIONAL_COMMANDS ?? '').trim().toLowerCase() === 'true';
}

/**
 * Read/replay gate before mutating memory. The atomic commit still performs
 * the same checks under its own row lock; this preflight exists so process
 * restarts can replay a durable receipt without executing the action again.
 */
export async function prepareLiveRoomGameplayCommand(params: {
  room: Room;
  actorSeatId: string;
  requestId: string;
  requestDigest: string;
}): Promise<LiveRoomCommandPreflight> {
  const rows = await supabaseFetch<CommandRpcRow[]>(
    '/rest/v1/rpc/assert_room_live_session_revision',
    {
      method: 'POST',
      body: JSON.stringify({
        p_room_code: params.room.code,
        p_expected_revision: params.room.authorityRevision,
        p_actor_seat_id: params.actorSeatId,
        p_request_id: params.requestId,
        p_request_digest: params.requestDigest,
      }),
    },
  );
  const row = firstRpcRow(rows, 'multiplayer_command_preflight');
  const revision = row.authority_revision ?? params.room.authorityRevision;
  if (row.outcome === 'ready') {
    return { kind: 'ready', authorityRevision: revision };
  }
  const ack = responseToAck(row);
  if (row.replayed && row.outcome === 'committed') {
    return { kind: 'replay', ack, authorityRevision: revision };
  }
  return { kind: 'rejected', ack, authorityRevision: row.authority_revision };
}

/** Atomically commits the full private snapshot and replayable command ack. */
export async function commitLiveRoomGameplayCommand(params: {
  room: Room;
  roster: LiveRosterEntry[];
  actorSeatId: string;
  requestId: string;
  requestDigest: string;
  expectedAuthorityRevision: number;
  ack: GameActionAck;
}): Promise<LiveRoomCommandCommit> {
  const { room } = params;
  cancelScheduledLiveRoomPersistence(room.code);
  const commitFence = captureRoomDurabilityFence(room, room.durability.targetFence.commitId);
  const snapshot = buildLiveSessionRow(room, params.roster, commitFence);

  try {
    const rows = await supabaseFetch<CommandRpcRow[]>(
      '/rest/v1/rpc/commit_room_live_session_command',
      {
        method: 'POST',
        body: JSON.stringify({
          p_room_code: room.code,
          p_actor_seat_id: params.actorSeatId,
          p_request_id: params.requestId,
          p_request_digest: params.requestDigest,
          p_expected_revision: params.expectedAuthorityRevision,
          p_snapshot: snapshot,
          p_response: params.ack,
        }),
      },
    );
    const row = firstRpcRow(rows, 'multiplayer_command_commit');
    const revision = row.authority_revision;
    if (row.outcome !== 'committed' || revision === null || row.replayed) {
      markRoomDurabilityPersistFailure(
        room,
        {
          status: 'degraded',
          error: row.replayed
            ? 'room_command_commit_raced'
            : row.error_code ?? 'room_command_commit_rejected',
        },
        commitFence,
      );
      return {
        kind: 'rejected',
        ack: {
          ...responseToAck(row),
          ok: false,
          error: row.replayed ? 'room_command_commit_raced' : row.error_code ?? undefined,
          uncertain: true,
        },
        authorityRevision: revision,
      };
    }
    room.authorityRevision = revision;
    if (!markRoomDurabilityPersistSuccess(room, commitFence)) {
      markRoomDurabilityPersistFailure(
        room,
        { status: 'degraded', error: 'room_command_commit_fence_changed' },
      );
      return {
        kind: 'rejected',
        ack: { ok: false, error: 'room_snapshot_uncommitted', uncertain: true },
        authorityRevision: revision,
      };
    }
    return {
      kind: 'committed',
      ack: responseToAck(row),
      authorityRevision: revision,
      replayed: row.replayed,
    };
  } catch (error) {
    markRoomDurabilityPersistFailure(
      room,
      {
        status: 'degraded',
        error: error instanceof Error ? error.message : String(error),
      },
      commitFence,
    );
    throw error;
  }
}
