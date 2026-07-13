import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { Radio, RadioTower } from 'lucide-react';
import type { BotMatchState } from '../modules/match/runtime/botEngine.ts';
import type { SpectatorMoveFeedEntry, SpectatorPublicSnapshot } from '@racehorse/match-protocol';
import { SPECTATOR_MOVE_FEED_LIMIT } from '@racehorse/match-protocol';
import { registerRawSocketEventHandler } from '../multiplayer/socketEventBus.ts';

type BroadcastPhase = 'off' | 'starting' | 'live' | 'stopping' | 'error';

export function buildDailyFritzSpectatorSnapshot(args: {
  state: BotMatchState;
  sessionId: string;
  sequence: number;
  userId: string | null;
  username: string | null;
  spectatorCount: number;
  startedAt: string;
  updatedAt: string;
  publicMoveFeed?: SpectatorMoveFeedEntry[];
}): SpectatorPublicSnapshot {
  const { state, sessionId, sequence, userId, username, spectatorCount, startedAt, updatedAt } = args;
  return {
    schemaVersion: 1,
    sessionId,
    kind: 'daily_fritz',
    sequence,
    status: state.gameOver ? 'completed' : 'active',
    board: state.board ? structuredClone(state.board) : null,
    participants: [
      { userId, displayName: username || 'Daily Fritz Player', avatarUrl: null, score: state.players.you.score, handCount: state.players.you.hand.length },
      { userId: null, displayName: 'Fritz', avatarUrl: null, score: state.players.bot.score, handCount: state.players.bot.hand.length },
    ],
    activeParticipantIndex: state.gameOver ? null : state.currentPlayer === 'you' ? 0 : 1,
    consecutivePasses: state.consecutivePasses,
    boneyardCount: state.boneyard.length,
    handNumber: state.handNumber,
    publicMoveFeed: (args.publicMoveFeed ?? []).slice(-SPECTATOR_MOVE_FEED_LIMIT).map((entry) => ({ ...entry, tile: entry.tile ? { ...entry.tile } : undefined })),
    spectatorCount,
    startedAt,
    updatedAt,
    completedAt: state.gameOver ? updatedAt : null,
    result: state.gameOver ? {
      winnerDisplayName: state.winnerId === 'you' ? (username || 'Daily Fritz Player') : state.winnerId === 'bot' ? 'Fritz' : null,
      finalScores: [state.players.you.score, state.players.bot.score],
      reason: 'daily_fritz_completed',
    } : null,
  };
}

function appendPublicStateChangeFeed(previous: BotMatchState | null, next: BotMatchState, current: SpectatorMoveFeedEntry[], sequence: number, at: string, username: string | null): SpectatorMoveFeedEntry[] {
  if (!previous) return current;
  const actor = previous.currentPlayer === 'you' ? (username || 'Daily Fritz Player') : 'Fritz';
  let message: string | null = null;
  let kind: SpectatorMoveFeedEntry['kind'] = 'played';
  if (next.handNumber > previous.handNumber) { kind = 'hand_ended'; message = `Hand ${previous.handNumber} ended`; }
  else if (next.gameOver && !previous.gameOver) { kind = 'completed'; message = 'Daily Fritz run completed'; }
  else {
    const before = previous.players[previous.currentPlayer].hand.length;
    const after = next.players[previous.currentPlayer].hand.length;
    if (after < before) message = `${actor} played a tile`;
    else if (after > before) { kind = 'drew'; message = `${actor} drew a tile`; }
    else if (next.currentPlayer !== previous.currentPlayer) { kind = 'passed'; message = `${actor} passed`; }
  }
  if (!message) return current;
  return [...current, { id: `daily:${sequence}`, sequence, timestamp: at, participantName: actor, kind, message }].slice(-SPECTATOR_MOVE_FEED_LIMIT);
}

export function useDailyFritzBroadcast({ socket, runId, userId, username, state }: { socket: Socket | null; runId: string; userId: string | null; username: string | null; state: BotMatchState | null }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<BroadcastPhase>('off');
  const [count, setCount] = useState(0);
  const sequence = useRef(0);
  const startedAt = useRef<string | null>(null);
  const previousState = useRef<BotMatchState | null>(null);
  const publicMoveFeed = useRef<SpectatorMoveFeedEntry[]>([]);
  const snapshot = useCallback((id: string, at = new Date().toISOString()): SpectatorPublicSnapshot | null => {
    if (!state) return null;
    return buildDailyFritzSpectatorSnapshot({ state, sessionId: id, sequence: sequence.current, userId, username, spectatorCount: count, startedAt: startedAt.current ?? at, updatedAt: at, publicMoveFeed: publicMoveFeed.current });
  }, [state, userId, username, count]);
  const start = () => {
    if (!socket || !state || !userId) return;
    setPhase('starting');
    sequence.current = 1;
    startedAt.current = new Date().toISOString();
    previousState.current = state;
    publicMoveFeed.current = [{ id: 'daily:1', sequence: 1, timestamp: startedAt.current, participantName: username || 'Daily Fritz Player', kind: 'broadcast_started', message: 'Broadcast started' }];
    socket.emit('daily_fritz:broadcast_start', { runId, snapshot: snapshot('pending', startedAt.current) }, (ack: { ok: boolean; sessionId?: string }) => {
      if (ack.ok && ack.sessionId) { setSessionId(ack.sessionId); setPhase('live'); }
      else setPhase('error');
    });
  };
  const stop = () => {
    if (!socket || !sessionId) return;
    setPhase('stopping');
    socket.emit('daily_fritz:broadcast_stop', { sessionId }, () => { setSessionId(null); setPhase('off'); setCount(0); });
  };
  useEffect(() => {
    if (!socket || !sessionId || phase !== 'live' || !state) return;
    sequence.current += 1;
    const at = new Date().toISOString();
    publicMoveFeed.current = appendPublicStateChangeFeed(previousState.current, state, publicMoveFeed.current, sequence.current, at, username);
    previousState.current = state;
    const value = snapshot(sessionId, at);
    if (value) socket.emit('daily_fritz:broadcast_update', { sessionId, snapshot: value });
  }, [socket, sessionId, phase, state, snapshot, username]);
  useEffect(() => {
    if (!socket) return;
    return registerRawSocketEventHandler('spectator:count', (payload) => {
      const value = payload as { sessionId: string; count: number };
      if (value.sessionId === sessionId) setCount(value.count);
    });
  }, [socket, sessionId]);
  useEffect(() => () => { if (socket && sessionId) socket.emit('daily_fritz:broadcast_stop', { sessionId }); }, [socket, sessionId]);
  return { phase, count, start, stop, canStart: Boolean(socket && state && userId) };
}

export function DailyFritzBroadcastControl({ phase, count, canStart, onStart, onStop }: { phase: BroadcastPhase; count: number; canStart: boolean; onStart: () => void; onStop: () => void }) {
  return <div className="daily-fritz-broadcast" role="status">{phase === 'live' ? <><RadioTower size={16} /><strong>Live</strong><span>{count} watching</span><button type="button" onClick={onStop}>Stop Broadcast</button></> : <><Radio size={16} /><span>{phase === 'error' ? 'Broadcast unavailable' : 'Broadcast this run'}</span><button type="button" disabled={!canStart || phase === 'starting'} onClick={onStart}>{phase === 'starting' ? 'Starting...' : 'Go Live'}</button></>}</div>;
}
