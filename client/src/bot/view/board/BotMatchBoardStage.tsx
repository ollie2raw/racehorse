import type { Dispatch, RefObject, SetStateAction } from 'react';
import {
  Board,
  BoardOpenEndsPill,
  BoneyardCountPill,
} from '../../../components';
import type { BoardHandle } from '../../../components';
import { ErrorBoundary } from '../../../components/ErrorBoundary.tsx';
import { PreGameTileDrawBoard } from '../../../match/preGameDraw/PreGameTileDrawBoard.tsx';
import type { Move, PlacementPosition, Tile } from '../../../types.ts';
import type { AuthoredStep } from '../../../learn/guidedAuthoring.ts';
import type { FrozenLesson } from '../../../learn/guidedAuthoring.ts';
import type { GuidedMatchCaptureStatus } from '../../../learn/guidedMatch/guidedMatchCapture.ts';
import type { HandLifecycleDebugSnapshot } from '../../../modules/match/index.ts';
import type { LearningCoachApi } from '../../../learning/useLearningCoach.ts';
import type { BotMatchState } from '../../botEngine.ts';
import type { GuidedCoachTip } from '../../botMatchScreenTypes.ts';
import type { BotMatchViewPreGameDraw, BotMatchViewScoreToast } from '../../view-model/botMatchViewModelTypes.ts';
import { BotMatchBoardControlsTray } from './BotMatchBoardControlsTray.tsx';
import { BotMatchBoardDebugOverlays } from './BotMatchBoardDebugOverlays.tsx';
import { BotMatchCoachBoardOverlays } from './BotMatchCoachBoardOverlays.tsx';
import { BotMatchGhostBoardOverlays } from './BotMatchGhostBoardOverlays.tsx';
import { BotMatchScoreToastOverlay } from './BotMatchScoreToastOverlay.tsx';

export type BotMatchBoardStageProps = {
  preGameDrawActive: boolean;
  preGameDraw: BotMatchViewPreGameDraw;
  scoreToast: BotMatchViewScoreToast | null;
  enableGuidedMatchCandidateCapture: boolean;
  isJourneyTrial: boolean;
  guidedMatchCaptureStatus: GuidedMatchCaptureStatus;
  copyGuidedMatchCandidate: () => void;
  match: BotMatchState;
  isLessonLayoutMode: boolean;
  openEndsSum: number;
  boneyardRef: RefObject<HTMLDivElement | null>;
  boneyardDisplayCount?: number | null;
  isGhostMode: boolean;
  ghostAgreementType: 'agrees' | 'heuristic' | null;
  ghostPlayedTile: Tile | null;
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  isGuidedMode: boolean;
  authoringV2PlayerMoveIndex: number;
  authoringSteps: AuthoredStep[];
  authoringNoteText: string;
  setAuthoringNoteText: Dispatch<SetStateAction<string>>;
  saveAuthoringNoteOnly: () => void;
  frozenLesson: FrozenLesson | null;
  coach: LearningCoachApi;
  playBestMove: () => void;
  guidedCoachTip: GuidedCoachTip | null;
  showDebug: boolean;
  guidedInitSourceRef: RefObject<string | null>;
  isDailyFritzMode: boolean;
  lastDailyFlowLabelRef: RefObject<string>;
  getDebugSnapshot: () => HandLifecycleDebugSnapshot;
  dailyFritzSubmitSucceededRef: RefObject<boolean>;
  boardRef: RefObject<BoardHandle | null>;
  lessonBoardPlacementMoves: Move[];
  activePlacementMoves: Move[];
  selectedTile: Tile | null;
  lastPlayedTile: Tile | null;
  onPositionClick: (position: PlacementPosition) => void;
  enableDailyFritzProfiling: boolean;
  isMuted: boolean;
  setIsMuted: Dispatch<SetStateAction<boolean>>;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  onRequestLeave: () => void;
};

