import type { NormalizedSocketRouter } from './socketEventBus';

/**
 * Canonical socket event ownership registry for the Racehorse multiplayer client.
 * Single source of truth: event name, normalized routing, owner, registrar, bounded context.
 */

export type SocketBoundedContext =
  | 'infrastructure'
  | 'transport'
  | 'connection'
  | 'recovery'
  | 'session'
  | 'room-sync'
  | 'projection'
  | 'gameplay'
  | 'social'
  | 'tournament'
  | 'matchmaking'
  | 'friends';

export type SocketRegistrationKind =
  | 'raw'
  | 'normalized'
  | 'bus-ingress'
  | 'lifecycle-infrastructure'
  | 'direct'
  | 'internal-dispatch';

export type SocketEventRegistryEntry = {
  /** Wire protocol event name when applicable. */
  socketEvent: string;
  /** Internal normalized event type when routed through socketEventBus. */
  normalizedEvent?:
    | 'ROOM_JOIN_OK'
    | 'STATE_UPDATE'
    | 'RESYNC_NEEDED'
    | 'TRANSPORT_FAIL'
    | 'ROOM_JOIN_TERMINAL';
  /** Normalized router handler key when registrationKind is `normalized`. */
  normalizedRouterKey?: keyof NormalizedSocketRouter;
  /** Bounded context / architectural owner label. */
  owner: string;
  /** Source file that must perform registration (relative to client/src). */
  registrar: string;
  boundedContext: SocketBoundedContext;
  registrationKind: SocketRegistrationKind;
  /** When true, CI fails if registration is missing or owned elsewhere. */
  enforced: boolean;
  /** Supplementary registrar files allowed to register the same raw/normalized event. */
  additionalRegistrars?: readonly string[];
  description: string;
};

/** Approved files that may call registerRawSocketEventHandler / registerNormalizedSocketRouter. */
export const APPROVED_SOCKET_REGISTRAR_FILES = [
  'App.tsx',
  'multiplayer/registerMultiplayerConnectionSocketHandlers.ts',
  'multiplayer/registerMultiplayerConnectionGameplaySocketHandlers.ts',
  'multiplayer/useRoomSocketSync.ts',
  'multiplayer/useFriendSocketReachability.ts',
  'multiplayer/useFriendChallenge.ts',
  'tournament/registerTournamentSocketHandlers.ts',
  'matchmaking/registerMatchmakingSocketHandlers.ts',
  'friends/registerFriendsSocketHandlers.ts',
  'live/LiveNowScreen.tsx',
  'dailyFritz/DailyFritzBroadcastControl.tsx',
] as const;

/**
 * Grandfathered direct socket.on sites outside the event bus.
 * Phase S: zero tolerance — CI fails if this list is non-empty or a new direct socket.on appears.
 */
export const GRANDFATHERED_DIRECT_SOCKET_ON: ReadonlyArray<{
  file: string;
  socketEvent: string;
  owner: string;
  boundedContext: SocketBoundedContext;
  reason: string;
}> = [];

/**
 * Canonical event catalog. Every enforced entry must appear exactly once in its declared registrar.
 */
