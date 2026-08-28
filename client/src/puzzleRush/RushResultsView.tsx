import { useCallback, useMemo, useState } from 'react';
import { Button } from '../components/primitives';
import { AnimatedScore } from '../components/AnimatedScore';
import type { PuzzleRushCompleteResponse, PuzzleRushStage, RushPuzzleResult } from './types';
import { stageProgress } from './rushScoring';
import { buildRushShareText } from './rushShareCard';

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
  // Only the server can count solves: a solve is now a share of the puzzle's
  // best_possible_score, and the client is deliberately never told that number.
  // With no completion there is nothing honest to show, so show nothing — the
  // client's own per-puzzle `solved` flag is the old "scored anything" rule and
  // would read high exactly when the real figure is missing.
  const solved = completion?.run.puzzlesSolved ?? null;
  const invalidated = Boolean(completion?.invalidated) || completion?.run.status === 'invalidated';
  // The in-run number is a raw board score and the server's is a points total,
  // so they are not the same measure and normally differ — that is not worth
  // alarming about. Only a client that claimed *more* than the server verified
  // is notable.
  const overclaimed = serverScore !== null && clientTally > serverScore;
  const completedOrdinals = results.map((result) => result.ordinal);

  // Deepest stage the run actually reached, read off the stage list rather
  // than the last result's own key — a stage counts as reached once any of
  // its ordinals is behind you.
  const deepestStage =
    [...stages].reverse().find((stage) => stageProgress(stage, completedOrdinals).done > 0) ?? null;
  const secondsBanked = results.reduce((sum, result) => sum + (result.bonusSeconds || 0), 0);

  const stageRows = useMemo(
    () =>
      stages.map((stage) => ({
        stage,
        ...stageProgress(stage, completedOrdinals),
      })),
    // completedOrdinals is rebuilt each render from `results`; key off that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stages, results],
  );

  // A run the server rejected, or never scored, has no score worth sharing.
  const shareable = serverScore !== null && !invalidated && !completeError;
  const shareText = useMemo(
    () =>
      shareable
        ? buildRushShareText({
            score: serverScore,
            solved,
            stages: stageRows.map(({ stage, done, total }) => ({
              label: stage.label,
              done,
              total,
            })),
            secondsBanked,
            playedAt: completion?.run.endedAt ?? completion?.run.startedAt ?? null,
          })
        : '',
    [shareable, serverScore, solved, stageRows, secondsBanked, completion],
  );

  const [shareDone, setShareDone] = useState(false);
  const handleShare = useCallback(() => {
    if (!shareText) return;
    const markShared = (): void => {
      setShareDone(true);
      window.setTimeout(() => setShareDone(false), 2000);
    };
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      void navigator
        .share({ title: 'Puzzle Rush', text: shareText })
        .then(markShared)
        .catch(() => {
          /* user dismissed native share */
        });
      return;
    }
    void navigator.clipboard.writeText(shareText).then(markShared);
  }, [shareText]);

  return (
    <div className="pr-results" data-ui="rush-results">
      <header className="pr-results__head">
        <div className="pr-results__head-copy">
          <span className="pr-results__eyebrow">Run complete</span>
          <div className="pr-results__score" data-ui="rush-final-score">
            {serverScore == null ? (
              <span className="pr-results__score-value">—</span>
            ) : (
              <AnimatedScore value={serverScore} from={0} className="pr-results__score-value" />
            )}
            <span className="pr-results__score-suffix">PTS</span>
          </div>
          <span className="pr-results__solved">
            {solved === null
              ? 'Solves unavailable'
              : `${solved} puzzle${solved === 1 ? '' : 's'} solved`}
          </span>
        </div>
        {shareable ? (
          <button
            type="button"
            className="pr-results__share"
            onClick={handleShare}
            data-ui="rush-share"
          >
            {shareDone ? 'Copied' : 'Share result'}
          </button>
        ) : null}
      </header>

      {/* Three facts the run earned, all derived from what the client already
          holds — no invented stats. */}
      <dl className="pr-results__tiles">
        <div className="pr-results__tile">
          <dd className="pr-results__tile-value">{solved ?? '—'}</dd>
          <dt className="pr-results__tile-key">Solved</dt>
        </div>
        <div className="pr-results__tile">
          <dd className="pr-results__tile-value">{deepestStage?.label ?? '—'}</dd>
          <dt className="pr-results__tile-key">Furthest stage</dt>
        </div>
        <div className="pr-results__tile">
          <dd className="pr-results__tile-value">
            {secondsBanked > 0 ? `+${secondsBanked}s` : '—'}
          </dd>
          <dt className="pr-results__tile-key">Time banked</dt>
        </div>
      </dl>

      {completeError && (
        <p className="pr-results__error" role="alert" data-ui="rush-complete-error">
          {completeError} Your run was played — this is a problem saving it.
        </p>
      )}

      {invalidated && (
        <p className="pr-results__flag" role="alert" data-ui="rush-invalidated">
          This run was flagged and does not count
          {completion?.invalidatedReason ? ` (${completion.invalidatedReason})` : ''}.
        </p>
      )}

      {overclaimed && !completeError && (
        <p className="pr-results__mismatch" data-ui="rush-score-mismatch">
          Final score is <strong>{serverScore}</strong>, verified on the server. Your
          screen showed <strong>{clientTally}</strong>. The in-run number is the raw
          board score; points are only computed server-side.
        </p>
      )}

      {reportFailures > 0 && (
        <p className="pr-results__note" data-ui="rush-report-failures">
          {reportFailures} puzzle{reportFailures === 1 ? '' : 's'} could not be sent during the
          run and may not be counted above.
        </p>
      )}

      <div className="pr-results__section-label">Stages</div>
      <ul className="pr-results__stages">
        {stageRows.map(({ stage, done, total }) => {
          const pct = total === 0 ? 0 : Math.round((done / total) * 100);
          return (
            <li key={stage.key} className="pr-results__stage-row" data-stage={stage.key}>
              <div className="pr-results__stage-top">
                <span className="pr-results__stage-label">{stage.label}</span>
                <span className="pr-results__stage-count">
                  {done}
                  <span className="pr-results__stage-total">/{total}</span>
                </span>
              </div>
              {/* Same weighted-fill language as the in-run HUD meter, so the
                  summary reads as the run you just watched. */}
              <div className="pr-results__stage-meter" role="presentation">
                <span className="pr-results__stage-fill" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>

      <footer className="pr-results__actions">
        {/* Two ways out, not three. "Home" duplicated "Back to hub" — the hub
            it lands on carries its own "Back to home" — so the run-complete
            screen offers the two moves that belong to a finished run. */}
        <Button variant="tier-standard" size="lg" onClick={onPlayAgain}>
          Play again
        </Button>
        <Button variant="outline" size="lg" onClick={onBack}>
          Back to hub
        </Button>
      </footer>
    </div>
  );
}

export default RushResultsView;
