import { useState, useEffect } from 'react';
import LayoutScreen from '../ui/LayoutScreen';
import './learn.css';
import {
  loadAuthoringSession,
  loadFrozenLesson,
  compactFrozenLesson,
  saveFrozenLesson,
  type AuthoringSession,
  type FrozenLesson,
} from './guidedAuthoring';
import LessonDebugPanel from './LessonDebugPanel';

interface LearnHomeProps {
  onBack: () => void;
  onStartGuidedGame?: () => void;
  /** Admin-only: start the guided authoring flow */
  onStartGuidedAuthoring?: () => void;
  /**
   * Admin-only: promote the current authored session to the live frozen lesson.
   * Called when admin clicks "Freeze as Lesson".
   */
  onFreezeLesson?: () => void;
  isAdmin?: boolean;
}

const HOW_TO_PLAY_STEPS = [
  {
    num: '1',
    title: 'Start a Guided Game',
    desc: 'Tap the button to begin',
  },
  {
    num: '2',
    title: 'Follow the coach',
    desc: 'Master Fritz explains every move',
  },
  {
    num: '3',
    title: 'Learn as you play',
    desc: 'See your recap after each hand',
  },
];

const KEY_RULES = [
  'Match an open end to play a tile — or draw from the boneyard',
  'Score or play a double to keep your turn going',
];