export const SOCKET_EVENT_REGISTRY: readonly SocketEventRegistryEntry[] = [
  { socketEvent:'spectator:session_added',owner:'spectator.discovery',registrar:'live/LiveNowScreen.tsx',boundedContext:'social',registrationKind:'raw',enforced:true,description:'Live session discovery added' },
  { socketEvent:'spectator:session_updated',owner:'spectator.discovery',registrar:'live/LiveNowScreen.tsx',boundedContext:'social',registrationKind:'raw',enforced:true,description:'Live session discovery updated' },
  { socketEvent:'spectator:session_removed',owner:'spectator.discovery',registrar:'live/LiveNowScreen.tsx',boundedContext:'social',registrationKind:'raw',enforced:true,description:'Live session discovery removed' },
  { socketEvent:'spectator:update',owner:'spectator.viewer',registrar:'live/LiveNowScreen.tsx',boundedContext:'social',registrationKind:'raw',enforced:true,description:'Sanitized spectator snapshot update' },
  { socketEvent:'spectator:ended',owner:'spectator.viewer',registrar:'live/LiveNowScreen.tsx',boundedContext:'social',registrationKind:'raw',enforced:true,description:'Spectator source ended' },
  { socketEvent:'spectator:count',owner:'spectator.viewer',registrar:'live/LiveNowScreen.tsx',additionalRegistrars:['dailyFritz/DailyFritzBroadcastControl.tsx'],boundedContext:'social',registrationKind:'raw',enforced:true,description:'Server authoritative spectator count' },
  {
    socketEvent: 'state:update',
    normalizedEvent: 'STATE_UPDATE',
    normalizedRouterKey: 'stateUpdate',
    owner: 'room-sync.projection',
    registrar: 'multiplayer/useRoomSocketSync.ts',
    boundedContext: 'projection',
    registrationKind: 'bus-ingress',
    enforced: true,
    description: 'Authoritative gameplay snapshot — normalized at socketEventBus ingress',
  },
  {
    socketEvent: 'state:update',
    normalizedEvent: 'STATE_UPDATE',
    normalizedRouterKey: 'stateUpdate',
    owner: 'room-sync.projection',
    registrar: 'multiplayer/useRoomSocketSync.ts',
    boundedContext: 'projection',
    registrationKind: 'normalized',
    enforced: true,
    description: 'STATE_UPDATE normalized router handler',
  },
  {
    socketEvent: 'room:join_ok',
    normalizedEvent: 'ROOM_JOIN_OK',
    normalizedRouterKey: 'roomJoinOk',
    owner: 'session.joinAck',
    registrar: 'App.tsx',
    boundedContext: 'session',
    registrationKind: 'normalized',
    enforced: true,
    description: 'ROOM_JOIN_OK normalized router — join ack coordinator',
  },
  {
    socketEvent: 'resync_needed',
    normalizedEvent: 'RESYNC_NEEDED',
    normalizedRouterKey: 'resyncNeeded',
    owner: 'recovery.machine',
    registrar: 'multiplayer/registerMultiplayerConnectionSocketHandlers.ts',
    boundedContext: 'recovery',
    registrationKind: 'normalized',
    enforced: true,
    description: 'RESYNC_NEEDED normalized router — recovery dispatch',
  },
  {
    socketEvent: 'transport_fail',
    normalizedEvent: 'TRANSPORT_FAIL',
    normalizedRouterKey: 'transportFail',
    owner: 'recovery.machine',
    registrar: 'multiplayer/registerMultiplayerConnectionSocketHandlers.ts',
    boundedContext: 'recovery',
    registrationKind: 'normalized',
    enforced: true,
    description: 'TRANSPORT_FAIL normalized router — recovery dispatch',
  },
  {
    socketEvent: 'room_join_terminal',
    normalizedEvent: 'ROOM_JOIN_TERMINAL',
    normalizedRouterKey: 'roomJoinTerminal',
    owner: 'recovery.machine',
    registrar: 'multiplayer/registerMultiplayerConnectionSocketHandlers.ts',
    boundedContext: 'recovery',
    registrationKind: 'normalized',
    enforced: true,
    description: 'ROOM_JOIN_TERMINAL normalized router — terminal join handling',
  },
  {
    socketEvent: 'connect',
    owner: 'connection.transport',
    registrar: 'multiplayer/registerMultiplayerConnectionSocketHandlers.ts',
    additionalRegistrars: [
      'multiplayer/useFriendSocketReachability.ts',
      'tournament/registerTournamentSocketHandlers.ts',
      'matchmaking/registerMatchmakingSocketHandlers.ts',
      'friends/registerFriendsSocketHandlers.ts',
      'live/LiveNowScreen.tsx',
    ],
    boundedContext: 'connection',
    registrationKind: 'raw',
    enforced: true,
    description: 'Socket connect — presence identify and recovery SOCKET_CONNECTED',
  },
  {
    socketEvent: 'disconnect',
    owner: 'connection.transport',
    registrar: 'multiplayer/registerMultiplayerConnectionSocketHandlers.ts',
    additionalRegistrars: [
      'multiplayer/useFriendSocketReachability.ts',
      'matchmaking/registerMatchmakingSocketHandlers.ts',
      'live/LiveNowScreen.tsx',
    ],
    boundedContext: 'connection',
    registrationKind: 'raw',
    enforced: true,
    description: 'Socket disconnect — session teardown and recoverable TRANSPORT_FAIL',
  },
  {
    socketEvent: 'queue:online',
    owner: 'matchmaking.queue',
    registrar: 'matchmaking/registerMatchmakingSocketHandlers.ts',
    boundedContext: 'matchmaking',
    registrationKind: 'raw',
    enforced: true,
    description: 'Global online + queue depth — fan-out to matchmaking and queue-count delegates',
  },
  {
    socketEvent: 'queue:matched',
    owner: 'matchmaking.queue',
    registrar: 'matchmaking/registerMatchmakingSocketHandlers.ts',
    boundedContext: 'matchmaking',
    registrationKind: 'raw',
    enforced: true,
    description: 'Queue match found — matchmaking delegate only',
  },
  {
    socketEvent: 'queue:timeout',
    owner: 'matchmaking.queue',
    registrar: 'matchmaking/registerMatchmakingSocketHandlers.ts',
    boundedContext: 'matchmaking',
    registrationKind: 'raw',
    enforced: true,
    description: 'Queue search timeout — matchmaking delegate only',
  },
  {
    socketEvent: 'connect_error',
    owner: 'connection.transport',
    registrar: 'multiplayer/registerMultiplayerConnectionSocketHandlers.ts',
    boundedContext: 'connection',
    registrationKind: 'raw',
    enforced: true,
    description: 'Socket connect_error — server waking UI and recovery TRANSPORT_FAIL',
  },
  {
    socketEvent: 'reconnect_failed',
    owner: 'connection.transport',
    registrar: 'multiplayer/registerMultiplayerConnectionSocketHandlers.ts',
    boundedContext: 'connection',
    registrationKind: 'raw',
    enforced: true,
    description: 'Socket reconnect_failed — recovery TRANSPORT_FAIL',
  },
  {
    socketEvent: 'server:shutdown',
    owner: 'connection.transport',
    registrar: 'multiplayer/registerMultiplayerConnectionSocketHandlers.ts',
    boundedContext: 'connection',
    registrationKind: 'raw',
    enforced: true,
    description: 'Server maintenance notice toast',
  },
  {
    socketEvent: 'tournament:match:assigned',
    owner: 'connection.tournament',
    registrar: 'multiplayer/registerMultiplayerConnectionSocketHandlers.ts',
    boundedContext: 'tournament',
    registrationKind: 'raw',
    enforced: true,
    description: 'Tournament match room assignment during live connection',
  },
  {
    socketEvent: 'room:chat',
    owner: 'social.reactions',
    registrar: 'multiplayer/registerMultiplayerConnectionSocketHandlers.ts',
    boundedContext: 'social',
    registrationKind: 'raw',
    enforced: true,
    description: 'In-room chat reactions feed',
  },
  {
    socketEvent: 'room:emote',
    owner: 'social.reactions',
    registrar: 'multiplayer/registerMultiplayerConnectionSocketHandlers.ts',
    boundedContext: 'social',
    registrationKind: 'raw',
    enforced: true,
    description: 'In-room emote reactions feed',
  },
  {
    socketEvent: 'room:session:superseded',
    owner: 'session.superseded',
    registrar: 'multiplayer/registerMultiplayerConnectionSocketHandlers.ts',
    boundedContext: 'session',
    registrationKind: 'raw',
    enforced: true,
    description: 'Session superseded — recovery SESSION_SUPERSEDED',
  },
  {
    socketEvent: 'hand:ended',
    owner: 'gameplay.handReveal',
    registrar: 'multiplayer/registerMultiplayerConnectionGameplaySocketHandlers.ts',
    boundedContext: 'gameplay',
    registrationKind: 'raw',
    enforced: true,
    description: 'Hand reveal overlay and hand-end sounds',
  },
  {
    socketEvent: 'game:rematch:status',
    owner: 'gameplay.rematch',
    registrar: 'multiplayer/registerMultiplayerConnectionGameplaySocketHandlers.ts',
    boundedContext: 'gameplay',
    registrationKind: 'raw',
    enforced: true,
    description: 'Rematch ready roster UI',
  },
  {
    socketEvent: 'game:rematch:started',
    owner: 'gameplay.rematch',
    registrar: 'multiplayer/registerMultiplayerConnectionGameplaySocketHandlers.ts',
    boundedContext: 'gameplay',
    registrationKind: 'raw',
    enforced: true,
    description: 'Rematch started — reset hand reveal and await fresh state',
  },
  {
    socketEvent: 'player:dragging',
    owner: 'gameplay.presentation',
    registrar: 'multiplayer/registerMultiplayerConnectionGameplaySocketHandlers.ts',
    boundedContext: 'gameplay',
    registrationKind: 'raw',
    enforced: true,
    description: 'Opponent tile drag affordance',
  },
  {
    socketEvent: 'friend:invite:error',
    owner: 'social.invite',
    registrar: 'multiplayer/useRoomSocketSync.ts',
    boundedContext: 'social',
    registrationKind: 'raw',
    enforced: true,
    description: 'Friend invite failure toast',
  },
  {
    socketEvent: 'room:update',
    owner: 'room-sync.roster',
    registrar: 'multiplayer/useRoomSocketSync.ts',
    boundedContext: 'room-sync',
    registrationKind: 'raw',
    enforced: true,
    description: 'Lobby roster updates and player-ready scheduling',
  },
  {
    socketEvent: 'room:request_ready',
    owner: 'session.ready',
    registrar: 'multiplayer/useRoomSocketSync.ts',
    boundedContext: 'session',
    registrationKind: 'raw',
    enforced: true,
    description: 'Server-driven ready signal for matchmaking rooms',
  },
  {
    socketEvent: 'state:spectate',
    owner: 'projection.spectate',
    registrar: 'multiplayer/useRoomSocketSync.ts',
    boundedContext: 'projection',
    registrationKind: 'raw',
    enforced: true,
    description: 'Spectator snapshot projection path',
  },
  {
    socketEvent: 'game:draw_animation',
    owner: 'gameplay.drawPresentation',
    registrar: 'multiplayer/useRoomSocketSync.ts',
    boundedContext: 'gameplay',
    registrationKind: 'raw',
    enforced: true,
    description: 'Forced-draw animation presentation (timers, flying tiles)',
  },
  {
    socketEvent: 'player:disconnected',
    owner: 'connection.presence',
    registrar: 'multiplayer/useRoomSocketSync.ts',
    boundedContext: 'connection',
    registrationKind: 'raw',
    enforced: true,
    description: 'Opponent disconnect grace UI',
  },
  {
    socketEvent: 'player:reconnected',
    owner: 'connection.presence',
    registrar: 'multiplayer/useRoomSocketSync.ts',
    boundedContext: 'connection',
    registrationKind: 'raw',
    enforced: true,
    description: 'Opponent reconnected — clear disconnect UI',
  },
  {
    socketEvent: 'player:reconnect_timeout',
    owner: 'connection.presence',
    registrar: 'multiplayer/useRoomSocketSync.ts',
    boundedContext: 'connection',
    registrationKind: 'raw',
    enforced: true,
    description: 'Opponent reconnect grace expired message',
  },
  {
    socketEvent: 'room:match_abandoned',
    owner: 'tournament.session.abandoned',
    registrar: 'tournament/registerTournamentSocketHandlers.ts',
    boundedContext: 'tournament',
    registrationKind: 'raw',
    enforced: true,
    description: 'Opponent abandoned match — navigation and forfeit notice via session delegates',
  },
  {
    socketEvent: 'tournament:registration_open',
    owner: 'tournament.hub',
    registrar: 'tournament/registerTournamentSocketHandlers.ts',
    boundedContext: 'tournament',
    registrationKind: 'raw',
    enforced: true,
    description: 'Tournament registration window opened — hub refresh',
  },
  {
    socketEvent: 'tournament:registration_updated',
    owner: 'tournament.hub',
    registrar: 'tournament/registerTournamentSocketHandlers.ts',
    boundedContext: 'tournament',
    registrationKind: 'raw',
    enforced: true,
    description: 'Tournament registration roster changed — hub refresh and bracket fetch',
  },
  {
    socketEvent: 'tournament:bracket_generated',
    owner: 'tournament.hub',
    registrar: 'tournament/registerTournamentSocketHandlers.ts',
    boundedContext: 'tournament',
    registrationKind: 'raw',
    enforced: true,
    description: 'Tournament bracket published — hub bracket fetch',
  },
  {
    socketEvent: 'tournament:match_updated',
    owner: 'tournament.hub',
    registrar: 'tournament/registerTournamentSocketHandlers.ts',
    boundedContext: 'tournament',
    registrationKind: 'raw',
    enforced: true,
    description: 'Tournament match row updated — hub bracket fetch',
  },
  {
    socketEvent: 'tournament:match_ready',
    owner: 'tournament.hub',
    registrar: 'tournament/registerTournamentSocketHandlers.ts',
    boundedContext: 'tournament',
    registrationKind: 'raw',
    enforced: true,
    description: 'Tournament match ready — pending match overlay state',
  },
  {
    socketEvent: 'tournament:match_completed',
    owner: 'tournament.hub',
    registrar: 'tournament/registerTournamentSocketHandlers.ts',
    boundedContext: 'tournament',
    registrationKind: 'raw',
    enforced: true,
    description: 'Tournament match completed — hub + live session finalize delegates',
  },
  {
    socketEvent: 'tournament:completed',
    owner: 'tournament.hub',
    registrar: 'tournament/registerTournamentSocketHandlers.ts',
    boundedContext: 'tournament',
    registrationKind: 'raw',
    enforced: true,
    description: 'Tournament completed — hub + live session result navigation delegates',
  },
  {
    socketEvent: 'friend:invite:declined',
    owner: 'social.challenge',
    registrar: 'App.tsx',
    additionalRegistrars: ['multiplayer/useFriendChallenge.ts'],
    boundedContext: 'social',
    registrationKind: 'raw',
    enforced: true,
    description: 'Friend challenge declined — App shell + challenge hook handlers',
  },
  {
    socketEvent: 'friend:invited',
    owner: 'social.invite',
    registrar: 'App.tsx',
    boundedContext: 'social',
    registrationKind: 'raw',
    enforced: true,
    description: 'Inbound friend invite popup state',
  },
  {
    socketEvent: 'presence:update',
    owner: 'social.presence',
    registrar: 'friends/registerFriendsSocketHandlers.ts',
    boundedContext: 'social',
    registrationKind: 'raw',
    enforced: true,
    description: 'Friend real-time presence online/offline status updates',
  },
  {
    socketEvent: 'connect',
    owner: 'infrastructure.bus',
    registrar: 'multiplayer/socketEventBus.ts',
    boundedContext: 'infrastructure',
    registrationKind: 'lifecycle-infrastructure',
    enforced: false,
    description: 'attachSocketEventBus lifecycle delivery (pairs with onAny)',
  },
  {
    socketEvent: 'disconnect',
    owner: 'infrastructure.bus',
    registrar: 'multiplayer/socketEventBus.ts',
    boundedContext: 'infrastructure',
    registrationKind: 'lifecycle-infrastructure',
    enforced: false,
    description: 'attachSocketEventBus lifecycle delivery (pairs with onAny)',
  },
  {
    socketEvent: 'connect_error',
    owner: 'infrastructure.bus',
    registrar: 'multiplayer/socketEventBus.ts',
    boundedContext: 'infrastructure',
    registrationKind: 'lifecycle-infrastructure',
    enforced: false,
    description: 'attachSocketEventBus lifecycle delivery',
  },
  {
    socketEvent: 'reconnect_failed',
    owner: 'infrastructure.bus',
    registrar: 'multiplayer/socketEventBus.ts',
    boundedContext: 'infrastructure',
    registrationKind: 'lifecycle-infrastructure',
    enforced: false,
    description: 'attachSocketEventBus lifecycle delivery',
  },
  {
    socketEvent: 'room_join_ok',
    normalizedEvent: 'ROOM_JOIN_OK',
    owner: 'session.joinAck',
    registrar: 'multiplayer/joinAckCoordinator.ts',
    boundedContext: 'session',
    registrationKind: 'internal-dispatch',
    enforced: false,
    description: 'ROOM_JOIN_OK dispatched after join ack processing',
  },
  {
    socketEvent: 'resync_needed',
    normalizedEvent: 'RESYNC_NEEDED',
    owner: 'recovery.resync',
    registrar: 'multiplayer/useMultiplayerResync.ts',
    boundedContext: 'recovery',
    registrationKind: 'internal-dispatch',
    enforced: false,
    description: 'Client-initiated resync dispatch',
  },
];

