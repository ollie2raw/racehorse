import { useEffect, useMemo, useState } from 'react';
import LayoutScreen from '../ui/LayoutScreen';
import { Board } from '../components';
import type { BoardState } from '../types';
import './learn.css';
import {
  freezeV2Lesson,
  loadV2AuthoringSession,
  loadV2FrozenLesson,
  parseLessonV2BoardState,
  type LessonV2,
  type LessonV2Event,
  type LessonV2AuthoringSession,
} from './lessonV2';
import { GUIDED_LESSON_COACHING_BY_VISIBLE_STEP } from './guidedLessonNotes';

const GUEST_LEARN_PREVIEW_BOARD: BoardState = {
  mainLine: [
    { tile: { low: 0, high: 5 }, orientation: 'horizontal-normal' },
    { tile: { low: 1, high: 5 }, orientation: 'horizontal-flipped' },
    { tile: { low: 1, high: 1 }, orientation: 'vertical-normal' },
    { tile: { low: 1, high: 6 }, orientation: 'horizontal-normal' },
    { tile: { low: 3, high: 6 }, orientation: 'horizontal-flipped' },
    { tile: { low: 3, high: 5 }, orientation: 'horizontal-normal' },
  ],
  leftEnd: 0,
  rightEnd: 5,
  leftEndIsDouble: false,
  rightEndIsDouble: false,
  hubDoubles: [],
};

const GUEST_LEARN_PREVIEW_FALLBACK = {
  board: GUEST_LEARN_PREVIEW_BOARD,
  coachingText: GUIDED_LESSON_COACHING_BY_VISIBLE_STEP[0] ?? "There are a few good openings here.",
  turnLabel: 'Turn 2 / 60',
  progress: 2 / 60,
};

function countBoardTiles(board: BoardState | null): number {
  if (!board) return 0;
  return (
    board.mainLine.length +
    board.hubDoubles.reduce(
      (sum, hub) => sum + hub.branches.reduce((branchSum, branch) => branchSum + branch.tiles.length, 0),
      0,
    )
  );
}

function shortenCoachingPreview(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const sentences = trimmed.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length > 0) {
    const first = sentences[0]!.trim();
    if (first.length >= 40) return first;
    const second = sentences[1]?.trim();
    if (second) return `${first} ${second}`;
    return first;
  }
  return trimmed;
}

function pickPreviewMoment(lesson: LessonV2 | null): {
  board: BoardState;
  coachingText: string;
  turnLabel: string;
  progress: number;
} | null {
  if (!lesson) return null;
  const playerPlayEvents = lesson.events.filter(
    (event): event is LessonV2Event =>
      event.actor === 'player' && event.action === 'play' && Boolean(event.coachingText.trim()),
  );
  if (playerPlayEvents.length === 0) return null;

  const preferred =
    playerPlayEvents.find((event) => {
      const board = parseLessonV2BoardState(event.boardAfter);
      const tileCount = countBoardTiles(board);
      return board != null && tileCount >= 5 && tileCount <= 8;
    }) ?? playerPlayEvents.find((event) => parseLessonV2BoardState(event.boardAfter) != null);

  if (!preferred) return null;

  const board = parseLessonV2BoardState(preferred.boardAfter);
  if (!board) return null;

  const turnIndex = playerPlayEvents.findIndex((event) => event.eventIndex === preferred.eventIndex);
  const totalTurns = playerPlayEvents.length;
  const turnNumber = turnIndex >= 0 ? turnIndex + 1 : 1;

  return {
    board,
    coachingText: shortenCoachingPreview(preferred.coachingText),
    turnLabel: `Turn ${turnNumber} / ${totalTurns}`,
    progress: totalTurns > 0 ? turnNumber / totalTurns : 0,
  };
}

interface LearnHomeProps {
  onBack: () => void;
  onStartGuidedGame?: () => void;
  onStartGuidedAuthoring?: () => void;
  onFreezeLesson?: () => void;
  isAdmin?: boolean;
  showAdminView?: boolean;
  onStartGuidedV2Game?: () => void;
  onStartAuthoringV2?: () => void;
}

