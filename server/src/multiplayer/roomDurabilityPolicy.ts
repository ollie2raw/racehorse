import type { Room } from '../rooms';
import type { RoomDurabilityStatus } from './roomDurability';

export type RoomDurabilityOperation =
  | 'join_new_player'
  | 'reconnect_existing_player'
  | 'gameplay_action'
  | 'match_start'
  | 'new_hand'
  | 'rematch';

export type RoomDurabilityAttachSource = 'already_in_memory' | 'hydrated' | 'shell_only';

export type RoomDurabilityDecisionError =
  | 'room_degraded'
  | 'room_persistence_failed'
  | 'reconnect_unavailable'
  | 'match_start_blocked'
  | 'new_hand_blocked'
  | 'rematch_blocked';

export type RoomDurabilityOperationContext = {
  attachSource?: RoomDurabilityAttachSource;
};

export type RoomDurabilityOperationDecision =
  | {
      allowed: true;
      status: RoomDurabilityStatus;
      operation: RoomDurabilityOperation;
    }
  | {
      allowed: false;
      status: RoomDurabilityStatus;
      operation: RoomDurabilityOperation;
      error: RoomDurabilityDecisionError;
      reason: string;
    };

type DurabilityOperationPolicy = {
  defaultDecision:
    | { allowed: true }
    | {
        allowed: false;
        error: RoomDurabilityDecisionError;
        reason: string;
      };
  decide?: (
    room: Room,
    context: RoomDurabilityOperationContext,
  ) => RoomDurabilityOperationDecision;
};

const HEALTHY_RUNTIME_POLICY: Record<RoomDurabilityOperation, DurabilityOperationPolicy> = {
  join_new_player: { defaultDecision: { allowed: true } },
  reconnect_existing_player: { defaultDecision: { allowed: true } },
  gameplay_action: { defaultDecision: { allowed: true } },
  match_start: { defaultDecision: { allowed: true } },
  new_hand: { defaultDecision: { allowed: true } },
  rematch: { defaultDecision: { allowed: true } },
};

const DEGRADED_RUNTIME_POLICY: Record<RoomDurabilityOperation, DurabilityOperationPolicy> = {
  join_new_player: {
    defaultDecision: {
      allowed: false,
      error: 'room_degraded',
      reason: 'Room persistence is degraded; new joins are blocked.',
    },
  },
  reconnect_existing_player: {
    defaultDecision: {
      allowed: false,
      error: 'reconnect_unavailable',
      reason: 'Reconnect requires in-memory authority while room persistence is degraded.',
    },
    decide: (_room, context) =>
      context.attachSource === 'already_in_memory'
        ? {
            allowed: true,
            status: 'degraded',
            operation: 'reconnect_existing_player',
          }
        : {
            allowed: false,
            status: 'degraded',
            operation: 'reconnect_existing_player',
            error: 'reconnect_unavailable',
            reason: 'Reconnect requires in-memory authority while room persistence is degraded.',
          },
  },
  gameplay_action: { defaultDecision: { allowed: true } },
  match_start: {
    defaultDecision: {
      allowed: false,
      error: 'match_start_blocked',
      reason: 'Match start is blocked while room persistence is degraded.',
    },
  },
  new_hand: {
    defaultDecision: {
      allowed: false,
      error: 'new_hand_blocked',
      reason: 'New hand transition is blocked while room persistence is degraded.',
    },
  },
  rematch: {
    defaultDecision: {
      allowed: false,
      error: 'rematch_blocked',
      reason: 'Rematch is blocked while room persistence is degraded.',
    },
  },
};

const FAILED_RUNTIME_POLICY: Record<RoomDurabilityOperation, DurabilityOperationPolicy> = {
  join_new_player: {
    defaultDecision: {
      allowed: false,
      error: 'room_persistence_failed',
      reason: 'Room persistence has failed; joining is unavailable.',
    },
  },
  reconnect_existing_player: {
    defaultDecision: {
      allowed: false,
      error: 'reconnect_unavailable',
      reason: 'Reconnect is unavailable after room persistence failure.',
    },
  },
  gameplay_action: {
    defaultDecision: {
      allowed: false,
      error: 'room_persistence_failed',
      reason: 'Gameplay is paused after room persistence failure.',
    },
  },
  match_start: {
    defaultDecision: {
      allowed: false,
      error: 'match_start_blocked',
      reason: 'Match start is blocked after room persistence failure.',
    },
  },
  new_hand: {
    defaultDecision: {
      allowed: false,
      error: 'new_hand_blocked',
      reason: 'New hand transition is blocked after room persistence failure.',
    },
  },
  rematch: {
    defaultDecision: {
      allowed: false,
      error: 'rematch_blocked',
      reason: 'Rematch is blocked after room persistence failure.',
    },
  },
};

export const ROOM_DURABILITY_RUNTIME_POLICY: Record<
  RoomDurabilityStatus,
  Record<RoomDurabilityOperation, DurabilityOperationPolicy>
> = {
  healthy: HEALTHY_RUNTIME_POLICY,
  pending: HEALTHY_RUNTIME_POLICY,
  degraded: DEGRADED_RUNTIME_POLICY,
  failed: FAILED_RUNTIME_POLICY,
};

export function evaluateRoomDurabilityOperation(
  room: Room,
  operation: RoomDurabilityOperation,
  context: RoomDurabilityOperationContext = {},
): RoomDurabilityOperationDecision {
  const status = room.durability.status;
  const policy = ROOM_DURABILITY_RUNTIME_POLICY[status][operation];
  if (policy.decide) {
    return policy.decide(room, context);
  }
  if (policy.defaultDecision.allowed) {
    return { allowed: true, status, operation };
  }
  return {
    allowed: false,
    status,
    operation,
    error: policy.defaultDecision.error,
    reason: policy.defaultDecision.reason,
  };
}

export function assertRoomDurabilityOperationAllowed(
  room: Room,
  operation: RoomDurabilityOperation,
  context: RoomDurabilityOperationContext = {},
): void {
  const decision = evaluateRoomDurabilityOperation(room, operation, context);
  if (!decision.allowed) {
    throw new Error(decision.error);
  }
}
