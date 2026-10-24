import type { JourneyFeedbackId } from '../../journeyContentContract.ts';
import type { JourneyFeedbackAsset } from '../../journeyAuthoredLessonBundle.ts';
import { tileLabel, type GreedyLineFacts } from './greedyHandsFacts.ts';
import type { GreedyHandsPositionType } from './greedyHandsPositions.ts';

export const GREEDY_HANDS_FEEDBACK_ID = 'journey:feedback:greedy-hands' as JourneyFeedbackId;

export const GREEDY_HANDS_STATIC_FEEDBACK: Record<string, JourneyFeedbackAsset> = {
  illegal_action: { key: 'illegal_action', heading: 'That placement is not legal.', explanation: 'Choose a tile and an open end that match the board.', fritzRemark: null, retryExpected: true },
};

/**
 * Every sentence below is assembled from engine-derived facts (`GreedyLineFacts`), never typed per position, so a
 * score, an end or a reply in the copy cannot disagree with the board. The wording is deliberately about the
 * position: it says what was taken, where the turn ends, and what the tiles you cannot see COULD do — never what an
 * opponent will do.
 */

function scoreWords(points: number): string {
  return points > 0 ? `scores ${points}` : 'scores nothing';
}

/** What this play-out looks like, in order: the first play, why the turn goes on, any forced play, where it ends. */
export function describeTurn(facts: GreedyLineFacts): string {
  const [first, ...rest] = facts.steps;
  const parts: string[] = [`${tileLabel(first.tile)} on the ${first.position} ${scoreWords(first.points)}.`];
  let previous = first;
  for (const step of rest) {
    const reason = previous.points > 0 ? 'A score keeps your turn going' : 'A double keeps your turn going';
    parts.push(`${reason}, and ${tileLabel(step.tile)} is the only tile you can still play, so it goes on the ${step.position} and ${scoreWords(step.points)}.`);
    previous = step;
  }
  const [left, right] = facts.finalEnds;
  const doubleNote = facts.finalEndDoubles[0] || facts.finalEndDoubles[1] ? ' A double on an end counts both halves.' : '';
  parts.push(`Your turn ends with ${left} and ${right} open.${doubleNote}`);
  return parts.join(' ');
}

export function describeReply(facts: GreedyLineFacts): string {
  const { reply } = facts;
  if (reply.bestPoints === 0 || !reply.bestTile) return `None of the ${reply.unseenCount} tiles you can’t see scores off those ends.`;
  return `Of the ${reply.unseenCount} tiles you can’t see, ${reply.scoringTileCount} could score at once — most of all the ${tileLabel(reply.bestTile.tile)} on the ${reply.bestTile.onEnd} end, worth ${reply.bestPoints}.`;
}

function standing(net: number): string {
  if (net > 0) return `${net} ahead`;
  if (net === 0) return 'level';
  return `${-net} behind`;
}

export function describeLedger(facts: GreedyLineFacts): string {
  const best = facts.reply.bestPoints;
  return `You took ${facts.turnPoints}; the best single reply could take ${best}. That leaves you ${standing(facts.net)}.`;
}

/** A play in a few words, for comparing lines. */
export function shortLine(facts: GreedyLineFacts): string {
  const [first, second] = facts.steps;
  const base = `${tileLabel(first.tile)} on the ${first.position}`;
  return second ? `${base} (then ${tileLabel(second.tile)})` : base;
}

function outcomeOf(facts: GreedyLineFacts): string {
  return facts.reply.bestPoints === 0 ? 'leaves nothing that scores' : `leaves up to ${facts.reply.bestPoints} for them`;
}

export type MoveFeedbackInput = {
  key: string;
  positionType: GreedyHandsPositionType;
  role: 'accepted' | 'tempting' | 'other';
  chosen: GreedyLineFacts;
  accepted: GreedyLineFacts;
  tempting: GreedyLineFacts;
};

/** The feedback shown after a play, for one legal first play of one position. */
export function buildMoveFeedback(input: MoveFeedbackInput): JourneyFeedbackAsset {
  const { chosen, accepted, tempting, positionType, role, key } = input;
  const own = `${describeTurn(chosen)} ${describeReply(chosen)} ${describeLedger(chosen)}`;
  let heading: string;
  let explanation: string;
  if (role === 'accepted') {
    if (positionType === 'cost') {
      heading = chosen.turnPoints === 0 ? 'You gave up the points and left nothing behind.' : 'You took the score that costs less.';
      explanation = `${own} The bigger score, ${shortLine(tempting)}, takes ${tempting.turnPoints} but ${outcomeOf(tempting)}, so it ends ${standing(tempting.net)}.`;
    } else {
      heading = 'Take the points.';
      explanation = `${own} The quieter play, ${shortLine(tempting)}, looks safer — it ${outcomeOf(tempting)} — but it gives up ${chosen.turnPoints - tempting.turnPoints} points now, so you would end ${standing(tempting.net)}.`;
    }
  } else if (role === 'tempting') {
    if (positionType === 'cost') {
      heading = 'That score hands points straight back.';
      explanation = `${own} The quieter play, ${shortLine(accepted)}, ${outcomeOf(accepted)} and would have left you ${standing(accepted.net)}.`;
    } else {
      heading = 'Safer on the board, worse on the ledger.';
      explanation = `${own} Taking the points, ${shortLine(accepted)}, ${outcomeOf(accepted)}, but you take ${accepted.turnPoints} first, so you end ${standing(accepted.net)}.`;
    }
  } else {
    heading = 'There was a better line.';
    explanation = `${own} The best play was ${shortLine(accepted)}. ${describeLedger(accepted)}`;
  }
  return { key, heading, explanation, fritzRemark: null, retryExpected: role !== 'accepted' };
}
