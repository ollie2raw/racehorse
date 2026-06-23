/**
 * usePostGamePivotalReview
 *
 * Manages post-game analysis and pivotal review state for BotMatchScreen.
 *
 * Owns: deferred move log analysis, game reviewer open/close,
 * pivotal turn review wizard state, and post-game review prompt.
 *
 * Activated only when botPostGameReviewEligible is true.
 * When false, deferred analysis never runs and all state stays at defaults.
 *
 * Does not own game state — reads match and moveLog as inputs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { analyzeMoveLogDeferred, type GameAnalysis } from '../analyzer/moveAnalyzer';
import type { MoveEntry } from '../analyzer/moveLogger';
import type { BotMatchState } from './botEngine';
import type { FritzTier } from './fritzConfig';
import {
  buildPivotalReviewSession,
  savePivotalReviewSession,
  type PivotalReviewSession,
  type PivotalTurnReflection,
} from '../training/pivotalReview/pivotalReviewStorage';
import { selectPivotalTurnsFromAnalysis } from '../training/pivotalReview/pivotalTurnSelector';

export type UsePostGamePivotalReviewParams = {
  match: BotMatchState;
  moveLog: MoveEntry[];
  botPostGameReviewEligible: boolean;
  fritzTier: FritzTier;
  winningScore: number;
  showPostGameOverlays: boolean;
};

export function usePostGamePivotalReview({
  match,
  moveLog,
  botPostGameReviewEligible,
  fritzTier,
  winningScore,
  showPostGameOverlays,
}: UsePostGamePivotalReviewParams) {
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<GameAnalysis | null>(null);
  const [reviewerScopeHandNumber, setReviewerScopeHandNumber] = useState<number | null>(null);
  const [reviewerInitialMoveIndex, setReviewerInitialMoveIndex] = useState(1);
  const [postGameReviewDismissed, setPostGameReviewDismissed] = useState(false);
  const [pivotalReviewOpen, setPivotalReviewOpen] = useState(false);
  const [pivotalReviewSummary, setPivotalReviewSummary] = useState<PivotalReviewSession | null>(null);
  const [postGameAnalysis, setPostGameAnalysis] = useState<GameAnalysis | null>(null);
  const [postGameAnalysisPending, setPostGameAnalysisPending] = useState(false);

  useEffect(() => {
    if (!match.gameOver) {
      setPostGameReviewDismissed(false);
      setPivotalReviewOpen(false);
      setPivotalReviewSummary(null);
      setPostGameAnalysis(null);
      setPostGameAnalysisPending(false);
      return;
    }

    const eligible = botPostGameReviewEligible;
    if (!eligible || !showPostGameOverlays || !moveLog.some((entry) => entry.player === 'you')) {
      setPostGameAnalysis(null);
      setPostGameAnalysisPending(false);
      return;
    }

    let cancelled = false;
    setPostGameAnalysisPending(true);
    void analyzeMoveLogDeferred(moveLog, true, {
      oracleMode: 'tier',
      tierPlayed: fritzTier,
      winningScore,
    }).then((analysis) => {
      if (cancelled) return;
      setPostGameAnalysis(analysis);
      setPostGameAnalysisPending(false);
    }).catch(() => {
      if (!cancelled) setPostGameAnalysisPending(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    showPostGameOverlays,
    match.gameOver,
    botPostGameReviewEligible,
    moveLog,
    fritzTier,
    winningScore,
  ]);

  const pivotalSelection = useMemo(() => {
    if (!postGameAnalysis) return null;
    return selectPivotalTurnsFromAnalysis(postGameAnalysis, moveLog, { winningScore });
  }, [postGameAnalysis, moveLog, winningScore]);

  const skipPostGameReview = useCallback(() => {
    setPostGameReviewDismissed(true);
  }, []);

  const reopenPostGameReview = useCallback(() => {
    setPostGameReviewDismissed(false);
  }, []);

  const openHandScopedReview = useCallback(
    (handNumber: number) => {
      if (!postGameAnalysis) return;
      setReviewerScopeHandNumber(handNumber);
      setCurrentAnalysis(postGameAnalysis);
      setAnalyzerOpen(true);
    },
    [postGameAnalysis],
  );

  const openReviewGameFromPrompt = useCallback(() => {
    if (!postGameAnalysis) return;
    setPostGameReviewDismissed(true);
    setReviewerScopeHandNumber(null);
    setReviewerInitialMoveIndex(1);
    setCurrentAnalysis(postGameAnalysis);
    setAnalyzerOpen(true);
  }, [postGameAnalysis]);

  const completePivotalTurnReview = useCallback(
    (reflections: PivotalTurnReflection[]) => {
      if (!pivotalSelection) return;
      setPivotalReviewSummary(
        buildPivotalReviewSession({
          mode: 'bot',
          selection: pivotalSelection,
          reflections,
          youScore: match.players.you.score,
          opponentScore: match.players.bot.score,
        }),
      );
      setPivotalReviewOpen(false);
    },
    [match.players.bot.score, match.players.you.score, pivotalSelection],
  );

  const savePivotalReviewSummary = useCallback(() => {
    if (pivotalReviewSummary) savePivotalReviewSession(pivotalReviewSummary);
    setPivotalReviewSummary(null);
  }, [pivotalReviewSummary]);

  const closeAnalyzer = useCallback(() => {
    setAnalyzerOpen(false);
    setReviewerScopeHandNumber(null);
    setReviewerInitialMoveIndex(1);
  }, []);

  return {
    analyzerOpen,
    setAnalyzerOpen,
    currentAnalysis,
    setCurrentAnalysis,
    reviewerScopeHandNumber,
    setReviewerScopeHandNumber,
    reviewerInitialMoveIndex,
    setReviewerInitialMoveIndex,
    postGameReviewDismissed,
    setPostGameReviewDismissed,
    pivotalReviewOpen,
    setPivotalReviewOpen,
    pivotalReviewSummary,
    setPivotalReviewSummary,
    postGameAnalysis,
    postGameAnalysisPending,
    pivotalSelection,
    skipPostGameReview,
    reopenPostGameReview,
    openHandScopedReview,
    openReviewGameFromPrompt,
    completePivotalTurnReview,
    savePivotalReviewSummary,
    closeAnalyzer,
  };
}
