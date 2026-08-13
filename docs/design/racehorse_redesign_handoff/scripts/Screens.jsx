/* global React, Tile */
const { useState: useStateLearn } = React;

// ─── Topbar (shared) ────────────────────────────────────────────────
function Topbar({ accent, sub, onBack, backLabel = 'Back to Home' }) {
  return (
    <header className="rh-topbar">
      <div className="rh-brand">
        <span className="rh-brand__dot" style={accent ? { background: accent, boxShadow: `0 0 12px ${accent}` } : undefined} />
        Racehorse
        {sub ? (<><span className="rh-brand__divider" /><span className="rh-brand__sub">{sub}</span></>) : null}
      </div>
      <button type="button" className="rh-back" onClick={onBack}>
        <span className="rh-back__arrow">←</span>
        <span>{backLabel}</span>
      </button>
    </header>
  );
}
window.Topbar = Topbar;

// ─── SCREEN 1: Learn landing ────────────────────────────────────────
function LearnLanding({ onStart, onBack }) {
  const accent = 'var(--rh-cyan)';
  const accentRgb = 'var(--rh-cyan-rgb)';
  const previewBoard = [
    { l: 0, h: 5 }, { l: 5, h: 1 }, { l: 1, h: 1, v: true }, { l: 1, h: 6 }, { l: 6, h: 3 },
  ];
  return (
    <div className="rh-page" style={{ '--rh-accent': accent, '--rh-accent-rgb': accentRgb }}>
      <Topbar accent="var(--rh-cyan)" sub="Learn Mode" onBack={onBack} backLabel="Back to Home" />
      <div className="rh-shell">
        <div className="rh-hero">
          <div className="rh-hero__decor">L</div>
          <div className="rh-hero__content">
            <p className="rh-eyebrow">Learn</p>
            <h1 className="rh-hero__title">{`GUIDED\nMATCH`}</h1>
            <p className="rh-hero__description">
              One coached match that teaches strong play one move at a time. Coach Oliver narrates
              every turn — from opening tempo to closing the board.
            </p>
            <div className="rh-hero__footer">
              <div className="rh-chip-row">
                <span className="rh-chip rh-chip--accent">60 Turns</span>
                <span className="rh-chip">Coaching Every Move</span>
                <span className="rh-chip">Fixed Lesson</span>
              </div>
            </div>
          </div>
        </div>

        <div className="rh-panel">
          <div className="rh-section-label">Lesson Brief</div>

          <div>
            <div className="rh-stat">
              <span className="rh-stat__label">Format</span>
              <span className="rh-stat__value">Single Guided Game</span>
            </div>
            <div className="rh-stat">
              <span className="rh-stat__label">Coach</span>
              <span className="rh-stat__value rh-stat__value--accent">Oliver · Master</span>
            </div>
            <div className="rh-stat">
              <span className="rh-stat__label">Length</span>
              <span className="rh-stat__value">~22 minutes</span>
            </div>
            <div className="rh-stat">
              <span className="rh-stat__label">Last Played</span>
              <span className="rh-stat__value">Turn 2 / 60</span>
            </div>
          </div>

          <div className="rh-preview">
            <div className="rh-preview__head">
              <span className="rh-section-label" style={{ margin: 0 }}>Preview</span>
              <span className="rh-stat__value" style={{ color: 'var(--rh-cyan)', fontSize: 13 }}>Turn 2 / 60</span>
            </div>

            <div className="rh-progress">
              <div className="rh-progress__rail">
                <div className="rh-progress__fill" style={{ width: '3.3%' }} />
              </div>
            </div>

            <div className="rh-preview__board">
              <div className="rh-board__chain">
                {previewBoard.map((t, i) => (
                  <Tile key={i} low={t.l} high={t.h} orientation={t.v ? 'v' : 'h'} size="sm" />
                ))}
              </div>
            </div>

            <div className="rh-preview__note">
              <div>
                <div className="rh-preview__note-mark">Coach Note · Turn 2</div>
                There are a few good openings here. Hold the heavy doubles for now and pressure the
                fives — that's the side opponent can't match yet.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 'auto' }}>
            <button type="button" className="rh-btn-primary" onClick={onStart}>
              <span className="rh-btn-primary__title">Start Guided Game</span>
              <span className="rh-btn-primary__meta">Resume from Turn 2 / 60 — Coach Oliver</span>
            </button>
            <button type="button" className="rh-btn-secondary" onClick={onBack}>
              <span className="rh-btn-secondary__title">Back</span>
              <span className="rh-btn-secondary__meta">Return to game mode menu</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
