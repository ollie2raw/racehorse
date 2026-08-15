import React from 'react';
import type { MoveEntry } from '../game/moveLogger';
import type { HandResult } from '../stakes/stakesEconomy';
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
  const [devStatsOverride, setDevStatsOverride] = React.useState<{
    won: boolean;
    stats: Omit<HandResult, 'won'>;
  } | null>(null);

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
      boneyardDisplayCount={board.boneyardDisplayCount}
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

  const stakesHeader = layout.mode === 'stakes' && layout.stakesConfig ? (
    <div className="stakes-in-game-header">
      <div className="stakes-in-game-info">
        <span className="stakes-in-game-mode-label">Stakes Match</span>
        <div className="stakes-in-game-details">
          <span>Table: <strong>{layout.stakesConfig.rivalLabel}</strong></span>
          <span>Contract: <strong>{layout.stakesConfig.contractLabel} (+{layout.stakesConfig.contractBonus})</strong></span>
        </div>
      </div>

      {import.meta.env.DEV && (
        <div className="flex gap-2 items-center">
          <span className="text-[11px] text-[#c77dff] font-mono uppercase font-bold mr-2">Dev Intercept:</span>
          <button className="stakes-dev-btn" onClick={() => {
            const youScore = match.players.you.score;
            const botScore = match.players.bot.score;
            setDevStatsOverride({
              won: true,
              stats: {
                scoreMargin: youScore - botScore,
                youGoOut: true,
                botPassCount: 1,
                youScoreFirst: true,
                youScore,
                botScore,
              },
            });
          }}>Force Win</button>
          <button className="stakes-dev-btn" onClick={() => {
            const youScore = match.players.you.score;
            const botScore = match.players.bot.score;
            setDevStatsOverride({
              won: false,
              stats: {
                scoreMargin: youScore - botScore,
                youGoOut: false,
                botPassCount: 0,
                youScoreFirst: false,
                youScore,
                botScore,
              },
            });
          }}>Force Loss</button>
          <button className="stakes-dev-btn" onClick={() => {
            const youScore = match.players.you.score;
            const botScore = match.players.bot.score;
            setDevStatsOverride({
              won: true,
              stats: {
                scoreMargin: 15,
                youGoOut: true,
                botPassCount: 2,
                youScoreFirst: true,
                youScore,
                botScore,
              },
            });
          }}>Force Contract</button>
        </div>
      )}

      <div className="stakes-in-game-hud-block">
        <div className="stakes-in-game-purse-box">
          <span className="stakes-hud-purse-label mr-3">PURSE AT START:</span>
          <span className="stakes-hud-purse-value">{layout.stakesConfig.entry} Entry</span>
        </div>
        <button
          className="stakes-dev-btn"
          style={{ borderColor: 'rgba(226, 92, 92, 0.4)', color: '#e25c5c' }}
          onClick={navigation.exitMatch}
        >
          Exit Run
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <RotateOverlay />
      <BotMatchScreenShell
        rootRef={layout.rootRef}
        mode={layout.mode}
        isDailyFritzMode={layout.isDailyFritzMode}
        dailyFritzBoardHasPlay={layout.dailyFritzBoardHasPlay}
        isLessonLayoutMode={layout.isLessonLayoutMode}
      >
        {stakesHeader}
        <BotMatchModalLayer
          modals={
            devStatsOverride
              ? {
                  ...overlays.modals,
                  handReveal: {
                    winner: devStatsOverride.won ? 'you' : 'bot',
                    reason: 'normal',
                } as unknown as NonNullable<typeof overlays.modals.handReveal>,
                }
              : overlays.modals
          }
          match={match}
          mode={layout.mode}
          onStakesProceed={
            layout.mode === 'stakes'
              ? () => {
                  if (devStatsOverride) {
                    layout.onStakesHandComplete?.(devStatsOverride.won, devStatsOverride.stats);
                    setDevStatsOverride(null);
                    return;
                  }
                  const won = overlays.modals.handReveal?.winner === 'you';
                  const youScore = match.players.you.score;
                  const botScore = match.players.bot.score;
                  const scoreMargin = youScore - botScore;
                  const youGoOut = overlays.modals.handReveal?.winner === 'you' && overlays.modals.handReveal?.reason !== 'blocked';
                  const moveLog = layout.replay?.moveLog ?? [];
                  const botPassCount = moveLog.filter((m: MoveEntry) => m.player === 'opponent' && m.action === 'pass').length;

                  let youScoreFirst = false;
                  const firstScoringMove = moveLog.find((m: MoveEntry) => m.pointsScored > 0);
                  if (firstScoringMove) {
                    youScoreFirst = firstScoringMove.player === 'you';
                  } else {
                    youScoreFirst = overlays.modals.handReveal?.winner === 'you';
                  }

                  layout.onStakesHandComplete?.(won, {
                    scoreMargin,
                    youGoOut,
                    botPassCount,
                    youScoreFirst,
                    youScore,
                    botScore,
                  });
                }
              : undefined
          }
        />
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
