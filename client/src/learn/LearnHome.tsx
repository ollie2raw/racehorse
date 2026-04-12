import { useEffect, useMemo, useState } from 'react';
import LayoutScreen from '../ui/LayoutScreen';
import { learnLessons, learnModules, level1Lessons } from './data';
import { loadProgress } from './progress/storage';
import './learn.css';

interface LearnHomeProps {
  onBack: () => void;
  onStartLesson: (lessonId: string) => void;
  onStartGuidedGame?: () => void;
}

export default function LearnHome({ onBack, onStartLesson, onStartGuidedGame }: LearnHomeProps) {
  const [progress, setProgress] = useState(() => loadProgress());

  useEffect(() => {
    setProgress(loadProgress());
  }, []);

  const level1LessonIds = useMemo(() => level1Lessons.map((lesson) => lesson.id), []);
  const completedLevel1Count = useMemo(
    () => level1LessonIds.filter((id) => progress.completedLessonIds.includes(id)).length,
    [level1LessonIds, progress.completedLessonIds],
  );
  const level1ProgressPct = level1LessonIds.length > 0
    ? Math.round((completedLevel1Count / level1LessonIds.length) * 100)
    : 0;
  const level2Unlocked = level1ProgressPct === 100;
  const canResume =
    typeof progress.lastLessonId === 'string' &&
    learnLessons.some((lesson) => lesson.id === progress.lastLessonId);
  const moduleCards = useMemo(
    () =>
      learnModules.map((module) => {
        if (module.id === 'level-1') {
          return { ...module, progressPct: level1ProgressPct, unlocked: true };
        }
        if (module.id === 'level-2') {
          return { ...module, progressPct: 0, unlocked: level2Unlocked };
        }
        return { ...module, progressPct: 0 };
      }),
    [level1ProgressPct, level2Unlocked],
  );

  return (
    <LayoutScreen
      className="screen lobby-screen mode-home-screen mode-subpage-screen mode-accent-learn learn-home-screen"
      title="Learn Racehorse"
      subtitle="Master the fundamentals step-by-step."
      contentClassName="screen-shell"
    >
      <div className="learn-home-wrap">
        <div className="learn-home-header">
          <div className="learn-home-top">
            <button className="mode-inline-btn" onClick={onBack}>
              ← Back
            </button>
          </div>
        </div>

        {onStartGuidedGame && (
          <div className="learn-guided-promo">
            <div className="learn-guided-promo-body">
              <span className="learn-guided-promo-title">Guided Game</span>
              <span className="learn-guided-promo-desc">
                Play vs Rookie Fritz with Master Fritz coaching every turn.
              </span>
            </div>
            <button className="mode-inline-btn learn-guided-btn" onClick={onStartGuidedGame}>
              Start Guided Game
            </button>
          </div>
        )}

        <div className="mode-actions learn-home-levels">
          {moduleCards.map((level) => (
            <section
              key={level.id}
              className={`mode-option learn-level-card ${level.unlocked ? 'is-unlocked' : 'is-locked'}`}
              aria-label={level.title}
            >
              <div className="learn-level-head">
                <span className="mode-option-title">{level.title}</span>
                <span className={`learn-level-state ${level.unlocked ? 'unlocked' : 'locked'}`}>
                  {level.unlocked ? 'Unlocked' : 'Locked'}
                </span>
              </div>

              <span className="mode-option-meta">{level.description}</span>

              {level.id === 'level-1' ? (
                <ul className="learn-lessons-list" aria-label="Level 1 lessons">
                  {level1Lessons.map((lesson) => (
                    <li key={lesson.id} className="learn-lessons-item">
                      <button
                        type="button"
                        className="learn-lessons-link"
                        onClick={() => onStartLesson(lesson.id)}
                      >
                        <span className="learn-lessons-main">
                          <span className="learn-lessons-title">{lesson.title}</span>
                          {progress.completedLessonIds.includes(lesson.id) ? (
                            <span className="learn-lesson-complete">Completed</span>
                          ) : null}
                        </span>
                        <span className="learn-lessons-duration">~{lesson.estMinutes} min</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="learn-progress-row" aria-label={`${level.progressPct}% complete`}>
                <div className="learn-progress-track">
                  <div className="learn-progress-fill" style={{ width: `${level.progressPct}%` }} />
                </div>
                <span className="learn-progress-text">{level.progressPct}%</span>
              </div>

              <div className="learn-level-actions">
                {level.id === 'level-1' && canResume ? (
                  <button
                    className="mode-inline-btn learn-resume-btn"
                    onClick={() => onStartLesson(progress.lastLessonId!)}
                  >
                    Resume
                  </button>
                ) : null}
                <button
                  className="mode-inline-btn"
                  disabled={!level.unlocked || level.id !== 'level-1'}
                  onClick={() => {
                    if (level.id === 'level-1' && level1Lessons[0]) {
                      onStartLesson(level1Lessons[0].id);
                    }
                  }}
                >
                  {level.unlocked ? 'Start' : 'Locked'}
                </button>
              </div>
            </section>
          ))}
        </div>
      </div>
    </LayoutScreen>
  );
}