window.LearnLanding = LearnLanding;

// ─── SCREEN 2: Guided learn match ──────────────────────────────────
function LearnMatch({ onLeave, onBack }) {
  const [selected, setSelected] = useStateLearn(2);
  const [showRec, setShowRec] = useStateLearn(true);

  // Simulated state
  const turn = 18;
  const total = 60;
  const playedPct = (turn / total) * 100;
  const rack = [
    { l: 0, h: 4 }, { l: 2, h: 6 }, { l: 4, h: 4 }, { l: 1, h: 3 }, { l: 5, h: 2 }, { l: 6, h: 6 }, { l: 0, h: 1 },
  ];
  const board = [
    { l: 3, h: 6 }, { l: 6, h: 6, v: true }, { l: 6, h: 1 }, { l: 1, h: 5 }, { l: 5, h: 5, v: true },
    { l: 5, h: 2 }, { l: 2, h: 4 }, { l: 4, h: 0 }, { l: 0, h: 0, v: true },
  ];

  return (
    <div className="rh-page" style={{ '--rh-accent': 'var(--rh-cyan)', '--rh-accent-rgb': 'var(--rh-cyan-rgb)' }}>
      <header className="rh-topbar rh-topbar--match">
        <div className="rh-brand">
          <span className="rh-brand__dot" />
          Racehorse
          <span className="rh-brand__divider" />
          <span className="rh-brand__sub">Guided Match</span>
        </div>
        <div className="rh-topbar__center">
          <span>Turn <strong>{turn} / {total}</strong></span>
          <span className="rh-topbar__center-divider" />
          <span>Score <strong>42</strong></span>
          <span className="rh-topbar__center-divider" />
          <span>Open <strong>3 · 4</strong></span>
        </div>
        <button type="button" className="rh-back" onClick={onLeave}>
          <span className="rh-back__arrow">⏻</span>
          <span>Leave</span>
        </button>
      </header>

      <div className="rh-match">
        <aside className="rh-match__coach">
          <div className="rh-coach__avatar">
            <div className="rh-coach__avatar-mark">O</div>
            <div className="rh-coach__avatar-meta">
              <span className="rh-coach__avatar-sub">Coach</span>
              <span className="rh-coach__avatar-name">Oliver · Master</span>
            </div>
          </div>

          <div className="rh-progress">
            <div className="rh-progress__head">
              <span>Lesson Progress</span>
              <strong>{turn} / {total}</strong>
            </div>
            <div className="rh-progress__rail">
              <div className="rh-progress__fill" style={{ width: `${playedPct}%` }} />
            </div>
            <div className="rh-tickrail">
              {Array.from({ length: 60 }, (_, i) => (
                <span
                  key={i}
                  className={[
                    'rh-tickrail__tick',
                    i < turn - 1 ? 'is-played' : '',
                    i === turn - 1 ? 'is-current' : '',
                  ].filter(Boolean).join(' ')}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="rh-eyebrow">Your Move</p>
            <h2 className="rh-coach__heading">PRESSURE THE FOUR</h2>
            <p className="rh-coach__body">
              Both ends are open at <strong>3</strong> and <strong>4</strong>. Your opponent has
              passed once on fours, so the four-side is starving them. Don't rush the heavy double-six —
              keep it as a closer. Play <strong>4-2</strong> to stay on the four-side and force another
              squeeze.
            </p>
          </div>

          {showRec ? (
            <div className="rh-coach__rec">
              <div className="rh-coach__rec-head">
                <span className="rh-section-label" style={{ margin: 0 }}>Recommended</span>
                <span className="rh-stat__value" style={{ color: 'var(--rh-cyan)', fontSize: 12 }}>+5 confidence</span>
              </div>
              <div className="rh-coach__rec-tile">
                <Tile low={4} high={2} size="sm" />
                <span className="rh-stat__value" style={{ fontSize: 14, letterSpacing: '0.06em' }}>Play 4 · 2 on right end</span>
              </div>
              <button type="button" className="rh-btn-primary-sm" style={{ alignSelf: 'flex-start', padding: '10px 16px' }} onClick={() => setSelected(4)}>
                Show Best Move
              </button>
            </div>
          ) : null}

          <button
            type="button"
            className="rh-btn-secondary"
            style={{ marginTop: 'auto' }}
            onClick={() => setShowRec((s) => !s)}
          >
            <span className="rh-btn-secondary__title">{showRec ? 'Hide Recommendation' : 'Show Recommendation'}</span>
            <span className="rh-btn-secondary__meta">Toggle Coach's suggested move</span>
          </button>
        </aside>

        <div className="rh-match__board-pane">
          <div className="rh-match__board-head">
            <div className="rh-section-label">Board · Turn {turn}</div>
            <div className="rh-chip-row">
              <span className="rh-chip rh-chip--accent">Left End: 3</span>
              <span className="rh-chip rh-chip--accent">Right End: 4</span>
            </div>
          </div>

          <div className="rh-board">
            <span className="rh-board__corner rh-board__corner--tl" />
            <span className="rh-board__corner rh-board__corner--tr" />
            <span className="rh-board__corner rh-board__corner--bl" />
            <span className="rh-board__corner rh-board__corner--br" />
            <span className="rh-board__decor">L</span>

            <div className="rh-board__open-end rh-board__open-end--left">↤ 3</div>
            <div className="rh-board__open-end rh-board__open-end--right">4 ↦</div>

            <div className="rh-board__chain">
              {board.map((t, i) => (
                <Tile key={i} low={t.l} high={t.h} orientation={t.v ? 'v' : 'h'} />
              ))}
            </div>
          </div>

          <div className="rh-match__hand-head">
            <div className="rh-section-label">Your Hand</div>
            <div className="rh-chip-row">
              <span className="rh-chip">7 Tiles</span>
              <span className="rh-chip">2 Playable</span>
            </div>
          </div>

          <div className="rh-rack">
            {rack.map((t, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSelected(i)}
                className={[
                  'rh-rack__tile-wrap',
                  selected === i ? 'is-selected' : '',
                  i === 4 && showRec ? 'is-recommended' : '',
                ].filter(Boolean).join(' ')}
                style={{ background: 'transparent', border: 0, padding: 0 }}
              >
                <Tile low={t.l} high={t.h} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
window.LearnMatch = LearnMatch;

// ─── SCREEN 3: Leave-game modal ────────────────────────────────────
function LeaveModal({ onCancel, onLeave }) {
  return (
    <div
      className="rh-modal-overlay"
      onClick={onCancel}
      style={{ '--rh-accent': 'var(--rh-coral)', '--rh-accent-rgb': 'var(--rh-coral-rgb)' }}
    >
      <div className="rh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rh-modal__decor">!</div>
        <div className="rh-modal__warn-icon">!</div>
        <p className="rh-modal__eyebrow">Confirm</p>
        <h2 className="rh-modal__title">{`LEAVE\nGAME?`}</h2>
        <p className="rh-modal__copy">
          Your progress in this hand will be lost. The match will be marked as abandoned and
          won't count toward your streak.
        </p>
        <div className="rh-modal__buttons">
          <button type="button" className="rh-btn-cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="rh-btn-leave" onClick={onLeave}>Leave Game</button>
        </div>
      </div>
    </div>
  );
}
window.LeaveModal = LeaveModal;

// ─── SCREEN 4: Daily-puzzle complete modal ─────────────────────────
function DailyResultModal({ onPlayAgain, onHome }) {
  const leaderboard = [
    { rank: 1, name: 'horsegirl',   initials: 'HG', score: 78, moves: 6, time: '01:42' },
    { rank: 2, name: 'fritzhater',  initials: 'FH', score: 74, moves: 7, time: '02:08' },
    { rank: 3, name: 'doubleSix',   initials: 'D6', score: 72, moves: 6, time: '01:55' },
    { rank: 4, name: 'you',         initials: 'YOU', score: 68, moves: 6, time: '02:14', you: true },
    { rank: 5, name: 'pipfriend',   initials: 'PF', score: 64, moves: 7, time: '02:31' },
    { rank: 6, name: 'tilewatcher', initials: 'TW', score: 60, moves: 7, time: '02:47' },
  ];
  return (
    <div
      className="rh-modal-overlay"
      onClick={onHome}
      style={{ '--rh-accent': 'var(--rh-amber)', '--rh-accent-rgb': 'var(--rh-amber-rgb)' }}
    >
      <div className="rh-modal rh-result" onClick={(e) => e.stopPropagation()}>
        <div className="rh-result__head">
          <p className="rh-eyebrow" style={{ margin: 0 }}>Daily Puzzle Complete</p>
          <div className="rh-result__score">
            68
            <span className="rh-result__score-suffix">Final Score</span>
          </div>
          <div className="rh-result__feedback">★ Great solve · 87% of best</div>
        </div>

        <div className="rh-result__summary">
          <div>
            <span className="rh-result__summary-label">Your Score</span>
            <span className="rh-result__summary-value">68</span>
          </div>
          <div>
            <span className="rh-result__summary-label">Best Possible</span>
            <span className="rh-result__summary-value">78</span>
          </div>
          <div>
            <span className="rh-result__summary-label">Streak</span>
            <span className="rh-result__summary-value">12 days</span>
          </div>
        </div>

        <div className="rh-result__board">
          <div className="rh-result__board-head">
            <span className="rh-section-label" style={{ margin: 0 }}>Global Leaderboard</span>
            <span className="rh-stat__label">May 6 · Top 6 of 1,243</span>
          </div>

          <div className="rh-result__lb">
            <div className="rh-result__lb-head">
              <span>#</span>
              <span>Player</span>
              <span style={{ textAlign: 'right' }}>Score</span>
              <span style={{ textAlign: 'right' }}>Moves</span>
              <span style={{ textAlign: 'right' }}>Time</span>
            </div>
            {leaderboard.map((row) => (
              <div key={row.rank} className={`rh-result__lb-row ${row.you ? 'is-you' : ''}`}>
                <span className="rh-result__lb-rank">
                  {row.rank <= 3 ? <span className="rh-medal">{['I','II','III'][row.rank - 1]}</span> : row.rank}
                </span>
                <span className="rh-result__lb-name">
                  <span className="rh-result__avatar">{row.initials}</span>
                  <span>@{row.name}</span>
                  {row.you ? <span className="rh-you-pill">You</span> : null}
                </span>
                <span className="rh-result__lb-num">{row.score}</span>
                <span className="rh-result__lb-num">{row.moves}</span>
                <span className="rh-result__lb-num">{row.time}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rh-result__actions">
          <button type="button" className="rh-btn-primary-sm" onClick={onPlayAgain}>Play Again</button>
          <button type="button" className="rh-btn-secondary-sm" onClick={onHome}>Back to Home</button>
        </div>
      </div>
    </div>
  );
}
window.DailyResultModal = DailyResultModal;
