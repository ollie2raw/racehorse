import type { AnalyzedMove } from '../../analyzer/moveAnalyzer';
import type { PivotalReviewMissReasonId } from './pivotalReviewMissReasons';

function tileLabel(tile?: [number, number]): string {
  if (!tile) return '—';
  return `[${tile[0]}|${tile[1]}]`;
}

export function buildMissReasonTakeaway(reasonId: PivotalReviewMissReasonId): string {
  switch (reasonId) {
    case 'missed_scoring_line':
      return 'When the open count is near a multiple of 5, check your full hand before playing.';
    case 'tunnel_vision_suit':
      return 'Before locking onto one suit, scan for the line that keeps the most tiles playable.';
    case 'feared_opponent_reply':
      return 'Ask whether the reply actually scores before you abandon your best line.';
    case 'misread_board_branch':
      return 'Re-check both open ends and any branch before you commit a tile.';
    case 'score_state_error':
      return 'Match your aggression to the scoreboard — points when behind, control when ahead.';
    case 'time_pressure_autopilot':
      return 'On pivotal turns, pause one beat: best score, then best board.';
    case 'tile_distribution_read':
      return 'Trust what you hold in hand — the engine pick is based on your actual tiles.';
    default:
      return 'Compare your play to the engine line before you commit.';
  }
}

export function buildMissReasonCoachingCopy(
  reasonId: PivotalReviewMissReasonId,
  move: AnalyzedMove,
): string {
  const played = tileLabel(move.playedTile);
  const best = tileLabel(move.bestTile ?? move.engineBestMove?.tile);
  const openSum = move.boardEnds[0] + move.boardEnds[1];

  switch (reasonId) {
    case 'missed_scoring_line':
      return `Missed scoring line — You had ${best} available which could score on this open count (${openSum}). Instead you played ${played}. When the count is near a multiple of 5, scan your full hand before committing.`;
    case 'tunnel_vision_suit':
      return `Tunnel vision on one suit — You locked onto ${played} while ${best} kept more suits live. Racehorse rewards flexibility: the best line often sheds pips without closing your next score.`;
    case 'feared_opponent_reply':
      return `Feared opponent reply — ${best} was stronger even if Fritz might answer. Ask whether the reply actually scores before you give up ${played === '—' ? 'your best line' : played}.`;
    case 'misread_board_branch':
      return `Misread board ends — The live ends were ${move.boardEnds[0]} and ${move.boardEnds[1]}. ${best} matched the board better than ${played}. Re-check both ends and any open branch before you play.`;
    case 'score_state_error':
      return `Score-state error — With the hand score where it was, ${best} fit the race better than ${played}. When you're behind, prioritize points; when ahead, don't donate easy scores.`;
    case 'time_pressure_autopilot':
      return `Autopilot — You played ${played} without comparing it to ${best}. On pivotal turns, pause one beat: best score, then best board.`;
    case 'tile_distribution_read':
      return `Tile read — This wasn't bad luck. ${best} was still the engine pick from your actual hand. Trust what you hold, not what you wish was left in the boneyard.`;
    default:
      return move.explanation;
  }
}
