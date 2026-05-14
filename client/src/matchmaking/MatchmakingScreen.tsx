import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import { OnlineCountBadge } from './OnlineCountBadge';
import { MatchFoundOverlay } from './MatchFoundOverlay';
import { useMatchmaking } from './useMatchmaking';
import type { MatchFoundPayload } from './types';
import './matchmakingScreen.css';

type Identity = { userId: string; username: string } | null;

export interface MatchmakingScreenProps {
  socket: Socket | null;
  identity: Identity;
  isConnected: boolean;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onBackHome: () => void;
  onOpenPrivateMatch: () => void;
  /** Called when the Match Found countdown ends. Parent must trigger room:join. */
  onAutoJoinRoom: (payload: MatchFoundPayload) => void;
  /** Called when the user accepts the 90s timeout bot fallback. */
  onPlayBotFallback: () => void;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function MatchmakingScreen(props: MatchmakingScreenProps) {
  const [overlayPayload, setOverlayPayload] = useState<MatchFoundPayload | null>(null);

  const handleMatchReady = useCallback((payload: MatchFoundPayload) => {
    setOverlayPayload(payload);
  }, []);

  const mm = useMatchmaking({
    socket: props.socket,
    identity: props.identity,
    onMatchReady: handleMatchReady,
  });

  // Request an immediate online-count snapshot once when the socket is ready,
  // so the badge isn't stuck on 0 for the first 2 seconds.
  useEffect(() => {
    if (!props.socket || !props.isConnected) return;
    props.socket.emit('queue:online', {}, () => { /* server will broadcast queue:online next tick */ });
  }, [props.socket, props.isConnected]);

  const isIdle = mm.state === 'idle';
  const isSearching = mm.state === 'searching';
  const isTimeout = mm.state === 'timeout';

  return (
    <div className="mm-screen">
      <GlobalNav
        currentMode={'multiplayer' as AppMode}
        onNavigate={props.onNavigate}
        onOpenAuth={props.onOpenAuth}
      />

      <div className="mm-container">
        <div className="mm-toolbar">
          <button type="button" className="mm-back-btn" onClick={props.onBackHome}>
            <span aria-hidden>←</span> Back to Home
          </button>
          <div className="mm-subtabs">
            <button className="mm-subtab is-active" type="button">Quick Match</button>
            <button className="mm-subtab" type="button" onClick={props.onOpenPrivateMatch}>Private Match</button>
          </div>
          <OnlineCountBadge online={mm.online} queued={mm.queued} />
        </div>

        <div className="mm-hero">
          <span className="mm-hero-kicker">Multiplayer</span>
          <h1 className="mm-hero-title">Quick Match</h1>
          <p className="mm-hero-subtitle">
            Skill-based pairing. We&apos;ll match you with a player near your rating,
            expanding the search every 30 seconds.
          </p>
        </div>

        <div className="mm-action-card">
          {isIdle ? (
            <>
              <button
                type="button"
                className="mm-find-btn"
                onClick={mm.findMatch}
                disabled={!props.isConnected || !props.identity}
              >
                Find Match
              </button>
              {!props.identity ? (
                <p className="mm-help-row">Sign in to find a match.</p>
              ) : !props.isConnected ? (
                <p className="mm-help-row">Connecting to server…</p>
              ) : (
                <p className="mm-help-row">First to 60 points · Best-of-1</p>
              )}
              {mm.error ? <div className="mm-error">{mm.error}</div> : null}
            </>
          ) : null}

          {isSearching ? (
            <>
              <div className="mm-search-pulse" aria-hidden>
                <span className="mm-search-core" />
              </div>
              <div className="mm-search-meta">
                <div className="mm-search-elapsed">{formatElapsed(mm.elapsedMs)}</div>
                <div className="mm-search-label">Searching for opponent…</div>
              </div>
              <button type="button" className="mm-cancel-btn" onClick={mm.cancel}>Cancel</button>
            </>
          ) : null}

          {isTimeout ? (
            <>
              <div className="mm-search-meta">
                <div className="mm-search-elapsed">—</div>
                <div className="mm-search-label">No opponent found</div>
              </div>
              <button
                type="button"
                className="mm-find-btn"
                onClick={() => { mm.acceptTimeoutBotFallback(); props.onPlayBotFallback(); }}
              >
                Play vs Bot
              </button>
              <button type="button" className="mm-cancel-btn" onClick={mm.findMatch}>
                Try again
              </button>
            </>
          ) : null}
        </div>
      </div>

      {overlayPayload ? (
        <MatchFoundOverlay
          payload={overlayPayload}
          onComplete={() => {
            const captured = overlayPayload;
            setOverlayPayload(null);
            mm.reset();
            props.onAutoJoinRoom(captured);
          }}
        />
      ) : null}
    </div>
  );
}
