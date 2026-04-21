import { useEffect, useState } from 'react';
import LayoutScreen from '../ui/LayoutScreen';
import './learn.css';
import {
  freezeV2Lesson,
  loadV2AuthoringSession,
  loadV2FrozenLesson,
  type LessonV2,
  type LessonV2AuthoringSession,
} from './lessonV2';

interface LearnHomeProps {
  onBack: () => void;
  onStartGuidedGame?: () => void;
  onStartGuidedAuthoring?: () => void;
  onFreezeLesson?: () => void;
  isAdmin?: boolean;
  onStartGuidedV2Game?: () => void;
  onStartAuthoringV2?: () => void;
}

export default function LearnHome({
  onBack,
  onStartGuidedGame: _onStartGuidedGame,
  onStartGuidedAuthoring: _onStartGuidedAuthoring,
  onFreezeLesson: _onFreezeLesson,
  isAdmin,
  onStartGuidedV2Game,
  onStartAuthoringV2,
}: LearnHomeProps) {
  const [v2AuthoringSession, setV2AuthoringSession] = useState<LessonV2AuthoringSession | null>(null);
  const [v2FrozenLesson, setV2FrozenLesson] = useState<LessonV2 | null>(null);
  const [v2FreezeFlash, setV2FreezeFlash] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    setV2AuthoringSession(loadV2AuthoringSession());
    setV2FrozenLesson(loadV2FrozenLesson());
  }, [isAdmin]);

  const handleFreezeV2 = () => {
    const session = loadV2AuthoringSession();
    if (!session) return;
    const frozen = freezeV2Lesson(session);
    setV2AuthoringSession(session);
    setV2FrozenLesson(frozen);
    setV2FreezeFlash(true);
    setTimeout(() => setV2FreezeFlash(false), 2000);
  };

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
