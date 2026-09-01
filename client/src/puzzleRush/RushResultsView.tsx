import { track } from '../lib/analytics';
import { useCallback, useMemo, useState } from 'react';
import type { PuzzleRushCompleteResponse, PuzzleRushStage, RushPuzzleResult } from './types';
import { stageProgress } from './rushScoring';
import { buildRushShareText } from './rushShareCard';
import './rushResultsDossier.css';

/**
 * End-of-run results.
 *
 * The headline is always the **server's** replayed total. The client's running
 * tally was an estimate (it never had `bestPossibleScore` to divide by), so a
 * difference is expected to be small and ordinary — but when the two disagree
 * the UI shows both and says which is real rather than silently swapping the
 * number the player watched all run.
 */
export function RushResultsView({
  completion,
  completeError,
  clientTally,
  results,
  stages,
  reportFailures,
  onPlayAgain,
  onBack,
}: {
  completion: PuzzleRushCompleteResponse | null;
  completeError: string | null;
  clientTally: number;
  results: RushPuzzleResult[];
  stages: PuzzleRushStage[];
  reportFailures: number;
  onPlayAgain: () => void;
  /** Back to the Rush hub, which re-reads personal best / streak. */
  onBack: () => void;
}) {
  const serverScore = completion?.run.totalScore ?? completion?.authoritativeScore ?? null;
  const solved = completion?.run.puzzlesSolved ?? null;
  const invalidated = Boolean(completion?.invalidated) || completion?.run.status === 'invalidated';
  const overclaimed = serverScore !== null && clientTally > serverScore;
  const completedOrdinals = results.map((result) => result.ordinal);

  const deepestStage =
    [...stages].reverse().find((stage) => stageProgress(stage, completedOrdinals).done > 0) ?? null;
  const secondsBanked = results.reduce((sum, result) => sum + (result.bonusSeconds || 0), 0);

  const stageRows = useMemo(
    () =>
      stages.map((stage) => ({
        stage,
        ...stageProgress(stage, completedOrdinals),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stages, results],
  );

  const shareable = serverScore !== null && !invalidated && !completeError;
  const shareText = useMemo(
    () =>
      shareable
        ? buildRushShareText({
            score: serverScore,
            solved: solved ?? 0,
            puzzles: results.map((r) => ({ solved: r.solved })),
            secondsBanked,
            runDate: completion?.run.runDate,
          })
        : '',
    [shareable, serverScore, solved, results, secondsBanked, completion],
  );

  const [shareDone, setShareDone] = useState(false);
  const handleShare = useCallback(() => {
    if (!shareText) return;
    track('share_initiated', { mode: 'puzzle_rush' });
    const markShared = (): void => {
      setShareDone(true);
      window.setTimeout(() => setShareDone(false), 2000);
    };
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      void navigator
        .share({ text: shareText })
        .then(markShared)
        .catch(() => {
          /* user dismissed native share */
        });
      return;
    }
    void navigator.clipboard.writeText(shareText).then(markShared);
  }, [shareText]);

  return (
    <div className="game-over-overlay pr-result-overlay" role="dialog" aria-label="Puzzle Rush result">
      <div className="prd" onClick={(event) => event.stopPropagation()}>
        <div className="prd__body">
          <header>
            <span className="prd__eyebrow">Run complete</span>
            <h2 className="prd__headline" tabIndex={-1} autoFocus>
              {solved === null ? 'Run finished' : `You solved ${solved} puzzle${solved === 1 ? '' : 's'}`}
            </h2>
            <p className="prd__sub">
              {deepestStage
                ? `Reached ${deepestStage.label} stage with ${serverScore ?? 0} points.`
                : `Final score: ${serverScore ?? 0} points.`}
            </p>
          </header>

          <ul className="prd__stages" aria-label="Stages in this run">
            {stageRows.map(({ stage, done, total }) => (
              <li key={stage.key} className="prd__stage">
                <span className="prd__stage-name">{stage.label}</span>
                <span className="prd__track">
                  {done > 0 ? (
                    <span
                      className="prd__fill"
                      style={{ width: `${Math.round((done / total) * 100)}%` }}
                    />
                  ) : null}
                </span>
                <span className="prd__stage-count">
                  {done}/{total}
                </span>
              </li>
            ))}
          </ul>

          <dl className="prd__stats">
            <div className="prd__stat">
              <dt>Score</dt>
              <dd>{serverScore ?? '—'}</dd>
            </div>
            <div className="prd__stat">
              <dt>Solved</dt>
              <dd>{solved ?? '—'}</dd>
            </div>
            <div className="prd__stat">
              <dt>Furthest</dt>
              <dd>{deepestStage?.label ?? '—'}</dd>
            </div>
            <div className="prd__stat">
              <dt>Time banked</dt>
              <dd>{secondsBanked > 0 ? `+${secondsBanked}s` : '—'}</dd>
            </div>
          </dl>

          {completeError && (
            <p className="prd__note" role="alert" data-ui="rush-complete-error">
              {completeError} Your run was played — this is a problem saving it.
            </p>
          )}

          {invalidated && (
            <p className="prd__note" role="alert" data-ui="rush-invalidated">
              This run was flagged and does not count
              {completion?.invalidatedReason ? ` (${completion.invalidatedReason})` : ''}.
            </p>
          )}

          {overclaimed && !completeError && (
            <p className="prd__note" data-ui="rush-score-mismatch">
              Final score is <strong>{serverScore}</strong>, verified on the server. Your screen showed
              <strong>{clientTally}</strong>. The in-run number is the raw board score; points are only
              computed server-side.
            </p>
          )}

          {reportFailures > 0 && (
            <p className="prd__note" data-ui="rush-report-failures">
              {reportFailures} puzzle{reportFailures === 1 ? '' : 's'} could not be sent during the run and may
              not be counted above.
            </p>
          )}

          <div className="prd__actions">
            {shareable && (
              <button type="button" className="prd__btn prd__btn--primary" onClick={handleShare}>
                {shareDone ? 'Copied' : 'Share Result'}
              </button>
            )}
            <div className="prd__row">
              <button type="button" className="prd__btn" onClick={onPlayAgain}>
                Play again
              </button>
              <button type="button" className="prd__btn" onClick={onBack}>
                Back to hub
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RushResultsView;
