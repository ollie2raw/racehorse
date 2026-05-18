/**
 * Coach sidebar for Guided Match (frozen lesson / transcript playback).
 */

import DominoTile from '../components/DominoTile';
import type { Tile } from '../types';

export interface CoachingTip {
  title: string;
  body: string;
}

interface LessonCoachPanelProps {
  stepIndex: number;
  totalSteps: number;
  coachingText: string;
  onBestMove: () => void;
  canBestMove: boolean;
  isOffAuthoredLine?: boolean;
  showRecommendation?: boolean;
  onToggleRecommendation?: () => void;
  optimalTile?: Tile | null;
  optimalRationale?: string;
  coachingTips?: CoachingTip[];
}

function buildTipsFromCoachingText(text: string): CoachingTip[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  return trimmed
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      if (lines.length === 0) return null;
      const first = lines[0];
      const looksLikeTitle =
        lines.length > 1 &&
        first.length <= 64 &&
        (first.endsWith(':') || /^[A-Z][^.!?]*$/.test(first));
      if (looksLikeTitle) {
        return {
          title: first.replace(/:$/, ''),
          body: lines.slice(1).join(' '),
        };
      }
      return {
        title: 'Strategy note',
        body: block.replace(/\n/g, ' '),
      };
    })
    .filter((tip): tip is CoachingTip => tip !== null);
}

export default function LessonCoachPanel({
  stepIndex,
  totalSteps,
  coachingText,
  onBestMove,
  canBestMove,
  isOffAuthoredLine = false,
  showRecommendation = true,
  onToggleRecommendation,
  optimalTile = null,
  optimalRationale,
  coachingTips,
}: LessonCoachPanelProps) {
  const progressPct = totalSteps > 0 ? ((stepIndex + 1) / totalSteps) * 100 : 0;
  const progressLabel = `${stepIndex + 1} / ${totalSteps}`;
  const parsedTips = buildTipsFromCoachingText(coachingText);
  const tips =
    coachingTips && coachingTips.length > 0
      ? [...parsedTips, ...coachingTips]
      : parsedTips;
  const rationale =
    optimalRationale?.trim() ||
    (showRecommendation && coachingText.trim()
      ? coachingText.split(/\n\s*\n/)[0]?.replace(/\n/g, ' ').trim()
      : '');

  return (
    <section className="learn-coach-sidebar" aria-label="Learn mode coaching">
      <header className="learn-coach-sidebar__header">
        <p className="learn-coach-sidebar__eyebrow">Learn mode</p>
        <h2 className="learn-coach-sidebar__title">Strategic breakdown</h2>
      </header>

      {isOffAuthoredLine ? (
        <div className="learn-coach-sidebar__offline">
          <p>You went off the authored line. This hand continues live from here — coaching follows the live position.</p>
        </div>
      ) : (
        <>
          {showRecommendation && optimalTile ? (
            <div className="learn-coach-sidebar__optimal">
              <div className="learn-coach-sidebar__optimal-tile" aria-hidden="true">
                <DominoTile tile={optimalTile} size={36} />
              </div>
              <div className="learn-coach-sidebar__optimal-copy">
                <span className="learn-coach-sidebar__optimal-label">Optimal move</span>
                {rationale ? <p>{rationale}</p> : null}
              </div>
            </div>
          ) : showRecommendation ? (
            <div className="learn-coach-sidebar__optimal is-placeholder">
              <p className="learn-coach-sidebar__optimal-label">Optimal move</p>
              <p>Reveal coaching to see the recommended tile and why it works here.</p>
            </div>
          ) : null}

          <div className="learn-coach-sidebar__tips">
            <h3 className="learn-coach-sidebar__tips-title">Fritz&apos;s coaching tips</h3>
            {tips.length > 0 ? (
              <ul className="learn-coach-sidebar__tips-list">
                {tips.map((tip, index) => (
                  <li key={`${tip.title}-${index}`}>
                    <strong>{tip.title}</strong>
                    <p>{tip.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="learn-coach-sidebar__tips-empty">
                {showRecommendation
                  ? 'No extra notes for this turn — play the line and watch how the board responds.'
                  : 'Show recommendation to load coaching notes for this turn.'}
              </p>
            )}
          </div>
        </>
      )}

      <footer className="learn-coach-sidebar__footer">
        {!isOffAuthoredLine ? (
          <>
            <div className="rh-progress learn-coach-sidebar__progress">
              <div className="rh-progress__head">
                <span>Lesson progress</span>
                <strong>{progressLabel}</strong>
              </div>
              <div className="rh-progress__rail">
                <div className="rh-progress__fill" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            <button
              type="button"
              className="learn-coach-sidebar__bestmove"
              disabled={!canBestMove}
              onClick={onBestMove}
            >
              Show best move
            </button>

            {onToggleRecommendation ? (
              <button
                type="button"
                className="learn-coach-sidebar__toggle"
                onClick={onToggleRecommendation}
              >
                {showRecommendation ? 'Hide recommendation' : 'Show recommendation'}
              </button>
            ) : null}
          </>
        ) : null}
      </footer>
    </section>
  );
}
