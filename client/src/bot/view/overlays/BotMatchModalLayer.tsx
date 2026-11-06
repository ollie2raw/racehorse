import { ScoreTrackOverlay } from '../../../components';
import { autoAdvanceMs } from '../../../modules/match/index.ts';
import { PIVOTAL_REVIEW_WIZARD_ENABLED } from '../../botMatchScreenTypes.ts';
import type { ModalOverlayViewModel } from '../../view-model/botMatchViewModelTypes.ts';
import type { BotMatchState } from '../../botEngine.ts';
import { BotDailyFritzSetOverlay } from '../../BotDailyFritzSetOverlay.tsx';
import { BotHandOverModal } from '../../BotHandOverModal.tsx';
import { BotPostGameCard } from '../../BotPostGameCard.tsx';
import { BotPivotalReviewPortal } from '../../BotPivotalReviewPortal.tsx';
import { BotReviewSummaryPortal } from '../../BotReviewSummaryPortal.tsx';
import { BotGameOverModal } from '../../BotGameOverModal.tsx';

type BotMatchModalLayerProps = {
  modals: ModalOverlayViewModel;
  match: BotMatchState;
};

export function BotMatchModalLayer({ modals, match }: BotMatchModalLayerProps) {
  const { opponentLabel, winningScore, navigation } = modals;
  return (
    <>
      <ScoreTrackOverlay
        open={modals.scoreTrackOpen}
        onClose={() => modals.setScoreTrackOpen(false)}
        target={winningScore}
        players={[
          { label: opponentLabel, score: match.players.bot.score, tone: 'opp' },
          { label: 'You', score: match.players.you.score, tone: 'you' },
        ]}
      />
      <BotHandOverModal
        handReveal={modals.handReveal}
        gameOver={match.gameOver}
        handRevealProgress={modals.handRevealProgress}
        handAdvanceError={modals.handAdvanceError}
        showManualHandAdvance={modals.showManualHandAdvance}
        ghostResultError={modals.ghostResultError}
        isGuidedMode={modals.isGuidedMode}
        isGuidedV2Mode={modals.isGuidedV2Mode}
        isDailyFritzMode={modals.isDailyFritzMode}
        opponentLabel={opponentLabel}
        tileReveals={modals.handRevealTileReveals}
        coach={modals.coach}
        autoAdvanceMs={autoAdvanceMs}
        onAdvanceHand={modals.advanceHand}
        onRetryGhost={() => {
          modals.setGhostResultError(null);
          modals.advanceHand();
        }}
        onRetryHandAdvance={modals.retryHandAdvance}
        handNumber={match.handNumber}
      />
      <BotDailyFritzSetOverlay
        overlay={modals.dailyFritzSetOverlay}
        shareCopied={modals.shareCopied}
        onShare={modals.handleShareResult}
        showPostGameOverlays={modals.showPostGameOverlays}
      />
      <BotPivotalReviewPortal
        enabled={PIVOTAL_REVIEW_WIZARD_ENABLED}
        open={modals.pivotalReviewOpen}
        selection={modals.pivotalSelection}
        onComplete={modals.completePivotalTurnReview}
      />
      <BotReviewSummaryPortal
        pivotalReviewWizardEnabled={PIVOTAL_REVIEW_WIZARD_ENABLED}
        pivotalReviewSummary={modals.pivotalReviewSummary}
        pivotalSelection={modals.pivotalSelection}
        postGameAnalysis={modals.postGameAnalysis}
        accuracyModelPending={modals.accuracyModelPending}
        reviewUnavailable={modals.reviewUnavailable}
        reviewUnavailableReason={modals.reviewUnavailableReason}
        decisionLedger={modals.decisionLedger}
        onRetryReview={modals.retryReview}
        reviewRetryState={modals.reviewRetryState}
        opponentLabel={opponentLabel}
        showPostGameReviewPrompt={modals.showPostGameReviewPrompt}
        winnerId={match.winnerId}
        youScore={match.players.you.score}
        opponentScore={match.players.bot.score}
        onSavePivotalReviewSummary={modals.savePivotalReviewSummary}
        onOpenHandScopedReview={modals.openHandScopedReview}
        onOpenReviewGameFromPrompt={modals.openReviewGameFromPrompt}
        onSkipPostGameReview={modals.skipPostGameReview}
      />
      <BotPostGameCard
        showPlayVsFritzResultOverlay={modals.showPlayVsFritzResultOverlay}
        winnerId={match.winnerId}
        opponentLabel={opponentLabel}
        youScore={match.players.you.score}
        botScore={match.players.bot.score}
        isJourneyTrial={modals.isJourneyTrial}
        hasConfirmedFritzRatingUpdate={modals.hasConfirmedFritzRatingUpdate}
        fritzNewGlickoRating={modals.fritzNewGlickoRating}
        fritzGlickoDelta={modals.fritzGlickoDelta}
        ghostResult={modals.ghostResult}
        onNavigate={navigation.onNavigate ?? null}
        botPostGameReviewEligible={modals.botPostGameReviewEligible}
        postGameAnalysisPending={modals.postGameAnalysisPending}
        postGameAnalysis={modals.postGameAnalysis}
        accuracyModelPending={modals.accuracyModelPending}
        reviewUnavailable={modals.reviewUnavailable}
        reviewUnavailableReason={modals.reviewUnavailableReason}
        decisionLedger={modals.decisionLedger}
        reviewRetryState={modals.reviewRetryState}
        onRematch={navigation.startFreshMatch}
        onChangeSetup={navigation.returnToFritzSetup}
        onHome={navigation.onNavigate ? navigation.goHome : undefined}
        exitJourneyTrial={navigation.exitJourneyTrial}
        onReviewGame={modals.openReviewGameFromPrompt}
        onRetryReview={modals.retryReview}
        onSaveGuestGame={navigation.onSaveGuestGame ?? undefined}
      />
      <BotGameOverModal
        showPostGameOverlays={modals.showPostGameOverlays}
        isPlayVsFritzGameOver={modals.isPlayVsFritzGameOver}
        isDailyFritzMode={modals.isDailyFritzMode}
        onDailyFritzGameComplete={navigation.onDailyFritzGameComplete ?? null}
        opponentLabel={opponentLabel}
        isGuidedMatchVictoryResult={modals.isGuidedMatchVictoryResult}
        winnerId={match.winnerId}
        dealSize={match.dealSize}
        youScore={match.players.you.score}
        botScore={match.players.bot.score}
        isGhostMode={modals.isGhostMode}
        ghostSubLabel={modals.ghostSubLabel}
        guidedMatchFinalDebrief={modals.guidedMatchFinalDebrief}
        enableGuidedMatchCandidateCapture={modals.enableGuidedMatchCandidateCapture}
        isJourneyTrial={modals.isJourneyTrial}
        guidedMatchCaptureStatus={modals.guidedMatchCaptureStatus}
        guidedMatchCandidateSaveStatus={modals.guidedMatchCandidateSaveStatus}
        ghostResultLoading={modals.ghostResultLoading}
        ghostResultError={modals.ghostResultError}
        dailyFritzRank={modals.dailyFritzRank}
        dailyFritzLeaderboard={modals.dailyFritzLeaderboard}
        ghostRatingDeltaLabel={modals.ghostRatingDeltaLabel}
        ghostResultMessage={modals.ghostResultMessage}
        canSaveGuidedMatchCandidate={modals.canSaveGuidedMatchCandidate}
        isGuidedMode={modals.isGuidedMode}
        ghostResult={modals.ghostResult}
        onExitMatch={navigation.exitMatch}
        onGoHome={navigation.goHome}
        onReturnToFritzSetup={navigation.returnToFritzSetup}
        onStartFreshMatch={navigation.startFreshMatch}
        onReturnToLearn={navigation.returnToLearn}
        onCopyGuidedMatchCandidate={modals.copyGuidedMatchCandidate}
        onSaveGuidedMatchCandidate={modals.saveGuidedMatchCandidate}
        onRetryDailyFritzCompletion={modals.retryDailyFritzCompletion}
        onNavigate={navigation.onNavigate ?? null}
      />
    </>
  );
}