/** Wire-protocol constants for approved registrars — prevents typos and drift. */
export const SOCKET_EVENTS = {
  STATE_UPDATE: 'state:update',
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  CONNECT_ERROR: 'connect_error',
  RECONNECT_FAILED: 'reconnect_failed',
  SERVER_SHUTDOWN: 'server:shutdown',
  TOURNAMENT_MATCH_ASSIGNED: 'tournament:match:assigned',
  ROOM_CHAT: 'room:chat',
  ROOM_EMOTE: 'room:emote',
  ROOM_SESSION_SUPERSEDED: 'room:session:superseded',
  HAND_ENDED: 'hand:ended',
  GAME_REMATCH_STATUS: 'game:rematch:status',
  GAME_REMATCH_STARTED: 'game:rematch:started',
  PLAYER_DRAGGING: 'player:dragging',
  FRIEND_INVITE_ERROR: 'friend:invite:error',
  FRIEND_INVITE_DECLINED: 'friend:invite:declined',
  FRIEND_INVITED: 'friend:invited',
  PRESENCE_UPDATE: 'presence:update',
  ROOM_UPDATE: 'room:update',
  ROOM_REQUEST_READY: 'room:request_ready',
  STATE_SPECTATE: 'state:spectate',
  GAME_DRAW_ANIMATION: 'game:draw_animation',
  PLAYER_DISCONNECTED: 'player:disconnected',
  PLAYER_RECONNECTED: 'player:reconnected',
  PLAYER_RECONNECT_TIMEOUT: 'player:reconnect_timeout',
  ROOM_MATCH_ABANDONED: 'room:match_abandoned',
} as const;

