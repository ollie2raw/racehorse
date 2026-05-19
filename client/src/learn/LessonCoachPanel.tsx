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
  momentTitle?: string;
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

function deriveMomentTitle(coachingText: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const trimmed = coachingText.trim();
  if (!trimmed) return 'Read the position';
  const firstBlock = trimmed.split(/\n\s*\n/)[0]?.trim() ?? '';
  const firstLine = firstBlock.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  if (!firstLine) return 'Your decision';
  if (/^play:/i.test(firstLine)) return 'Choose your line';
  if (firstLine.length <= 52) return firstLine.replace(/\.$/, '');
  return 'Your decision';
}

export default function LessonCoachPanel({
  stepIndex,
  totalSteps,
  coachingText,
  momentTitle,
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
  const title = deriveMomentTitle(coachingText, momentTitle);
  const rationale =
    optimalRationale?.trim() ||
    (showRecommendation && coachingText.trim()
      ? coachingText.split(/\n\s*\n/)[0]?.replace(/\n/g, ' ').trim()
      : '');
  const watchNextTips = showRecommendation ? tips : [];

  return (
    <section className="learn-coach-rail" aria-label="Guided match coaching">
      <header className="learn-coach-rail__header">
        <p className="learn-coach-rail__eyebrow">Guided match · Learn mode</p>
        <h2 className="learn-coach-rail__title">{title}</h2>
      </header>

      {!isOffAuthoredLine ? (
        <div className="rh-progress learn-coach-rail__progress">
          <div className="rh-progress__head">
            <span>Lesson progress</span>
            <strong>{progressLabel}</strong>
          </div>
          <div className="rh-progress__rail">
            <div className="rh-progress__fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      ) : null}

      {isOffAuthoredLine ? (
        <div className="learn-coach-rail__state learn-coach-rail__state--offline">
          <p>You went off the authored line. This hand continues live from here — coaching follows the live position.</p>
        </div>
      ) : (
        <>
          <div className={`learn-coach-rail__state${showRecommendation ? ' is-revealed' : ''}`}>
            <span className="learn-coach-rail__state-label">
              {showRecommendation ? 'Fritz recommends' : 'Your turn to think'}
            </span>
            {showRecommendation && optimalTile ? (
              <div className="learn-coach-rail__recommendation">
                <div className="learn-coach-rail__rec-tile" aria-hidden="true">
                  <DominoTile tile={optimalTile} size={40} />
                </div>
                <div className="learn-coach-rail__rec-copy">
                  {rationale ? <p className="learn-coach-rail__rec-why">{rationale}</p> : null}
                </div>
              </div>
            ) : showRecommendation ? (
              <p className="learn-coach-rail__rec-placeholder">
                Coaching is loaded for this turn. Use Show best move to play the authored line.
              </p>
            ) : (
              <p className="learn-coach-rail__rec-placeholder">
                Think first. Reveal Fritz&apos;s recommendation when you&apos;re ready.
              </p>
            )}
          </div>

          {showRecommendation && watchNextTips.length > 0 ? (
            <div className="learn-coach-rail__watch">
              <h3 className="learn-coach-rail__watch-title">What to watch next</h3>
              <ul className="learn-coach-rail__watch-list">
                {watchNextTips.slice(0, 3).map((tip, index) => (
                  <li key={`${tip.title}-${index}`}>
                    <strong>{tip.title}</strong>
                    <p>{tip.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="learn-coach-rail__actions">
            <button
              type="button"
              className="learn-coach-rail__primary"
              disabled={!canBestMove}
              onClick={onBestMove}
            >
              Show best move
            </button>
            {onToggleRecommendation ? (
              <button
                type="button"
                className="learn-coach-rail__secondary"
                onClick={onToggleRecommendation}
              >
                {showRecommendation ? 'Hide recommendation' : 'Reveal recommendation'}
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
