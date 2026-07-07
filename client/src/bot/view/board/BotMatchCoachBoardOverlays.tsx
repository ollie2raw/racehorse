import type { Dispatch, SetStateAction } from 'react';
import type { AuthoredStep } from '../../../learn/guidedAuthoring.ts';
import type { FrozenLesson } from '../../../learn/guidedAuthoring.ts';
import type { BotMatchState } from '../../botEngine.ts';
import type { GuidedCoachTip } from '../../botMatchScreenTypes.ts';
import type { LearningCoachApi } from '../../../learning/useLearningCoach.ts';
import CoachPanel from '../../../learning/CoachPanel.tsx';
import AuthoringCoachPanel from '../../../learn/AuthoringCoachPanel.tsx';

type BotMatchCoachBoardOverlaysProps = {
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  isGuidedMode: boolean;
  isLessonLayoutMode: boolean;
  match: BotMatchState;
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
};

export function BotMatchCoachBoardOverlays({
  isAuthoringMode,
  isAuthoringV2Mode,
  isGuidedMode,
  isLessonLayoutMode,
  match,
  authoringV2PlayerMoveIndex,
  authoringSteps,
  authoringNoteText,
  setAuthoringNoteText,
  saveAuthoringNoteOnly,
  frozenLesson,
  coach,
  playBestMove,
  guidedCoachTip,
  showDebug,
}: BotMatchCoachBoardOverlaysProps) {
  return (
    <>
      {(isAuthoringMode || isAuthoringV2Mode)
        && match.currentPlayer === 'you'
        && !match.handOver
        && !match.gameOver && (
        <AuthoringCoachPanel
          stepIndex={isAuthoringV2Mode ? authoringV2PlayerMoveIndex : authoringSteps.length}
          noteText={authoringNoteText}
          onNoteChange={setAuthoringNoteText}
          onSaveNote={saveAuthoringNoteOnly}
        />
      )}
      {isGuidedMode && !isAuthoringMode && !isLessonLayoutMode && !frozenLesson && (
        <CoachPanel
          preMoveRec={coach.preMoveRec}
          preMoveEval={coach.preMoveEval}
          postMoveFeedback={coach.postMoveFeedback}
          postMoveEval={coach.postMoveEval}
          onPlayBest={playBestMove}
          onDismissFeedback={coach.dismissFeedback}
          isOnlyPlay={guidedCoachTip?.isOnlyPlay ?? false}
          currentPlayer={match.currentPlayer === 'you' ? 'you' : 'bot'}
          turnIndex={match.turnIndex ?? 0}
          debugMode={showDebug}
        />
      )}
    </>
  );
}