export default function LearnHome({ onBack, onStartGuidedGame, onStartGuidedAuthoring, onFreezeLesson, isAdmin }: LearnHomeProps) {
  const [authoringSession, setAuthoringSession] = useState<AuthoringSession | null>(null);
  const [frozenLesson, setFrozenLesson] = useState<FrozenLesson | null>(null);
  const [freezeFlash, setFreezeFlash] = useState(false);
  const [compactFlash, setCompactFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    setAuthoringSession(loadAuthoringSession());
    setFrozenLesson(loadFrozenLesson());
  }, [isAdmin]);

  const handleFreeze = () => {
    if (!onFreezeLesson) return;
    onFreezeLesson();
    setFrozenLesson(loadFrozenLesson());
    setFreezeFlash(true);
    setTimeout(() => setFreezeFlash(false), 2000);
  };

  const handleCompact = () => {
    const removed = compactFrozenLesson();
    const updated = loadFrozenLesson();
    setFrozenLesson(updated);
    if (removed === null) {
      setCompactFlash('No frozen lesson');
    } else if (removed === 0) {
      setCompactFlash('Already clean');
    } else {
      setCompactFlash(`Removed ${removed} draft${removed !== 1 ? 's' : ''} · ${updated?.steps.length ?? 0} steps`);
    }
    setTimeout(() => setCompactFlash(null), 3500);
  };

  /**
   * Promote the live authoring session to the frozen lesson directly —
   * bypasses the onFreezeLesson prop so the admin can do it without
   * going through App.tsx (which always re-reads from authoring storage anyway).
   */
  const handlePromote = () => {
    const session = loadAuthoringSession();
    if (!session) return;
    saveFrozenLesson(session);
    setAuthoringSession(session);
    setFrozenLesson(loadFrozenLesson());
  };

  return (
    <LayoutScreen
      className="ghost-setup-screen mode-subpage-screen mode-accent-ghost"
      title="Learn Racehorse"
      subtitle="Play a real game. Get coached every turn."
      contentClassName="screen-shell ghost-setup-content"
    >
      <div className="ghost-setup-grid learn-columns">
        <div className="ghost-setup-left-col learn-col">
          <div className="learn-home-top">
            <button className="mode-inline-btn" onClick={onBack}>
              ← Back
            </button>
          </div>
          <h3 className="learn-col-heading">HOW TO PLAY</h3>
          <div className="learn-steps">
            {HOW_TO_PLAY_STEPS.map((step) => (
              <div key={step.num} className="learn-step-card">
                <span className="learn-step-num">{step.num}</span>
                <div className="learn-step-body">
                  <span className="learn-step-title">{step.title}</span>
                  <span className="learn-step-desc">{step.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="ghost-setup-middle-col learn-col">
          <h3 className="learn-col-heading">HOW SCORING WORKS</h3>
          <p className="learn-score-note">
            Add up all open ends on the board. If the total is a multiple of 5, divide by 5
            {' '}— that's your score. Open ends sum to 10? You score 2 points. Sum to 15?
            {' '}You score 3 points. First player to 60 wins.
          </p>

          <h3 className="learn-col-heading learn-col-heading-spaced">KEY RULES</h3>
          {KEY_RULES.map((rule) => (
            <p key={rule} className="learn-rule-row">{rule}</p>
          ))}
        </div>

        <div className="ghost-setup-right-col learn-col learn-col-cta">
          <h3 className="learn-col-heading">GUIDED GAME</h3>
          {onStartGuidedGame ? (
            <button className="learn-start-guided-btn" onClick={onStartGuidedGame}>
              Start Guided Game
            </button>
          ) : null}
          <p className="learn-cta-sub">vs Rookie Fritz · Master Fritz coaches every turn</p>

          {isAdmin ? (
            <div style={{ marginTop: 28 }}>
              <h3 className="learn-col-heading" style={{ marginBottom: 8 }}>ADMIN</h3>

              {onStartGuidedAuthoring && (
                <button
                  className="learn-start-guided-btn"
                  onClick={onStartGuidedAuthoring}
                  style={{
                    background: 'rgba(255,200,60,0.13)',
                    border: '1.5px solid rgba(255,200,60,0.32)',
                    color: 'rgba(255,220,100,0.92)',
                    marginBottom: 6,
                  }}
                >
                  ✏️ Guided Authoring
                </button>
              )}
              <p className="learn-cta-sub" style={{ marginBottom: 10 }}>
                vs Elite Fritz · attach coaching notes to each turn
              </p>

              {/* Readiness status */}
              <div style={{
                fontSize: '0.72rem',
                color: 'rgba(200,230,210,0.6)',
                lineHeight: 1.6,
                marginBottom: 8,
              }}>
                <div>
                  Authored steps:{' '}
                  <strong style={{ color: 'rgba(255,220,100,0.9)' }}>
                    {authoringSession ? authoringSession.steps.length : '—'}
                  </strong>
                </div>
                <div>
                  Frozen lesson steps:{' '}
                  <strong style={{ color: frozenLesson ? 'rgba(100,240,160,0.9)' : 'rgba(255,120,80,0.8)' }}>
                    {frozenLesson ? frozenLesson.steps.length : 'none'}
                  </strong>
                </div>
              </div>

              {onFreezeLesson && (
                <button
                  className="learn-start-guided-btn"
                  onClick={handleFreeze}
                  style={{
                    background: freezeFlash
                      ? 'rgba(60,220,120,0.22)'
                      : 'rgba(60,180,120,0.14)',
                    border: freezeFlash
                      ? '1.5px solid rgba(60,220,120,0.5)'
                      : '1.5px solid rgba(60,180,120,0.32)',
                    color: freezeFlash
                      ? 'rgba(100,255,160,0.95)'
                      : 'rgba(120,230,170,0.88)',
                    marginBottom: 4,
                  }}
                >
                  {freezeFlash ? '✓ Frozen!' : '❄️ Freeze as Lesson'}
                </button>
              )}
              <p className="learn-cta-sub" style={{ marginBottom: 8 }}>
                Promotes authored session → live guided lesson
              </p>

              {/* Compact: strips null-chosenMove draft steps and re-indexes */}
              <button
                className="learn-start-guided-btn"
                onClick={handleCompact}
                style={{
                  background: compactFlash
                    ? 'rgba(180,120,255,0.22)'
                    : 'rgba(120,80,200,0.13)',
                  border: compactFlash
                    ? '1.5px solid rgba(180,120,255,0.5)'
                    : '1.5px solid rgba(120,80,200,0.28)',
                  color: compactFlash
                    ? 'rgba(210,170,255,0.95)'
                    : 'rgba(180,140,240,0.82)',
                  fontSize: '0.78rem',
                }}
              >
                {compactFlash ?? '🔧 Compact Frozen Lesson'}
              </button>
              <p className="learn-cta-sub">
                Strips stale draft steps · fixes step→note mapping
              </p>

              {/* Full inspector: shows both storage objects + promote button */}
              <LessonDebugPanel onPromote={handlePromote} />
            </div>
          ) : null}
        </div>
      </div>
    </LayoutScreen>
  );
}
