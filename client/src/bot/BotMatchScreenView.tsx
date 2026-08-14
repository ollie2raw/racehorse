import { RotateOverlay } from '../components';
import type { BotMatchScreenViewProps } from './botMatchScreenViewTypes';
import { BotMatchBoardStage } from './view/board/BotMatchBoardStage.tsx';
import { BotMatchBoardStageFrame } from './view/board/BotMatchBoardStageFrame.tsx';
import { BotMatchHandTraySection } from './view/hand/BotMatchHandTraySection.tsx';
import { BotMatchGuidedLayoutSection } from './view/layouts/BotMatchGuidedLayoutSection.tsx';
import { BotMatchLiveLayoutSection } from './view/layouts/BotMatchLiveLayoutSection.tsx';
import { BotMatchLiveHudLeft, BotMatchLiveHudRight } from './view/hud/BotMatchLiveHud.tsx';
import { BotMatchLiveTurnHud } from './view/hud/BotMatchLiveTurnHud.tsx';
import { BotMatchPreGameDrawHud } from './view/hud/BotMatchPreGameDrawHud.tsx';
import { BotMatchInGameOverlays } from './view/overlays/BotMatchInGameOverlays.tsx';
import { BotMatchModalLayer } from './view/overlays/BotMatchModalLayer.tsx';
import { BotMatchScreenShell } from './view/shell/BotMatchScreenShell.tsx';
import { BotMatchGuidedV2BootErrorView } from './view/states/BotMatchGuidedV2BootErrorView.tsx';
import { BotMatchMalformedStateView } from './view/states/BotMatchMalformedStateView.tsx';
import { computeNormalHandRows } from './view/utils/botMatchHandLayout.ts';
import { selectTurnLabel } from './view/utils/botMatchHudLabels.ts';
import '../match/match-live.css';
import './PlayVsFritz.css';
import '../styles/shared-ui.css';
import '../learn/learn.css';
import '../match/preGameDraw/preGameDraw.css';

