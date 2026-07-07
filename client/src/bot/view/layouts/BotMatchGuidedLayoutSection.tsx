import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react';
import { BotGuidedMatchPanel } from '../../BotGuidedMatchPanel.tsx';
import type { BotMatchState } from '../../botEngine.ts';
import type { GuidedCoachViewModel } from '../../botMatchScreenTypes.ts';

export type BotMatchGuidedLayoutSectionProps = {
  showLeaveConfirm: boolean;
  setShowLeaveConfirm: Dispatch<SetStateAction<boolean>>;
  showFritzCoachingPanel: boolean;
  lessonCoachPanelContent: {
    title: string;
    bodyParagraphs: string[];
    previewText: string;
    showMore: boolean;
    showFooter: boolean;
    progressChipLabel: string;
    contextChips: string[];
  } | null;
  lessonCoachProgressLabel: string;
  lessonCoachProgressPct: number;
  showFullCoachTip: boolean;
  setShowFullCoachTip: Dispatch<SetStateAction<boolean>>;
  showLessonCoachPanel: boolean;
  showRecommendation: boolean;
  setShowRecommendation: Dispatch<SetStateAction<boolean>>;
  canPlayCoachedMove: boolean;
  lessonCoachVm: GuidedCoachViewModel | null;
  playLessonBestMove: () => void;
  guidedFritzAnchorRef: RefObject<HTMLButtonElement | null>;
  setScoreTrackOpen: Dispatch<SetStateAction<boolean>>;
  opponentLabel: string;
  match: BotMatchState;
  botTurn: boolean;
  turnLabel: string;
  openEndsSum: number;
  guidedBoneyardAnchorRef: RefObject<HTMLDivElement | null>;
  boardStage: ReactNode;
  handTray: ReactNode;
};

export function BotMatchGuidedLayoutSection(props: BotMatchGuidedLayoutSectionProps) {
  return (
    <BotGuidedMatchPanel
      showLeaveConfirm={props.showLeaveConfirm}
      setShowLeaveConfirm={props.setShowLeaveConfirm}
      showFritzCoachingPanel={props.showFritzCoachingPanel}
      lessonCoachPanelContent={props.lessonCoachPanelContent}
      lessonCoachProgressLabel={props.lessonCoachProgressLabel}
      lessonCoachProgressPct={props.lessonCoachProgressPct}
      showFullCoachTip={props.showFullCoachTip}
      setShowFullCoachTip={props.setShowFullCoachTip}
      showLessonCoachPanel={props.showLessonCoachPanel}
      showRecommendation={props.showRecommendation}
      setShowRecommendation={props.setShowRecommendation}
      canPlayCoachedMove={props.canPlayCoachedMove}
      lessonCoachVm={props.lessonCoachVm}
      playLessonBestMove={props.playLessonBestMove}
      guidedFritzAnchorRef={props.guidedFritzAnchorRef}
      setScoreTrackOpen={props.setScoreTrackOpen}
      opponentLabel={props.opponentLabel}
      match={props.match}
      botTurn={props.botTurn}
      turnLabel={props.turnLabel}
      openEndsSum={props.openEndsSum}
      guidedBoneyardAnchorRef={props.guidedBoneyardAnchorRef}
      boardStage={props.boardStage}
      handTray={props.handTray}
    />
  );
}