export function BotMatchBoardStage(props: BotMatchBoardStageProps) {
  const {
    preGameDrawActive,
    preGameDraw,
    scoreToast,
    match,
    isLessonLayoutMode,
    openEndsSum,
    boneyardRef,
    boneyardDisplayCount = null,
    boardRef,
    lessonBoardPlacementMoves,
    activePlacementMoves,
    selectedTile,
    lastPlayedTile,
    onPositionClick,
    enableDailyFritzProfiling,
    isMuted,
    setIsMuted,
    isFullscreen,
    toggleFullscreen,
    onRequestLeave,
  } = props;

  if (preGameDrawActive && preGameDraw.drawState) {
    return (
      <PreGameTileDrawBoard
        drawState={preGameDraw.drawState}
        isPlayerPickEnabled={preGameDraw.isPlayerPickEnabled}
        onTileTap={preGameDraw.handlePlayerTileTap}
      />
    );
  }

  return (
    <>
      {scoreToast && <BotMatchScoreToastOverlay scoreToast={scoreToast} />}
      <BotMatchBoardDebugOverlays
        enableGuidedMatchCandidateCapture={props.enableGuidedMatchCandidateCapture}
        isJourneyTrial={props.isJourneyTrial}
        guidedMatchCaptureStatus={props.guidedMatchCaptureStatus}
        onCopyGuidedMatchCandidate={props.copyGuidedMatchCandidate}
        isGuidedMode={props.isGuidedMode}
        showDebug={props.showDebug}
        frozenLesson={props.frozenLesson}
        match={match}
        guidedInitSourceRef={props.guidedInitSourceRef}
        isDailyFritzMode={props.isDailyFritzMode}
        lastDailyFlowLabelRef={props.lastDailyFlowLabelRef}
        getDebugSnapshot={props.getDebugSnapshot}
        dailyFritzSubmitSucceededRef={props.dailyFritzSubmitSucceededRef}
      />
      {!match.gameOver && !isLessonLayoutMode && (
        <div className="rh-board-meta-bar" data-ui="board-meta">
          <BoardOpenEndsPill board={match.board} openEndsSum={openEndsSum} />
          <BoneyardCountPill ref={boneyardRef} count={boneyardDisplayCount ?? match.boneyard.length} />
        </div>
      )}
      <BotMatchGhostBoardOverlays
        isGhostMode={props.isGhostMode}
        ghostAgreementType={props.ghostAgreementType}
        ghostPlayedTile={props.ghostPlayedTile}
      />
      <BotMatchCoachBoardOverlays
        isAuthoringMode={props.isAuthoringMode}
        isAuthoringV2Mode={props.isAuthoringV2Mode}
        isGuidedMode={props.isGuidedMode}
        isLessonLayoutMode={isLessonLayoutMode}
        match={match}
        authoringV2PlayerMoveIndex={props.authoringV2PlayerMoveIndex}
        authoringSteps={props.authoringSteps}
        authoringNoteText={props.authoringNoteText}
        setAuthoringNoteText={props.setAuthoringNoteText}
        saveAuthoringNoteOnly={props.saveAuthoringNoteOnly}
        frozenLesson={props.frozenLesson}
        coach={props.coach}
        playBestMove={props.playBestMove}
        guidedCoachTip={props.guidedCoachTip}
        showDebug={props.showDebug}
      />
      <ErrorBoundary
        context="board"
        fallback={(
          <div
            style={{
              height: '100%',
              display: 'grid',
              placeItems: 'center',
              color: '#6b7a94',
            }}
          >
            Board unavailable — please refresh
          </div>
        )}
      >
        <Board
          ref={boardRef}
          showZoomTray={isLessonLayoutMode}
          board={match.board}
          legalMoves={isLessonLayoutMode ? lessonBoardPlacementMoves : activePlacementMoves}
          selectedTile={selectedTile}
          handNumber={match.handNumber}
          handOver={match.handOver}
          gameOver={match.gameOver}
          lastPlayedTile={lastPlayedTile}
          onPositionClick={onPositionClick}
          tileSize={84}
          profileDailyFritz={enableDailyFritzProfiling}
          fitMode="default"
        />
      </ErrorBoundary>
      {!isLessonLayoutMode && (
        <BotMatchBoardControlsTray
          boardRef={boardRef}
          isMuted={isMuted}
          setIsMuted={setIsMuted}
          isFullscreen={isFullscreen}
          toggleFullscreen={toggleFullscreen}
          onRequestLeave={onRequestLeave}
        />
      )}
    </>
  );
}