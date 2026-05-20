import React from 'react';
import './RacehorseMatchArena.css';

interface RacehorseMatchArenaProps {
  // Brand & User
  username?: string;
  rating?: number;
  
  // Players
  opponentLabel: string;
  opponentScore: number;
  opponentHandCount: number;
  playerScore: number;
  
  // Game State
  turnLabel: string;
  isPlayerTurn: boolean;
  openEndsSum: number;
  boneyardCount: number;
  winningScore: number;
  
  // Content Fragments
  boardContent: React.ReactNode;
  handContent: React.ReactNode;
  opponentHandPreview?: React.ReactNode; 
  
  // Callbacks
  onExit: () => void;
  onSettings: () => void;
  onChat: () => void;
  onDraw: () => void;
  onBlock: () => void;
  onHint: () => void;
  onToggleTheme: () => void;
  
  // Capabilities
  canDraw: boolean;
  canBlock: boolean;
  showHints: boolean;
  hintCount?: number;
}

/**
 * RacehorseMatchArena
 * High-fidelity implementation with dense target geometry and premium layers.
 */
export const RacehorseMatchArena: React.FC<RacehorseMatchArenaProps> = ({
  username,
  rating,
  opponentLabel,
  opponentScore,
  opponentHandCount,
  playerScore,
  isPlayerTurn,
  openEndsSum,
  boneyardCount,
  winningScore,
  boardContent,
  handContent,
  opponentHandPreview,
  onExit,
  onSettings,
  onChat,
  onDraw,
  onBlock,
  onHint,
  onToggleTheme,
  canDraw,
  canBlock,
  showHints,
  hintCount = 3,
}) => {
  const trackTarget = Math.max(1, winningScore);
  const playerProgress = Math.min(1, playerScore / trackTarget) * 100;
  const trackMilestones = [0, 0.25, 0.5, 0.75, 1].map((fraction) =>
    Math.round(trackTarget * fraction),
  );
  const displayUsername = username ?? 'oliver';
  const displayRating = rating?.toLocaleString() ?? '1,976';
  
  return (
    <div className="racehorse-arena-shell">
      {/* 0. IDENTITY STRIP */}
      <div className="arena-identity-strip">
        <div className="arena-identity-strip__brand">
          <div className="arena-identity-strip__logo">R</div>
          <span className="arena-identity-strip__wordmark">RACEHORSE</span>
        </div>
        <div className="arena-identity-strip__mode">DOMINOES</div>
        <div className="arena-identity-strip__user">
          <div className="arena-identity-strip__rating">
            <span className="arena-identity-strip__rating-value">{displayRating}</span>
            <span style={{ fontSize: '0.75rem', opacity: 0.5, fontWeight: 700, marginLeft: 4, textTransform: 'uppercase' }}>Rating</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: 0.8 }}>
             <svg width="22" height="22" viewBox="0 0 24 24" fill="var(--rh-blue-soft)"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 2 7.5 2c1.74 0 3.41.81 4.5 2.09C13.09 2.81 14.76 2 16.5 2 19.58 2 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
             <span style={{ fontSize: '1.1rem', fontWeight: 900 }}>3</span>
          </div>
          <div className="arena-identity-strip__profile">
            <div className="arena-identity-strip__avatar">{displayUsername[0]?.toUpperCase() ?? 'O'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
              <span className="arena-identity-strip__name">{displayUsername}</span>
              <span style={{ fontSize: '0.7rem', opacity: 0.5, fontWeight: 800, textTransform: 'uppercase' }}>112 ranked games</span>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.2, marginLeft: 4 }}><path d="M7 10l5 5 5-5z"/></svg>
          </div>
        </div>
      </div>

      {/* 1. MATCH HUD ROW */}
      <section className="arena-match-hud">
        <div className="hud-card is-opponent">
          <div className="hud-avatar">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="var(--rh-blue)"><path d="M12 2a5 5 0 1 0 5 5 5 5 0 0 0-5-5zm0 11c-4.42 0-8 2.58-8 6v1h16v-1c0-3.42-3.58-6-8-6z" /></svg>
          </div>
          <div className="hud-info-stack">
            <span className="hud-label">@{opponentLabel} GHOST</span>
            <span className="hud-score">{opponentScore}</span>
          </div>
          <div className="hud-rack-preview-wrap">
            <div style={{ display: 'flex', gap: 6 }}>
              {opponentHandPreview}
            </div>
            <span style={{ fontSize: '0.65rem', opacity: 0.5, fontWeight: 900, textTransform: 'uppercase' }}>{opponentHandCount} TILES</span>
          </div>
        </div>
        
        <div className="turn-badge-center">
          <div className="turn-pill">{isPlayerTurn ? 'YOUR MOVE' : 'BOT THINKING'}</div>
          <div className="turn-subpill">
             <span className="turn-subpill__value">{openEndsSum}</span>
             <span className="turn-subpill__label">OPEN ENDS</span>
          </div>
        </div>
        
        <div className="hud-card is-you">
          <div className="hud-info-stack" style={{ textAlign: 'right' }}>
            <span className="hud-label">YOU</span>
            <span className="hud-score">{playerScore}</span>
          </div>
          <div className="hud-avatar" style={{ marginLeft: 20, borderColor: 'var(--rh-gold)' }}>
             <div style={{ width: 32, height: 32, borderRadius: 6, background: '#fff', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '1.2rem' }}>R</div>
          </div>
        </div>
      </section>

      {/* 2. RACE SCORE TRACK */}
      <section className="arena-race-track">
        <div className="track-rail">
          <div className="track-medallion">
             <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 2.27 4.63 5.15 4.94C8.82 14.15 10.28 15.33 12 15.83V19H9v2h6v-2h-3v-3.17c1.72-.5 3.18-1.68 3.85-2.89C18.73 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2z"/></svg>
          </div>
          
          <div className="track-progress-container">
            <div className="track-marker" style={{ left: `${playerProgress}%` }} />
            <div className="track-progress-fill" style={{ width: `${playerProgress}%` }} />
          </div>
          
          <div className="track-milestones">
            {trackMilestones.map((m) => (
              <div key={m} className="milestone">
                <div style={{ width: 1.5, height: 8, background: 'var(--rh-gold)', opacity: 0.3, marginBottom: 4 }} />
                <span>{m}</span>
              </div>
            ))}
          </div>
          
          <div className="track-medallion" style={{ borderColor: '#fff', color: '#fff' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>
          </div>
          <div className="track-goal-chip">{trackTarget}</div>
        </div>
      </section>

      {/* 3. BOARD ARENA */}
      <main className="arena-body">
        <div className="board-arena-frame">
          <div className="board-surface-layer" />
          <div className="board-court-lines" />
          
          <div className="tiles-left-badge">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 11c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
               <span style={{ fontWeight: 900, fontSize: '1.4rem' }}>{boneyardCount}</span>
               <span style={{ fontSize: '0.7rem', opacity: 0.6, fontWeight: 800 }}>TILES LEFT</span>
            </div>
          </div>
          
          <div className="board-watermark">
            <svg viewBox="0 0 100 100" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M28 72 L28 32 L50 52 L72 32 L72 72" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
          
          <div className="surface-content">
            {boardContent}
          </div>
          
          {/* Side Lights */}
          <div className="arena-side-lights arena-side-lights--left">
            {[1,2,3].map(i => <div key={i} className="arena-side-lights__dot" />)}
          </div>
          <div className="arena-side-lights arena-side-lights--right">
            {[1,2,3].map(i => <div key={i} className="arena-side-lights__dot" />)}
          </div>
        </div>

        {/* 4. PLAYER HAND TRAY */}
        <div className="arena-hand-console">
          <div className="hand-rail">
            {handContent}
          </div>
        </div>
      </main>

      {/* 5. BOTTOM ACTION DOCK */}
      <footer className="arena-bottom-dock">
        <div className="dock-pod">
          <button className="dock-btn" onClick={onChat}>
            <svg className="dock-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span className="dock-btn__label">CHAT</span>
          </button>
          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.1)' }} />
          <button className="dock-btn" onClick={onToggleTheme}>
            <svg className="dock-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41m12.72-12.72l-1.41 1.41"/></svg>
            <span className="dock-btn__label">MORE</span>
          </button>
        </div>
        
        <div className="dock-pod is-center">
          <button className="dock-btn" onClick={onDraw} disabled={!canDraw}>
             <svg className="dock-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
             <span className="dock-btn__label">DRAW</span>
             <span style={{ fontSize: '0.75rem', opacity: 0.5, fontWeight: 700 }}>FROM BONEYARD</span>
          </button>
          
          <div style={{ width: 2, height: 48, background: 'rgba(255,255,255,0.1)' }} />
          
          <button className="dock-btn" onClick={onBlock} disabled={!canBlock}>
             <svg className="dock-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
             <span className="dock-btn__label">BLOCK</span>
             <span style={{ fontSize: '0.75rem', opacity: 0.5, fontWeight: 700 }}>OPPONENT</span>
          </button>
          
          <div style={{ width: 2, height: 48, background: 'rgba(255,255,255,0.1)' }} />
          
          <button className={`dock-btn ${showHints ? 'is-active' : ''}`} onClick={onHint} style={{ position: 'relative' }}>
             <svg className="dock-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18h6m-5 4h4m1-10a4 4 0 1 1-8 0 4 4 0 0 1 8 0z"/></svg>
             <span className="dock-btn__label">HINT</span>
             <span style={{ fontSize: '0.75rem', opacity: 0.5, fontWeight: 700 }}>SHOW MOVES</span>
             {hintCount > 0 && (
               <div style={{ position: 'absolute', top: -14, right: -18, background: 'var(--rh-cyan)', color: '#000', fontSize: '0.8rem', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', fontWeight: 900, boxShadow: '0 0 15px var(--rh-cyan)' }}>{hintCount}</div>
             )}
          </button>
        </div>
        
        <div className="dock-pod is-right">
          <button className="dock-btn" onClick={onSettings}>
            <svg className="dock-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1-2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span className="dock-btn__label">SETTINGS</span>
          </button>
          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.1)' }} />
          <button className="dock-btn" onClick={onExit}>
            <svg className="dock-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span className="dock-btn__label">EXIT MATCH</span>
          </button>
        </div>
      </footer>
    </div>
  );
};

export default RacehorseMatchArena;
