import { useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { ArrowLeft, Eye, Radio, Users } from 'lucide-react';
import { Board } from '../components/Board.tsx';
import type { BoardState } from '../types.ts';
import type { SpectatorPublicSnapshot, SpectatorSessionKind, SpectatorSessionSummary } from '@racehorse/match-protocol';
import { registerRawSocketEventHandler } from '../multiplayer/socketEventBus.ts';
import './liveNow.css';

export default function LiveNowScreen({ socket, connect, onBack }: { socket: Socket | null; connect: () => void; onBack: () => void }) {
  const [kind, setKind] = useState<SpectatorSessionKind>('multiplayer_match');
  const [sessions, setSessions] = useState<SpectatorSessionSummary[]>([]);
  const [snapshot, setSnapshot] = useState<SpectatorPublicSnapshot | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting' | 'error'>('connecting');
  const [error, setError] = useState('');
  const snapshotRef = useRef<SpectatorPublicSnapshot | null>(null);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  useEffect(() => {
    if (!socket) { connect(); return; }
    const load = () => socket.emit('spectator:list', { kind: 'all', limit: 50 }, (ack: { ok: boolean; sessions?: SpectatorSessionSummary[]; error?: string }) => { if (ack.ok) { setSessions(ack.sessions ?? []); setConnection('live'); } else { setError(ack.error ?? 'Unable to load live tables.'); setConnection('error'); } });
    const update = (payload: unknown) => { const value = payload as SpectatorSessionSummary; setSessions((current) => [...current.filter((s) => s.sessionId !== value.sessionId), value]); };
    const remove = (payload: unknown) => { const value = payload as { sessionId: string }; setSessions((current) => current.filter((s) => s.sessionId !== value.sessionId)); };
    const snap = (payload: unknown) => { const value = payload as SpectatorPublicSnapshot; setSnapshot((current) => acceptSpectatorSnapshot(current, value)); };
    const count = (payload: unknown) => { const value = payload as { sessionId: string; count: number }; setSnapshot((current) => current?.sessionId === value.sessionId ? { ...current, spectatorCount: value.count } : current); setSessions((current) => current.map((s) => s.sessionId === value.sessionId ? { ...s, spectatorCount: value.count } : s)); };
    const unregister = [
      registerRawSocketEventHandler('spectator:session_added', update),
      registerRawSocketEventHandler('spectator:session_updated', update),
      registerRawSocketEventHandler('spectator:session_removed', remove),
      registerRawSocketEventHandler('spectator:update', snap),
      registerRawSocketEventHandler('spectator:ended', snap),
      registerRawSocketEventHandler('spectator:count', count),
      registerRawSocketEventHandler('disconnect', () => setConnection('reconnecting')),
      registerRawSocketEventHandler('connect', () => {
        const current = snapshotRef.current;
        if (!current) { load(); return; }
        socket.emit('spectator:join', { sessionId: current.sessionId }, (ack: { ok: boolean; snapshot?: SpectatorPublicSnapshot; error?: string }) => {
          if (ack.ok && ack.snapshot) { setSnapshot(ack.snapshot); setConnection('live'); }
          else { setError(ack.error ?? 'Session no longer available.'); setConnection('error'); }
        });
      }),
    ];
    load();
    return () => unregister.forEach((fn) => fn());
  }, [socket, connect]);
  const filtered = useMemo(() => sessions.filter((s) => s.kind === kind), [sessions, kind]);
  const watch = (id: string) => socket?.emit('spectator:join', { sessionId: id }, (ack: { ok: boolean; snapshot?: SpectatorPublicSnapshot; error?: string }) => { if (ack.ok && ack.snapshot) { setSnapshot(ack.snapshot); setConnection('live'); } else setError(ack.error ?? 'Session unavailable.'); });
  const leave = () => { if (snapshot) socket?.emit('spectator:leave', { sessionId: snapshot.sessionId }); setSnapshot(null); };
  if (snapshot) return <SpectatorViewer snapshot={snapshot} connection={connection} onLeave={leave} />;
  return <main className="live-now"><header><button type="button" onClick={onBack} aria-label="Back to Home"><ArrowLeft /> Back</button><div><p className="eyebrow"><Radio /> Racehorse broadcast</p><h1>Live Now</h1><p>Watch public tables and player-enabled Daily Fritz runs.</p></div><span className="live-now__status" role="status">{connection}</span></header><div className="live-now__tabs" role="tablist" aria-label="Live session categories"><button role="tab" aria-selected={kind === 'multiplayer_match'} onClick={() => setKind('multiplayer_match')}>Matches</button><button role="tab" aria-selected={kind === 'daily_fritz'} onClick={() => setKind('daily_fritz')}>Daily Fritz</button></div>{error ? <p role="alert">{error}</p> : null}<section className="live-now__grid" aria-label={kind === 'multiplayer_match' ? 'Live matches' : 'Live Daily Fritz runs'}>{filtered.length === 0 ? <div className="live-now__empty"><Eye /><h2>{kind === 'multiplayer_match' ? 'No public matches are live right now.' : 'No Daily Fritz players are broadcasting right now.'}</h2></div> : filtered.map((session) => <article key={session.sessionId} className="live-now__card"><div><span className="live-dot">Live</span><span>Hand {session.handNumber}</span></div><h2>{session.participants.map((p) => p.displayName).join(' vs ')}</h2><p>{session.participants.map((p) => `${p.displayName} ${p.score}`).join(' · ')}</p><p><Users size={16} /> {session.spectatorCount} watching</p><button type="button" onClick={() => watch(session.sessionId)} aria-label={`Watch ${session.participants.map((p) => p.displayName).join(' versus ')}`}>Watch</button></article>)}</section></main>;
}

export function acceptSpectatorSnapshot(current: SpectatorPublicSnapshot | null, incoming: SpectatorPublicSnapshot): SpectatorPublicSnapshot | null {
  if (current && incoming.sessionId !== current.sessionId) return current;
  if (current && incoming.sequence <= current.sequence) return current;
  return incoming;
}

function SpectatorViewer({ snapshot, connection, onLeave }: { snapshot: SpectatorPublicSnapshot; connection: string; onLeave: () => void }) {
  const board = snapshot.board as BoardState | null;
  return <main className="spectator-viewer"><header><button type="button" onClick={onLeave} aria-label="Leave spectator view"><ArrowLeft /> Live Now</button><div><p className="eyebrow">{snapshot.kind === 'daily_fritz' ? 'Daily Fritz broadcast' : 'Public multiplayer table'}</p><h1>{snapshot.participants.map((p) => p.displayName).join(' vs ')}</h1></div><span aria-live="polite">{connection === 'live' ? `${snapshot.spectatorCount} watching` : connection}</span></header><section className="spectator-viewer__scores">{snapshot.participants.map((p, index) => <article key={`${p.displayName}-${index}`} aria-label={`${p.displayName}, score ${p.score}, ${p.handCount} tiles`}><strong>{p.displayName}</strong><b>{p.score}</b><span>{p.handCount} tiles</span>{snapshot.activeParticipantIndex === index ? <em>Current turn</em> : null}</article>)}</section><div className="spectator-viewer__layout"><section className="spectator-viewer__board" aria-label={`Read-only board. Hand ${snapshot.handNumber}. Boneyard ${snapshot.boneyardCount} tiles.`}><Board board={board} legalMoves={[]} selectedTile={null} onPositionClick={() => undefined} staticView showZoomTray={false} /><div className="spectator-viewer__meta"><span>Hand {snapshot.handNumber}</span><span>Boneyard {snapshot.boneyardCount}</span><span>{snapshot.status}</span></div></section><aside><h2>Public move feed</h2><ol>{snapshot.publicMoveFeed.length === 0 ? <li>Waiting for the next public move.</li> : snapshot.publicMoveFeed.map((entry) => <li key={entry.id}>{entry.message}</li>)}</ol></aside></div>{snapshot.result ? <section className="spectator-viewer__result" tabIndex={-1}><h2>Table complete</h2><p>{snapshot.result.winnerDisplayName ? `${snapshot.result.winnerDisplayName} won.` : 'Broadcast ended.'}</p></section> : null}</main>;
}
