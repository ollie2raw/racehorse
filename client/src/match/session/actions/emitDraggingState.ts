import type { MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState } from '../../../types';

export type EmitDraggingStateParams = {
  socket: Socket | null;
  joinedRoom: string | null;
  state: GameState | null;
  you: string;
  dragging: boolean;
  draggingStateRef: MutableRefObject<boolean>;
};

export function emitDraggingState(params: EmitDraggingStateParams): void {
  const { socket, joinedRoom, state, you, dragging, draggingStateRef } = params;
  if (draggingStateRef.current === dragging) return;
  draggingStateRef.current = dragging;
  if (!socket || !joinedRoom || !state || state.gameOver || state.handOver) return;
  if (!state.playerIds.includes(you)) return;
  socket.emit('player:dragging', joinedRoom, { dragging });
}