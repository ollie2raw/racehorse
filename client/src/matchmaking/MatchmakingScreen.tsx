import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import { MatchFoundOverlay } from './MatchFoundOverlay';
import { useMatchmaking } from './useMatchmaking';
import type { MatchFoundPayload } from './types';
import './matchmakingScreen.css';

type Identity = { userId: string; username: string } | null;

export interface MatchmakingScreenProps {
  socket: Socket | null;
  identity: Identity;
  isConnected: boolean;
  myRating?: number | null;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onBackHome: () => void;
  onOpenPrivateMatch: () => void;
  onAutoJoinRoom: (payload: MatchFoundPayload) => void;
  onPlayBotFallback: () => void;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function ratingWindowAt(waitedMs: number): number | null {
  if (waitedMs >= 90_000) return null;
  const steps = Math.floor(waitedMs / 30_000);
  return 200 + steps * 200;
}

function initialsFor(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const init = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
  return init || name.slice(0, 2).toUpperCase();
}

function IconBolt({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M13 3L5 14H12L11 21L19 10H12L13 3Z" fill="currentColor" />
    </svg>
  );
}

function IconCrown({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconUsers({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M17 21V19C17 17.9 16.6 16.9 15.8 16.2C15.1 15.4 14.1 15 13 15H5C3.9 15 2.9 15.4 2.2 16.2C1.4 16.9 1 17.9 1 19V21M9 11C11.2 11 13 9.2 13 7C13 4.8 11.2 3 9 3C6.8 3 5 4.8 5 7C5 9.2 6.8 11 9 11ZM23 21V19C23 17 21.7 15.4 20 15M16 3.1C17.7 3.6 19 5.1 19 7S17.7 10.4 16 10.9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconClock({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7V12L15 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconTarget({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

function IconDominoes({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" strokeWidth="2" />
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" />
      <circle cx="9" cy="7" r="1.2" fill="currentColor" />
      <circle cx="15" cy="7" r="1.2" fill="currentColor" />
      <circle cx="12" cy="17" r="1.2" fill="currentColor" />
    </svg>
  );
}

const SEARCH_STEPS = [
  { range: '±200', when: '0–30s' },
  { range: '±400', when: '30–60s' },
  { range: '±600', when: '60–90s' },
  { range: 'Any', when: '90s+' },
];

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

  useEffect(() => {
    if (!props.socket || !props.isConnected) return;
    props.socket.emit('queue:online', {}, () => undefined);
  }, [props.socket, props.isConnected]);

  const isIdle = mm.state === 'idle';
  const isSearching = mm.state === 'searching';
  const isTimeout = mm.state === 'timeout';

  const myRating = props.myRating ?? null;
  const myUsername = props.identity?.username ?? null;
  const myInitials = useMemo(() => initialsFor(myUsername ?? undefined), [myUsername]);

  const currentWindow = isSearching ? ratingWindowAt(mm.elapsedMs) : null;

  return (
    <div className="mm-page">
      <GlobalNav
        currentMode={'multiplayer' as AppMode}
        onNavigate={props.onNavigate}
        onOpenAuth={props.onOpenAuth}
        activeColor="var(--tier-standard)"
      />

      <div className="mm-shell">
        <div className="mm-toolbar">
          <button type="button" className="mm-back" onClick={props.onBackHome}>
            <span aria-hidden>←</span> Back to Home
          </button>
          <div className="mm-subtabs">
            <button className="mm-subtab is-active" type="button">Quick Match</button>
            <button className="mm-subtab" type="button" onClick={props.onOpenPrivateMatch}>
              Private Match
            </button>
          </div>
          <div className="mm-online-badge" role="status" aria-live="polite">
            <span className="mm-online-badge__dot" aria-hidden />
            {mm.online.toLocaleString()} online · {mm.queued.toLocaleString()} searching
          </div>
        </div>

        <div className="mm-layout">
          {/* ── LEFT COLUMN ───────────────────────────────────────────────── */}
          <div className="mm-left">
            <div>
              <p className="mm-kicker">Multiplayer</p>
              <h1 className="mm-title">Quick Match</h1>
              <p className="mm-desc">
                Skill-based 1v1 dominos. We pair you with a player near your rating and expand
                the search every 30 seconds.
              </p>
            </div>

            <div className="mm-stage">
              <svg className="mm-stage-rings" viewBox="0 0 100 100" aria-hidden>
                <circle className="mm-stage-rings__ring" cx="50" cy="50" r="22" />
                <circle className="mm-stage-rings__ring" cx="50" cy="50" r="34" />
                <circle className="mm-stage-rings__ring" cx="50" cy="50" r="46" />
              </svg>
              <div className="mm-matchup">
                <div className="mm-player-card mm-player-card--you">
                  <div className="mm-player-avatar" aria-hidden>{myInitials}</div>
                  <span className="mm-player-status">
                    <span className="mm-player-status__dot" aria-hidden /> Ready
                  </span>
                  <span className="mm-player-name">{myUsername ?? 'You'}</span>
                  <span className="mm-player-rating">
                    <span className="mm-player-rating__star" aria-hidden>★</span>
                    {myRating != null ? myRating.toLocaleString() : '—'} Rating
                  </span>
                </div>

                <div className="mm-versus">
                  <span className="mm-versus__pill">VS</span>
                </div>

                <div className="mm-player-card mm-player-card--opp">
                  <div className="mm-player-avatar mm-player-avatar--placeholder" aria-hidden>?</div>
                  <span className="mm-player-status mm-player-status--searching">
                    <span className="mm-player-status__dot" aria-hidden />
                    {isSearching ? 'Searching' : 'Awaiting'}
                  </span>
                  <span className="mm-player-name">Opponent</span>
                  <span className="mm-player-rating">Near your rating</span>
                </div>
              </div>
            </div>

            <div className="mm-features">
              <div className="mm-feature">
                <div className="mm-feature__header">
                  <IconCrown /> Ranked
                </div>
                <div className="mm-feature__desc">Affects your Glicko rating.</div>
              </div>
              <div className="mm-feature">
                <div className="mm-feature__header">
                  <IconBolt /> Instant Match
                </div>
                <div className="mm-feature__desc">No setup. We find the opponent.</div>
              </div>
              <div className="mm-feature">
                <div className="mm-feature__header">
                  <IconUsers /> Real Opponents
                </div>
                <div className="mm-feature__desc">Pulled from the global queue.</div>
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN (control panel) ──────────────────────────────── */}
          <div className="mm-panel">
            <div className="mm-panel-body">
              {/* SECTION 1 — depends on state */}
              {isIdle ? (
                <>
                  <div className="mm-section">
                    <div className="fritz-section-label">1. MATCH FORMAT</div>
                    <h2 className="mm-section-heading">Standard 1v1</h2>
                    <p className="mm-section-body">
                      First to 60 points, 7-tile classic. Single game; no best-of.
                    </p>
                    <div className="fritz-summary-strip">
                      <div className="fritz-summary-item">
                        <div className="fritz-summary-icon" style={{ color: 'var(--tier-standard)' }}>
                          <IconDominoes size={18} />
                        </div>
                        <div>
                          <div className="fritz-summary-value">7-Tile</div>
                          <div className="fritz-summary-key">Format</div>
                        </div>
                      </div>
                      <div className="fritz-summary-divider" aria-hidden />
                      <div className="fritz-summary-item">
                        <div className="fritz-summary-icon" style={{ color: 'var(--tier-standard)' }}>
                          <IconTarget size={18} />
                        </div>
                        <div>
                          <div className="fritz-summary-value">First to 60</div>
                          <div className="fritz-summary-key">Win Target</div>
                        </div>
                      </div>
                      <div className="fritz-summary-divider" aria-hidden />
                      <div className="fritz-summary-item">
                        <div className="fritz-summary-icon" style={{ color: 'var(--tier-standard)' }}>
                          <IconClock size={18} />
                        </div>
                        <div>
                          <div className="fritz-summary-value">Untimed</div>
                          <div className="fritz-summary-key">Turns</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mm-section">
                    <div className="fritz-section-label">2. RATING RANGE</div>
                    <h2 className="mm-section-heading">Expanding skill window</h2>
                    <p className="mm-section-body">
                      We start with players near your rating, then widen the search every 30 seconds.
                    </p>
                    <div className="mm-window-timeline">
                      {SEARCH_STEPS.map((step) => (
                        <div className="mm-window-step" key={step.when}>
                          <div className="mm-window-step__range">{step.range}</div>
                          <div className="mm-window-step__when">{step.when}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mm-section">
                    <div className="fritz-section-label">3. MATCH SUMMARY</div>
                    <div className="fritz-summary-strip">
                      <div className="fritz-summary-item">
                        <div className="fritz-summary-icon" style={{ color: 'var(--tier-elite)' }}>
                          <IconCrown size={18} />
                        </div>
                        <div>
                          <div className="fritz-summary-value">{myRating != null ? myRating.toLocaleString() : '—'}</div>
                          <div className="fritz-summary-key">Your Rating</div>
                        </div>
                      </div>
                      <div className="fritz-summary-divider" aria-hidden />
                      <div className="fritz-summary-item">
                        <div className="fritz-summary-icon" style={{ color: 'var(--tier-elite)' }}>
                          <IconUsers size={18} />
                        </div>
                        <div>
                          <div className="fritz-summary-value">{mm.queued.toLocaleString()}</div>
                          <div className="fritz-summary-key">In Queue</div>
                        </div>
                      </div>
                      <div className="fritz-summary-divider" aria-hidden />
                      <div className="fritz-summary-item">
                        <div className="fritz-summary-icon" style={{ color: 'var(--tier-elite)' }}>
                          <IconBolt size={18} />
                        </div>
                        <div>
                          <div className="fritz-summary-value">Ranked</div>
                          <div className="fritz-summary-key">Match Type</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              {isSearching ? (
                <div className="mm-section">
                  <div className="fritz-section-label">SEARCHING</div>
                  <div className="mm-searching">
                    <div className="mm-search-pulse" aria-hidden>
                      <span className="mm-search-core" />
                    </div>
                    <div className="mm-search-elapsed" aria-live="polite">
                      {formatElapsed(mm.elapsedMs)}
                    </div>
                    <div className="mm-search-status">Looking for opponent…</div>
                    <div className="mm-search-meta">
                      <span className="mm-search-meta__pill">
                        Range <strong>{currentWindow != null ? `±${currentWindow}` : 'Any'}</strong>
                      </span>
                      <span className="mm-search-meta__pill">
                        Queue <strong>{mm.queued.toLocaleString()}</strong>
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}

              {isTimeout ? (
                <div className="mm-section">
                  <div className="fritz-section-label">QUEUE TIMEOUT</div>
                  <div className="mm-timeout">
                    <div className="mm-timeout__icon" aria-hidden>
                      <IconClock size={22} />
                    </div>
                    <h2 className="mm-timeout__title">No opponent found</h2>
                    <p className="mm-timeout__sub">
                      The queue is quiet right now. You can keep waiting or play a ranked match
                      against Fritz instead.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mm-panel-footer">
              {isIdle ? (
                <>
                  <button
                    type="button"
                    className="mm-cta"
                    onClick={mm.findMatch}
                    disabled={!props.isConnected || !props.identity}
                  >
                    Find Match
                    <span className="mm-cta-chevron" aria-hidden>›</span>
                  </button>
                  {!props.identity ? (
                    <p className="mm-help-text">Sign in to find a match.</p>
                  ) : !props.isConnected ? (
                    <p className="mm-help-text">Connecting to server…</p>
                  ) : (
                    <p className="mm-help-text">First to 60 · 7-Tile · Ranked</p>
                  )}
                  {mm.error ? <p className="mm-error">{mm.error}</p> : null}
                </>
              ) : null}

              {isSearching ? (
                <button type="button" className="mm-cta mm-cta--cancel" onClick={mm.cancel}>
                  Cancel Search
                </button>
              ) : null}

              {isTimeout ? (
                <>
                  <button
                    type="button"
                    className="mm-cta"
                    onClick={() => {
                      mm.acceptTimeoutBotFallback();
                      props.onPlayBotFallback();
                    }}
                  >
                    Play vs Fritz
                    <span className="mm-cta-chevron" aria-hidden>›</span>
                  </button>
                  <button type="button" className="mm-cta-secondary" onClick={mm.findMatch}>
                    Try Again →
                  </button>
                </>
              ) : null}
            </div>
          </div>
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
