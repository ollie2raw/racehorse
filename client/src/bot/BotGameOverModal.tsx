import React from 'react';
import GameOverModal from '../components/GameOverModal';
import { GuidedMatchFinalDebriefPanel } from '../learn/guidedMatch/GuidedMatchFinalDebriefPanel';
import { formatOrdinalPlace } from '../dailyFritz/format';
import { FRITZ_POSTGAME_TRUST_LINE } from './fritzTrustCopy';

const formatGhostName = (rawName: string) => {
  const cleaned = rawName
    .replace(/'s Ghost/gi, '')
    .replace(/ Ghost/gi, '')
    .replace(/^@/, '')
    .trim();
  const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return `@${capitalized}`;
};

import type { GuidedMatchFinalDebrief } from '../learn/guidedMatch/guidedMatchFinalDebrief';
import type { GuidedMatchCaptureStatus } from '../learn/guidedMatch/guidedMatchCapture';
import type { GhostCompletionResult } from '../ghost/api';
import type { DailyPuzzleLeaderboardEntry } from '../dailyPuzzle/api';
import type { AppMode } from '../appRouteTypes';
import type { DailyFritzLeaderboardRow } from '../dailyFritz/api';

import type { MoveEntry } from '../game/moveLogger';

export interface BotGameOverModalProps {
  showPostGameOverlays: boolean;
  isPlayVsFritzGameOver: boolean;
  isDailyFritzMode: boolean;
  onDailyFritzGameComplete: ((result: {
    winner: 'you' | 'bot' | null;
    yourScore: number;
    botScore: number;
    movesUsed: number;
    handsPlayed: number;
    currentHandIndex: number;
    moveLog: MoveEntry[];
  }) => void) | null;
  opponentLabel: string;
  isGuidedMatchVictoryResult: boolean;
  winnerId: 'you' | 'bot' | null;
  dealSize: number;
  youScore: number;
  botScore: number;
  isGhostMode: boolean;
  ghostSubLabel: string | null;
  guidedMatchFinalDebrief: GuidedMatchFinalDebrief | null;
  enableGuidedMatchCandidateCapture: boolean;
  isJourneyTrial: boolean;
  guidedMatchCaptureStatus: GuidedMatchCaptureStatus;
  guidedMatchCandidateSaveStatus: string | null;
  ghostResultLoading: boolean;
  ghostResultError: string | null;
  dailyFritzRank: number | null;
  dailyFritzLeaderboard: DailyFritzLeaderboardRow[];
  isDailyPuzzleRun: boolean;
  userId: string | null;
  dailyLeaderboardLoading: boolean;
  dailyLeaderboardError: string | null;
  dailyLeaderboard: DailyPuzzleLeaderboardEntry[];
  ghostRatingDeltaLabel: string | null;
  ghostResultMessage: string;
  canSaveGuidedMatchCandidate: boolean;
  isGuidedMode: boolean;
  ghostResult: GhostCompletionResult | null;


  onExitMatch: () => void;
  onGoHome: () => void;
  onReturnToFritzSetup: () => void;
  onStartFreshMatch: () => void;
  onReturnToLearn: () => void;
  onCopyGuidedMatchCandidate: () => void;
  onSaveGuidedMatchCandidate: () => void;
  onRetryDailyFritzCompletion: () => void;
  onNavigate: ((mode: AppMode) => void) | null;
}

export const BotGameOverModal: React.FC<BotGameOverModalProps> = ({
  showPostGameOverlays,
  isPlayVsFritzGameOver,
  isDailyFritzMode,
  onDailyFritzGameComplete,
  opponentLabel,
  isGuidedMatchVictoryResult,
  winnerId,
  dealSize,
  youScore,
  botScore,
  isGhostMode,
  ghostSubLabel,
  guidedMatchFinalDebrief,
  enableGuidedMatchCandidateCapture,
  isJourneyTrial,
  guidedMatchCaptureStatus,
  guidedMatchCandidateSaveStatus,
  ghostResultLoading,
  ghostResultError,
  dailyFritzRank,
  dailyFritzLeaderboard,
  isDailyPuzzleRun,
  userId,
  dailyLeaderboardLoading,
  dailyLeaderboardError,
  dailyLeaderboard,
  ghostRatingDeltaLabel,
  ghostResultMessage,
  canSaveGuidedMatchCandidate,
  isGuidedMode,
  ghostResult,

  onExitMatch,
  onGoHome,
  onReturnToFritzSetup,
  onStartFreshMatch,
  onReturnToLearn,
  onCopyGuidedMatchCandidate,
  onSaveGuidedMatchCandidate,
  onRetryDailyFritzCompletion,
  onNavigate,
}) => {
  if (!showPostGameOverlays || isPlayVsFritzGameOver || (isDailyFritzMode && onDailyFritzGameComplete)) {
    return null;
  }

  return (
    <GameOverModal
      open
      ariaLabel={`${opponentLabel} match over`}
      matchKind="single-player"
      layout={isGuidedMatchVictoryResult ? 'guided-split' : 'default'}
      kicker={
        isGuidedMatchVictoryResult
          ? 'Guided Match Complete'
          : isDailyFritzMode
            ? 'Daily Fritz Complete'
            : isGhostMode
              ? 'Ghost Match Result'
              : 'Play vs Fritz Result'
      }
      title={
        winnerId === 'you' ? 'Victory' : 'Defeat'
      }
      subtitle={
        isGhostMode
          ? winnerId === 'you'
            ? `You finished ahead of ${opponentLabel}.`
            : `${opponentLabel} closed out the match.`
          : winnerId === 'you'
            ? `You beat ${opponentLabel} in ${dealSize}-tile play.`
            : `${opponentLabel} took the match in ${dealSize}-tile play.`
      }
      tone={winnerId === 'you' ? 'gold' : 'red'}
      stats={[
        {
          label: 'Final Score',
          value: `${youScore}-${botScore}`,
          tone: winnerId === 'you' ? 'gold' : 'red',
        },
        {
          label: 'Margin',
          value: `${winnerId === 'you' ? '+' : '-'}${Math.abs(youScore - botScore)}`,
          tone: winnerId === 'you' ? 'gold' : 'red',
        },
        {
          label: isGhostMode ? 'Mode' : 'Deal',
          value: isGhostMode ? 'Ghost' : `${dealSize}-Tile`,
          tone: isGhostMode ? 'blue' : 'default',
        },
      ]}
      scores={[
        {
          label: 'You',
          value: isGhostMode ? `${youScore} pts` : youScore,
          winner: winnerId === 'you',
          showCrown: winnerId === 'you',
        },
        {
          label: isGhostMode ? (
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
              {ghostSubLabel && (
                <span style={{ fontSize: '0.94rem', opacity: 0.9, textTransform: 'none', fontWeight: 700 }}>
                  {formatGhostName(ghostSubLabel)}
                </span>
              )}
              <span style={{ fontSize: '1.12rem', opacity: 0.98, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 850, lineHeight: 1 }}>
                {opponentLabel}
              </span>
            </div>
          ) : opponentLabel,
          value: isGhostMode ? `${botScore} pts` : botScore,
          winner: winnerId === 'bot',
          showCrown: winnerId === 'bot',
        },
      ]}
      primaryLabel={
        isGuidedMatchVictoryResult
          ? 'Finish Lesson'
          : isDailyFritzMode
            ? 'Back Home'
            : isGhostMode
              ? 'Play Again'
              : 'Rematch'
      }
      onPrimary={isGuidedMatchVictoryResult ? onReturnToLearn : onStartFreshMatch}
      secondaryLabel={
        isGuidedMatchVictoryResult
          ? undefined
          : isDailyFritzMode
            ? 'Back Home'
            : isGhostMode
              ? 'Home'
              : 'Change Setup'
      }
      onSecondary={
        isGuidedMatchVictoryResult
          ? undefined
          : isDailyFritzMode
            ? onExitMatch
            : isGhostMode
              ? onGoHome
              : onReturnToFritzSetup
      }
      extraActionLabel={
        isGuidedMatchVictoryResult
          ? undefined
          : canSaveGuidedMatchCandidate
            ? 'Save as Guided Match Candidate'
            : !isGuidedMode && !isGhostMode && !isDailyFritzMode && onNavigate
              ? 'Home'
              : undefined
      }
      onExtraAction={
        isGuidedMatchVictoryResult
          ? undefined
          : canSaveGuidedMatchCandidate
            ? onSaveGuidedMatchCandidate
            : !isGuidedMode && !isGhostMode && !isDailyFritzMode && onNavigate
              ? onGoHome
              : undefined
      }
      onClose={isGuidedMatchVictoryResult ? onReturnToLearn : onExitMatch}
    >
      {isDailyFritzMode && !isGuidedMatchVictoryResult && !isGhostMode && (
        <p className="rh-go-trust-note">{FRITZ_POSTGAME_TRUST_LINE}</p>
      )}
      {guidedMatchFinalDebrief ? (
        <GuidedMatchFinalDebriefPanel debrief={guidedMatchFinalDebrief} />
      ) : null}
      {!isGuidedMatchVictoryResult &&
        import.meta.env.DEV &&
        enableGuidedMatchCandidateCapture &&
        !isJourneyTrial && (
        <div className="rh-go-rating">
          <span>Guided Capture</span>
          <strong>
            {guidedMatchCaptureStatus.eventCount} events · {guidedMatchCaptureStatus.candidateStatus}
          </strong>
          <button
            type="button"
            className="btn"
            onClick={onCopyGuidedMatchCandidate}
            style={{ marginTop: 8 }}
          >
            Copy Candidate JSON
          </button>
          {guidedMatchCandidateSaveStatus ? (
            <p style={{ margin: '8px 0 0', color: 'rgba(226,232,241,0.78)' }}>
              {guidedMatchCandidateSaveStatus}
            </p>
          ) : null}
        </div>
      )}
      {isDailyFritzMode && (
        <div className="rh-go-daily-panel">
          <div className="rh-go-rating">
            <span>Daily Run</span>
            <strong>
              {ghostResultLoading
                ? 'Submitting...'
                : ghostResultError
                  ? ghostResultError
                  : formatOrdinalPlace(dailyFritzRank)
                    ? formatOrdinalPlace(dailyFritzRank)
                    : dailyFritzLeaderboard.length > 0
                      ? 'Ranked'
                    : 'Submitted'}
            </strong>
          </div>
          {ghostResultError ? (
            <button
              type="button"
              className="mode-inline-btn"
              onClick={onRetryDailyFritzCompletion}
              style={{ alignSelf: 'flex-start' }}
            >
              Retry Submit
            </button>
          ) : null}
        </div>
      )}
      {isGhostMode && (
        <div className="ghost-result-card">
          <div className="ghost-result-row">
            <span>YOU</span>
            <strong>{youScore} pts</strong>
            <div className="ghost-result-bar">
              <div
                className="ghost-result-bar-fill is-you"
                style={{
                  width: `${(youScore / Math.max(youScore, botScore, 1)) * 100}%`,
                }}
              />
            </div>
          </div>
          <div className="ghost-result-row">
            <span>GHOST</span>
            <strong>{botScore} pts</strong>
            <div className="ghost-result-bar">
              <div
                className="ghost-result-bar-fill is-ghost"
                style={{
                  width: `${(botScore / Math.max(youScore, botScore, 1)) * 100}%`,
                }}
              />
            </div>
          </div>
          <div className="ghost-result-rating">
            {ghostResultLoading ? (
              <span>Analyzing play style...</span>
            ) : ghostResult ? (
              <span>Ghost Rating {ghostRatingDeltaLabel} • {Math.round(ghostResult.newRating)}</span>
            ) : ghostResultError ? (
              <span>{ghostResultError}</span>
            ) : (
              <span>Analyzing play style...</span>
            )}
          </div>
          <p className="ghost-result-message">{ghostResultMessage}</p>
        </div>
      )}
      {isDailyFritzMode && dailyFritzLeaderboard.length > 0 && (
        <div className="daily-fritz-inline-preview">
          <h3 className="daily-fritz-inline-preview-title">Today&apos;s Daily Fritz Top Runs</h3>
          <div className="daily-fritz-inline-preview-list">
            {dailyFritzLeaderboard.map((entry) => (
              <div
                key={`${entry.rank}-${entry.username}-${entry.completedAt}`}
                className="daily-fritz-inline-preview-row"
              >
                <strong className="daily-fritz-inline-preview-rank">#{entry.rank}</strong>
                <span className="daily-fritz-inline-preview-player">{entry.username}</span>
                <span className="daily-fritz-inline-preview-score">{entry.finalScore}-{entry.opponentScore}</span>
                <span className="daily-fritz-inline-preview-diff">{entry.pointDiff >= 0 ? '+' : ''}{entry.pointDiff}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {isDailyPuzzleRun && (
        <div style={{ margin: '2px 0 4px', textAlign: 'left' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Today&apos;s Top Scores</h3>
          {!userId && (
            <p className="lobby-server" style={{ margin: '0 0 8px' }}>
              Log in to submit your score.
            </p>
          )}
          {dailyLeaderboardLoading && (
            <p className="lobby-server" style={{ margin: 0 }}>
              Loading leaderboard...
            </p>
          )}
          {!dailyLeaderboardLoading && dailyLeaderboardError && (
            <p className="lobby-server" style={{ margin: 0 }}>
              {dailyLeaderboardError}
            </p>
          )}
          {!dailyLeaderboardLoading &&
            !dailyLeaderboardError &&
            dailyLeaderboard.length === 0 && (
              <p className="lobby-server" style={{ margin: 0 }}>
                No scores posted yet.
              </p>
            )}
          {!dailyLeaderboardLoading && dailyLeaderboard.length > 0 && (
            <div style={{ display: 'grid', gap: 6 }}>
              {dailyLeaderboard.map((entry, idx) => {
                const isCurrentUser = Boolean(userId) && entry.userId === userId;
                return (
                  <div
                    key={`${entry.userId}-${idx}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '52px 1fr auto',
                      gap: 8,
                      alignItems: 'center',
                      borderRadius: 8,
                      padding: '6px 8px',
                      background: isCurrentUser
                        ? 'rgba(255, 215, 0, 0.16)'
                        : 'rgba(255, 255, 255, 0.04)',
                    }}
                  >
                    <span>#{idx + 1}</span>
                    <span>@{entry.username}</span>
                    <span>{entry.bestScore}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </GameOverModal>
  );
};