/** Tournament wire-protocol constants — enforced via TOURNAMENT_SOCKET_EVENT_REGISTRY entries. */
/** Matchmaking wire-protocol constants — enforced via matchmaking registry entries. */
export const MATCHMAKING_SOCKET_EVENTS = {
  QUEUE_ONLINE: 'queue:online',
  QUEUE_MATCHED: 'queue:matched',
  QUEUE_TIMEOUT: 'queue:timeout',
} as const;

export const MATCHMAKING_SOCKET_EVENT_VALUES = Object.values(MATCHMAKING_SOCKET_EVENTS);

export const TOURNAMENT_SOCKET_EVENTS = {
  REGISTRATION_OPEN: 'tournament:registration_open',
  REGISTRATION_UPDATED: 'tournament:registration_updated',
  BRACKET_GENERATED: 'tournament:bracket_generated',
  MATCH_UPDATED: 'tournament:match_updated',
  MATCH_READY: 'tournament:match_ready',
  MATCH_COMPLETED: 'tournament:match_completed',
  COMPLETED: 'tournament:completed',
} as const;

export const TOURNAMENT_SOCKET_EVENT_VALUES = Object.values(TOURNAMENT_SOCKET_EVENTS);

export function getEnforcedTournamentRegistryEntries(): SocketEventRegistryEntry[] {
  return SOCKET_EVENT_REGISTRY.filter(
    (entry) => entry.enforced && entry.boundedContext === 'tournament' && entry.registrationKind === 'raw',
  );
}

export function getEnforcedMatchmakingRegistryEntries(): SocketEventRegistryEntry[] {
  return SOCKET_EVENT_REGISTRY.filter(
    (entry) => entry.enforced && entry.boundedContext === 'matchmaking' && entry.registrationKind === 'raw',
  );
}

export const NORMALIZED_ROUTER_KEYS = {
  ROOM_JOIN_OK: 'roomJoinOk',
  STATE_UPDATE: 'stateUpdate',
  RESYNC_NEEDED: 'resyncNeeded',
  TRANSPORT_FAIL: 'transportFail',
  ROOM_JOIN_TERMINAL: 'roomJoinTerminal',
} as const satisfies Record<string, keyof NormalizedSocketRouter>;

export function getEnforcedRegistryEntries(): SocketEventRegistryEntry[] {
  return SOCKET_EVENT_REGISTRY.filter((entry) => entry.enforced);
}

export function getRegistryEntryBySocketEvent(
  socketEvent: string,
  registrationKind: SocketRegistrationKind,
): SocketEventRegistryEntry | undefined {
  return SOCKET_EVENT_REGISTRY.find(
    (entry) => entry.socketEvent === socketEvent && entry.registrationKind === registrationKind,
  );
}
