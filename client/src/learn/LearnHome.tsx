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
import {
  ClaudeModeScreen,
  ClaudePrimaryAction,
  ClaudeSecondaryAction,
  ClaudeSectionLabel,
  ClaudeStatLine,
} from '../ui/claudeMode';

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
      <div className="screen learn-home-screen mode-subpage-screen mode-accent-learn claude-mode-screen-shell">
        <ClaudeModeScreen
          accent="#22d3ee"
          eyebrow="Learn"
          title={'GUIDED\nMATCH'}
          description="One coached match that teaches strong play one move at a time. Coach Oliver narrates every turn — from opening tempo to closing the board."
          decor="L"
          backLabel="Back to Home"
          onBack={onBack}
          heroFooter={
            <div className="claude-mode-chip-row">
              <span className="claude-mode-chip">60 Turns</span>
              <span className="claude-mode-chip">Coaching Every Move</span>
              <span className="claude-mode-chip">Fixed Lesson</span>
            </div>
          }
          panel={
            <div className="claude-mode-panel-stack">
              <ClaudeSectionLabel>Lesson Brief</ClaudeSectionLabel>
              <ClaudeStatLine label="Format" value="Single Guided Game" />
              <ClaudeStatLine label="Coach" value="Oliver · Master" accent="#22d3ee" />
              <ClaudeStatLine label="Length" value="~22 minutes" />
              <ClaudeStatLine label="Last Played" value={guestPreviewMoment.turnLabel} />

              <div className="learn-landing-preview">
                <div className="learn-landing-preview__head">
                  <ClaudeSectionLabel>Preview</ClaudeSectionLabel>
                  <span className="learn-landing-preview__turn-label">{guestPreviewMoment.turnLabel}</span>
                </div>

                <div className="learn-landing-preview__rail">
                  <div
                    className="learn-landing-preview__fill"
                    style={{ width: `${guestPreviewMoment.progress * 100}%` }}
                  />
                </div>

                <div className="learn-landing-preview__board">
                  <Board
                    board={guestPreviewMoment.board}
                    legalMoves={[]}
                    selectedTile={null}
                    onPositionClick={() => {}}
                    tileSize={64}
                    showOpenEndGlow={false}
                  />
                </div>

                <div className="learn-landing-preview__note">
                  <div className="learn-landing-preview__note-mark">Coach Note · {guestPreviewMoment.turnLabel.split(' / ')[0]}</div>
                  <div className="learn-landing-preview__note-text">{guestPreviewMoment.coachingText}</div>
                </div>
              </div>

              <ClaudePrimaryAction
                accent="#22d3ee"
                title="Start Guided Game"
                meta={`Resume from ${guestPreviewMoment.turnLabel} — Coach Oliver`}
                onClick={onStartGuidedV2Game}
                disabled={!onStartGuidedV2Game}
              />
              <ClaudeSecondaryAction
                title="Back"
                meta="Return to game mode menu"
                onClick={onBack}
              />
            </div>
          }
        />
      </div>
    );
  }

  return (
    <LayoutScreen
      className="ghost-setup-screen mode-subpage-screen mode-accent-ghost"
      title="Learn Racehorse"
      subtitle="Build one fixed coached match cleanly."
      contentClassName="multiplayer-menu-card screen-shell"
    >
      <div className="learn-columns">
        <div className="learn-col">
          <h3 className="learn-col-heading">AUTHOR</h3>
          <button className="learn-start-guided-btn" onClick={onStartAuthoringV2}>
            Start V2 Authoring Session
          </button>
          <p className="learn-cta-sub">
            Build the event timeline for the new guided match system.
          </p>
        </div>
        <div className="learn-col">
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
