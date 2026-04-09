import { randomUUID } from 'crypto';
import type { GameState } from './game/types';

export type RoomMatchEventType =
  | 'room_created'
  | 'player_joined'
  | 'player_left'
  | 'player_reconnected'
  | 'spectator_joined'
  | 'match_started'
  | 'hand_started'
  | 'draw_requested'
  | 'tile_drawn'
  | 'tile_played'
  | 'turn_passed'
  | 'hand_ready'
  | 'hand_ended'
  | 'match_ended'
  | 'rematch_requested'
  | 'rematch_started';

export type RoomMatchEvent = {
  id: string;
  version: 1;
  matchId: string;
  roomCode: string;
  sequence: number;
  type: RoomMatchEventType;
  timestamp: string;
  handNumber: number | null;
  stateSequence: number | null;
  actorSocketId: string | null;
  actorUserId: string | null;
  payload: Record<string, unknown>;
};

export type RoomEventMeta = {
  version: 1;
  matchId: string;
  lastEventSequence: number;
  eventCount: number;
};

type EventState = Pick<GameState, 'handNumber' | 'sequence'> | null;

type EventfulRoomLike = {
  code: string;
  state: EventState;
  matchId: string;
  eventLogVersion: 1;
  eventSequence: number;
  events: RoomMatchEvent[];
};

export function createRoomEventState() {
  return {
    matchId: randomUUID(),
    eventLogVersion: 1 as const,
    eventSequence: 0,
    events: [] as RoomMatchEvent[],
  };
}

export function resetRoomEventLog(room: EventfulRoomLike): void {
  room.matchId = randomUUID();
  room.eventSequence = 0;
  room.events = [];
}

export function appendRoomEvent(
  room: EventfulRoomLike,
  params: {
    type: RoomMatchEventType;
    actorSocketId?: string | null;
    actorUserId?: string | null;
    payload?: Record<string, unknown>;
  },
): RoomMatchEvent {
  room.eventSequence += 1;
  const event: RoomMatchEvent = {
    id: `${room.matchId}:${room.eventSequence}`,
    version: room.eventLogVersion,
    matchId: room.matchId,
    roomCode: room.code,
    sequence: room.eventSequence,
    type: params.type,
    timestamp: new Date().toISOString(),
    handNumber: room.state?.handNumber ?? null,
    stateSequence: room.state?.sequence ?? null,
    actorSocketId: params.actorSocketId ?? null,
    actorUserId: params.actorUserId ?? null,
    payload: params.payload ?? {},
  };
  room.events.push(event);
  return event;
}

export function getRoomEventMeta(room: EventfulRoomLike): RoomEventMeta {
  return {
    version: room.eventLogVersion,
    matchId: room.matchId,
    lastEventSequence: room.eventSequence,
    eventCount: room.events.length,
  };
}

export function getRoomEventSnapshot(room: EventfulRoomLike) {
  return {
    ...getRoomEventMeta(room),
    roomCode: room.code,
    events: [...room.events],
  };
}
