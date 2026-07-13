import type { JourneyFeedbackId } from '../../journeyContentContract.ts';

export type OpenEndDisciplineFeedback = {
  key: string;
  heading: string;
  explanation: string;
  fritzRemark: string | null;
  retryExpected: boolean;
};

export const OPEN_END_DISCIPLINE_FEEDBACK_ID = 'journey:feedback:open-end-discipline' as JourneyFeedbackId;

export const OPEN_END_DISCIPLINE_FEEDBACK: Record<string, OpenEndDisciplineFeedback> = {
  controlled_one_end: {
    key: 'controlled_one_end',
    heading: 'You kept the reply narrow.',
    explanation: 'The move changed one open end and left the other controlled. Read what Fritz can play next, not only what you can play now.',
    fritzRemark: null,
    retryExpected: false,
  },
  opened_both_ends_without_compensation: {
    key: 'opened_both_ends_without_compensation',
    heading: 'Two open ends gave Fritz more room.',
    explanation: 'The play was legal, but it exposed a second lane without a scoring or pressure reason. The next position is more flexible for Fritz than for you.',
    fritzRemark: 'A legal move can still hand over the next reply.',
    retryExpected: true,
  },
  gave_opponent_flexible_reply: {
    key: 'gave_opponent_flexible_reply',
    heading: 'Fritz got the wider reply.',
    explanation: 'After the move, the new end gave Fritz more useful matches. Compare the ends after the play before you commit.',
    fritzRemark: 'Count what comes after the tile.',
    retryExpected: true,
  },
  preserved_pressure: {
    key: 'preserved_pressure',
    heading: 'Pressure stayed on the board.',
    explanation: 'You changed the position without giving Fritz a free lane. That is open-end discipline: control the consequence, not a slogan.',
    fritzRemark: null,
    retryExpected: false,
  },
  recognized_exception: {
    key: 'recognized_exception',
    heading: 'You recognized the exception.',
    explanation: 'Opening both sides of a double is not automatically wrong. In this position the move is legal and defensible because the authored board does not give Fritz a useful punishment lane.',
    fritzRemark: 'You read what came after the move. That’s the point.',
    retryExpected: false,
  },
  illegal_action: {
    key: 'illegal_action',
    heading: 'That placement is not legal.',
    explanation: 'Choose a tile and board end that match one of the live ends.',
    fritzRemark: null,
    retryExpected: true,
  },
};

export function getOpenEndDisciplineFeedback(key: string): OpenEndDisciplineFeedback | null {
  return OPEN_END_DISCIPLINE_FEEDBACK[key] ?? null;
}