export default function LearnHome({
  onBack,
  onStartGuidedGame: _onStartGuidedGame,
  onStartGuidedAuthoring: _onStartGuidedAuthoring,
  onFreezeLesson: _onFreezeLesson,
  isAdmin,
  showAdminView = false,
  onStartGuidedV2Game,
  onStartAuthoringV2,
}: LearnHomeProps) {
  const [v2AuthoringSession, setV2AuthoringSession] = useState<LessonV2AuthoringSession | null>(null);
  const [v2FrozenLesson, setV2FrozenLesson] = useState<LessonV2 | null>(null);
  const [v2FreezeFlash, setV2FreezeFlash] = useState(false);

  useEffect(() => {
    setV2FrozenLesson(loadV2FrozenLesson());
    if (!isAdmin || !showAdminView) return;
    setV2AuthoringSession(loadV2AuthoringSession());
  }, [isAdmin, showAdminView]);

  const guestPreviewMoment = useMemo(
    () => pickPreviewMoment(v2FrozenLesson) ?? GUEST_LEARN_PREVIEW_FALLBACK,
    [v2FrozenLesson],
  );

  const handleFreezeV2 = () => {
    const session = loadV2AuthoringSession();
    if (!session) return;
    const frozen = freezeV2Lesson(session);
    setV2AuthoringSession(session);
    setV2FrozenLesson(frozen);
    setV2FreezeFlash(true);
    setTimeout(() => setV2FreezeFlash(false), 2000);
  };

  if (!isAdmin || !showAdminView) {
    return (
      <LayoutScreen
        className="ghost-setup-screen mode-subpage-screen mode-accent-ghost learn-home-guest-screen"
        title="Learn Racehorse"
        subtitle="One guided match that teaches how strong players think, one move at a time."
        contentClassName="multiplayer-menu-card screen-shell learn-home-guest-content"
      >
        <div className="learn-guest-shell">
          <section className="learn-guest-feature-card">
            <div className="learn-guest-feature-rail">
              <span className="learn-guest-feature-label">Featured Lesson</span>
              <span className="learn-guest-mode-pill">Guided Match</span>
            </div>

            <div className="learn-guest-feature-layout">
              <div className="learn-guest-feature-main">
                <div className="learn-guest-feature-copy">
                  <h2 className="learn-guest-feature-title">Fixed Guided Match</h2>
                  <p className="learn-guest-feature-text">
                    Play through one fully coached game from start to finish, with a teaching note on every move.
                  </p>
                </div>

                <div className="learn-guest-chip-row">
                  <span className="learn-guest-chip">60 guided turns</span>
                  <span className="learn-guest-chip">Coach on every move</span>
                  <span className="learn-guest-chip">Learn at your own pace</span>
                </div>

                <div className="learn-guest-action-row">
                  {onStartGuidedV2Game ? (
                    <button className="learn-start-guided-btn learn-guest-primary-cta" onClick={onStartGuidedV2Game}>
                      Start Guided Game
                    </button>
                  ) : (
                    <button className="learn-start-guided-btn learn-guest-primary-cta" disabled>
                      Guided Lesson Unavailable
                    </button>
                  )}
                  <button className="mode-option mode-option-secondary learn-guest-back-action" onClick={onBack}>
                    <span className="mode-option-title">Back</span>
                    <span className="mode-option-meta">Return to game mode menu</span>
                  </button>
                </div>
              </div>

              <aside className="learn-guest-preview-panel" aria-hidden="true">
                <div className="learn-guest-preview-head">
                  <span className="learn-guest-preview-title">Preview</span>
                </div>

                <div className="learn-guest-preview-progress">
                  <span className="learn-guest-preview-turn">{guestPreviewMoment.turnLabel}</span>
                  <div className="learn-guest-preview-progressbar">
                    <span
                      className="learn-guest-preview-progressfill"
                      style={{ width: `${Math.max(16, guestPreviewMoment.progress * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="learn-guest-preview-board">
                  <div className="learn-guest-preview-board-shell">
                    <Board
                      board={guestPreviewMoment.board}
                      legalMoves={[]}
                      selectedTile={null}
                      onPositionClick={() => {}}
                      tileSize={68}
                      showOpenEndGlow={false}
                    />
                  </div>
                </div>

                <div className="learn-guest-preview-coach">
                  <span className="learn-guest-preview-coach-label">Coach Oliver</span>
                  <p className="learn-guest-preview-coach-line">
                    {guestPreviewMoment.coachingText}
                  </p>
                </div>
              </aside>
            </div>

            {onStartGuidedV2Game ? (
              <p className="learn-guest-helper">Start whenever you want and move through it at your own pace.</p>
            ) : (
              <p className="learn-guest-helper">The guided lesson is not published yet.</p>
            )}
          </section>
        </div>
      </LayoutScreen>
    );
  }

  return (
    <LayoutScreen
      className="ghost-setup-screen mode-subpage-screen mode-accent-ghost"
      title="Learn Racehorse"
      subtitle="Build one fixed coached match cleanly."
      contentClassName="screen-shell ghost-setup-content"
    >
      <div className="ghost-setup-grid learn-columns">
        <div className="ghost-setup-left-col learn-col">
          <div className="learn-home-top">
            <button className="mode-inline-btn" onClick={onBack}>
              ← Back
            </button>
          </div>

          <h3 className="learn-col-heading">FIXED LESSON</h3>
          <p className="learn-score-note" style={{ marginBottom: 18 }}>
            One authored match. One coaching tip on every player move. No fallback runtime.
          </p>

          {onStartGuidedV2Game ? (
            <>
              <button className="learn-start-guided-btn" onClick={onStartGuidedV2Game}>
                Start Guided Game
              </button>
              <p className="learn-cta-sub">Plays the fixed event timeline only</p>
            </>
          ) : (
            <p className="learn-cta-sub">No fixed lesson published yet.</p>
          )}
        </div>

        <div className="ghost-setup-middle-col learn-col">
          <h3 className="learn-col-heading">AUTHORING</h3>
          <p className="learn-score-note" style={{ marginBottom: 14 }}>
            Build the lesson move by move, then freeze it when the full timeline is correct.
          </p>

          {isAdmin && onStartAuthoringV2 ? (
            <button
              className="learn-start-guided-btn"
              onClick={onStartAuthoringV2}
              style={{
                background: 'rgba(255,200,60,0.13)',
                border: '1.5px solid rgba(255,200,60,0.32)',
                color: 'rgba(255,220,100,0.92)',
                marginBottom: 8,
              }}
            >
              ✏️ Author Fixed Lesson
            </button>
          ) : null}

          <div style={{ fontSize: '0.78rem', color: 'rgba(200,230,210,0.72)', lineHeight: 1.7 }}>
            <div>
              Authored events:{' '}
              <strong style={{ color: 'rgba(255,220,100,0.92)' }}>
                {v2AuthoringSession ? v2AuthoringSession.events.length : '—'}
              </strong>
            </div>
            <div>
              Published events:{' '}
              <strong style={{ color: v2FrozenLesson ? 'rgba(100,240,160,0.92)' : 'rgba(255,120,80,0.84)' }}>
                {v2FrozenLesson ? v2FrozenLesson.events.length : 'none'}
              </strong>
            </div>
          </div>
        </div>

        <div className="ghost-setup-right-col learn-col learn-col-cta">
          {isAdmin ? (
            <>
              <h3 className="learn-col-heading">PUBLISH</h3>
              <button
                className="learn-start-guided-btn"
                onClick={handleFreezeV2}
                disabled={!v2AuthoringSession}
                style={{
                  background: v2FreezeFlash
                    ? 'rgba(60,220,120,0.22)'
                    : 'rgba(60,180,120,0.14)',
                  border: v2FreezeFlash
                    ? '1.5px solid rgba(60,220,120,0.5)'
                    : '1.5px solid rgba(60,180,120,0.32)',
                  color: v2FreezeFlash
                    ? 'rgba(100,255,160,0.95)'
                    : 'rgba(120,230,170,0.88)',
                  opacity: v2AuthoringSession ? 1 : 0.6,
                }}
              >
                {v2FreezeFlash ? '✓ Lesson Frozen' : '❄️ Freeze Fixed Lesson'}
              </button>
              <p className="learn-cta-sub">
                Promotes the authored event timeline to the live guided lesson
              </p>
            </>
          ) : null}
        </div>
      </div>
    </LayoutScreen>
  );
}