export function BotMatchScreenView({
  match,
  navigation,
  layout,
  hud,
  board,
  hand,
  coach,
  overlays,
  debug,
}: BotMatchScreenViewProps) {
  if (!match || !match.players || !match.players.you || !match.players.bot) {
    return (
      <BotMatchMalformedStateView
        onExitMatch={navigation.exitMatch}
        backLabel={layout.isJourneyTrial ? 'Back to Journey' : 'Back to Home'}
      />
    );
  }

  if (layout.isGuidedV2Mode && layout.guidedV2BootError) {
    return (
      <BotMatchGuidedV2BootErrorView
        guidedV2BootError={layout.guidedV2BootError}
        onBack={navigation.returnToLearn}
      />
    );
  }

  const isMobileViewport = typeof window !== 'undefined' && window.innerWidth <= 600;
  const normalHandRows = computeNormalHandRows(match.players.you.hand, {
    isLessonLayoutMode: layout.isLessonLayoutMode,
    lessonHandRowCount: hand.lessonHandRowCount,
    isMobileViewport,
  });
  const handCompactStacked = normalHandRows.length > 1;

  const handTray = (
    <BotMatchHandTraySection
      preGameDrawActive={hand.preGameDrawActive}
      hasPreGameDrawState={hud.preGameDraw.drawState != null}
      normalHandRows={normalHandRows}
      handTileSize={hand.handTileSize}
      handCompactStacked={handCompactStacked}
      selectedTile={hand.selectedTile}
      handActive={hand.handActive}
      botTurn={hand.botTurn}
      drawSequenceActive={hand.drawSequenceActive}
      drawPulseIndex={hand.drawPulseIndex}
      playableTileKeys={hand.playableTileKeys}
      isGuidedMode={hand.isGuidedMode}
      guidedScoringTiles={hand.guidedScoringTiles}
      showCoachedRecommendation={hand.showCoachedRecommendation}
      lessonRecommendedTileKey={hand.lessonRecommendedTileKey}
      handAreaRef={hand.handAreaRef}
      playerHand={match.players.you.hand}
      isDailyFritzMode={hand.isDailyFritzMode}
      setSelectedTile={hand.setSelectedTile}
      setSelectedController={hand.setSelectedController}
    />
  );

  const showTurnStatusCluster =
    hud.handActive
    && !hud.handReveal
    && !layout.isTransitioningRef.current;

  const turnLabel = selectTurnLabel(
    match,
    hud.opponentLabel,
    hud.botTurn,
    hud.fritzPresentation,
  );

  const boardStageInner = (
    <BotMatchBoardStage
      preGameDrawActive={hud.preGameDrawActive}
      preGameDraw={hud.preGameDraw}
      scoreToast={board.scoreToast}
      enableGuidedMatchCandidateCapture={board.enableGuidedMatchCandidateCapture}
      isJourneyTrial={board.isJourneyTrial}
      guidedMatchCaptureStatus={board.guidedMatchCaptureStatus}
      copyGuidedMatchCandidate={board.copyGuidedMatchCandidate}
      match={match}
      isLessonLayoutMode={layout.isLessonLayoutMode}
      openEndsSum={board.openEndsSum}
      boneyardRef={board.boneyardRef}
      isGhostMode={board.isGhostMode}
      ghostAgreementType={board.ghostAgreementType}
      ghostPlayedTile={board.ghostPlayedTile}
      isAuthoringMode={coach.isAuthoringMode}
      isAuthoringV2Mode={coach.isAuthoringV2Mode}
      isGuidedMode={coach.isGuidedMode}
      authoringV2PlayerMoveIndex={coach.authoringV2PlayerMoveIndex}
      authoringSteps={coach.authoringSteps}
      authoringNoteText={coach.authoringNoteText}
      setAuthoringNoteText={coach.setAuthoringNoteText}
      saveAuthoringNoteOnly={coach.saveAuthoringNoteOnly}
      frozenLesson={coach.frozenLesson}
      coach={coach.coach}
      playBestMove={coach.playBestMove}
      guidedCoachTip={coach.guidedCoachTip}
      showDebug={debug.showDebug}
      guidedInitSourceRef={debug.guidedInitSourceRef}
      isDailyFritzMode={layout.isDailyFritzMode}
      lastDailyFlowLabelRef={debug.lastDailyFlowLabelRef}
      getDebugSnapshot={debug.getDebugSnapshot}
      dailyFritzSubmitSucceededRef={debug.dailyFritzSubmitSucceededRef}
      boardRef={board.boardRef}
      lessonBoardPlacementMoves={board.lessonBoardPlacementMoves}
      activePlacementMoves={board.activePlacementMoves}
      selectedTile={board.selectedTile}
      lastPlayedTile={board.lastPlayedTile}
      onPositionClick={board.onPositionClick}
      enableDailyFritzProfiling={layout.enableDailyFritzProfiling}
      isMuted={layout.isMuted}
      setIsMuted={layout.setIsMuted}
      isFullscreen={layout.isFullscreen}
      toggleFullscreen={layout.toggleFullscreen}
      onRequestLeave={() => layout.setShowLeaveConfirm(true)}
    />
  );

  const boardStage = (
    <BotMatchBoardStageFrame
      boardStageRef={layout.boardStageRef}
      ghostBoardPulse={board.ghostBoardPulse}
    >
      {boardStageInner}
    </BotMatchBoardStageFrame>
  );

  const preGameDrawHud =
    hud.preGameDrawActive && hud.preGameDraw.drawState ? (
      <BotMatchPreGameDrawHud preGameDraw={hud.preGameDraw} opponentLabel={hud.opponentLabel} />
    ) : null;

  const liveTurnHud = showTurnStatusCluster ? (
    <BotMatchLiveTurnHud
      isDailyFritzMode={layout.isDailyFritzMode}
      dailyFritzPackage={hud.dailyFritzPackage}
      turnLabel={turnLabel}
      botTurn={hud.botTurn}
    />
  ) : null;

  const ariaLiveText = hud.handActive
    ? hud.botTurn
      ? `${hud.opponentLabel}'s turn. Your score: ${match.players.you.score}. ${hud.opponentLabel} score: ${match.players.bot.score}.`
      : `Your turn. Your score: ${match.players.you.score}. ${hud.opponentLabel} score: ${match.players.bot.score}.`
    : '';

  return (
    <>
      <RotateOverlay />
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
      >
        {ariaLiveText}
      </div>
      <BotMatchScreenShell
        rootRef={layout.rootRef}
        mode={layout.mode}
        isDailyFritzMode={layout.isDailyFritzMode}
        dailyFritzBoardHasPlay={layout.dailyFritzBoardHasPlay}
        isLessonLayoutMode={layout.isLessonLayoutMode}
      >
        <BotMatchModalLayer modals={overlays.modals} match={match} />
        {layout.isLessonLayoutMode ? (
          <BotMatchGuidedLayoutSection
            showLeaveConfirm={layout.showLeaveConfirm}
            setShowLeaveConfirm={layout.setShowLeaveConfirm}
            showFritzCoachingPanel={coach.showFritzCoachingPanel}
            lessonCoachPanelContent={coach.lessonCoachPanelContent}
            lessonCoachProgressLabel={coach.lessonCoachProgressLabel}
            lessonCoachProgressPct={coach.lessonCoachProgressPct}
            showFullCoachTip={coach.showFullCoachTip}
            setShowFullCoachTip={coach.setShowFullCoachTip}
            showLessonCoachPanel={coach.showLessonCoachPanel}
            showRecommendation={coach.showRecommendation}
            setShowRecommendation={coach.setShowRecommendation}
            canPlayCoachedMove={coach.canPlayCoachedMove}
            lessonCoachVm={coach.lessonCoachVm}
            playLessonBestMove={coach.playLessonBestMove}
            guidedFritzAnchorRef={coach.guidedFritzAnchorRef}
            setScoreTrackOpen={layout.setScoreTrackOpen}
            opponentLabel={hud.opponentLabel}
            match={match}
            botTurn={hud.botTurn}
            turnLabel={turnLabel}
            openEndsSum={board.openEndsSum}
            guidedBoneyardAnchorRef={coach.guidedBoneyardAnchorRef}
            boardStage={boardStage}
            handTray={handTray}
          />
        ) : (
          <BotMatchLiveLayoutSection
            boardStageRef={layout.boardStageRef}
            ghostBoardPulse={board.ghostBoardPulse}
            boardStageInner={boardStageInner}
            handTray={handTray}
            hudLeft={(
              <BotMatchLiveHudLeft
                opponentLabel={hud.opponentLabel}
                ghostSubLabel={hud.ghostSubLabel}
                opponentPillRef={hud.opponentPillRef}
                match={match}
                botTurn={hud.botTurn}
                drawStepBotHandCount={hud.drawStepBotHandCount}
                onOpenScoreTrack={() => layout.setScoreTrackOpen(true)}
              />
            )}
            hudCenter={preGameDrawHud ?? liveTurnHud}
            hudRight={(
              <BotMatchLiveHudRight
                match={match}
                botTurn={hud.botTurn}
                onOpenScoreTrack={() => layout.setScoreTrackOpen(true)}
              />
            )}
          />
        )}
        <BotMatchInGameOverlays {...overlays.inGame} />
      </BotMatchScreenShell>
    </>
  );
}
