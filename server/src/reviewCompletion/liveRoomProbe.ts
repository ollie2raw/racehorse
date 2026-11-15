/**
 * Counts the rooms that are "live play" for the review sweep's yield (reviewLivePlayYield.ts): a started, unfinished,
 * not-abandoned match with at least one connected socket and a match event inside the activity window. A room that was
 * restored from storage and has nobody connected is not counted, and neither is a finished match still in memory.
 *
 * The room and socket lookups are passed in (index.ts owns them), so this file imports nothing from the multiplayer code.
 */
export type LiveRoomView = {
  readonly state: { readonly gameOver?: boolean } | null;
  readonly abandonedAt?: string;
  readonly events: ReadonlyArray<{ readonly timestamp: string }>;
  readonly lastHandEndedAtMs: number | null;
};

export type LiveRoomProbeDeps = {
  readonly roomCodes: () => Iterable<string>;
  readonly peekRoom: (code: string) => LiveRoomView | undefined;
  /** Sockets currently joined to the room's socket.io room. */
  readonly connectedSockets: (code: string) => number;
  readonly activityWindowMs: number;
};

export function createLiveRoomProbe(deps: LiveRoomProbeDeps): (now: number) => number {
  return (now) => {
    let live = 0;
    for (const code of deps.roomCodes()) {
      const room = deps.peekRoom(code);
      if (!room || !room.state || room.state.gameOver || room.abandonedAt) continue;
      const lastEventAt = room.events.length > 0 ? Date.parse(room.events[room.events.length - 1].timestamp) : 0;
      const lastActivity = Math.max(Number.isFinite(lastEventAt) ? lastEventAt : 0, room.lastHandEndedAtMs ?? 0);
      if (now - lastActivity > deps.activityWindowMs) continue;
      if (deps.connectedSockets(code) < 1) continue;
      live += 1;
    }
    return live;
  };
}
