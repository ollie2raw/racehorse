/** Miss-reason taxonomy from the Post-Game Review proposal (pick 1–2 per turn). */
export type PivotalReviewMissReasonId =
  | 'missed_scoring_line'
  | 'tunnel_vision_suit'
  | 'feared_opponent_reply'
  | 'misread_board_branch'
  | 'score_state_error'
  | 'time_pressure_autopilot'
  | 'tile_distribution_read';

export type PivotalReviewMissReason = {
  id: PivotalReviewMissReasonId;
  label: string;
};

export const PIVOTAL_REVIEW_MISS_REASONS: PivotalReviewMissReason[] = [
  { id: 'missed_scoring_line', label: "Didn't see scoring line" },
  { id: 'tunnel_vision_suit', label: 'Tunnel vision on one suit' },
  { id: 'feared_opponent_reply', label: 'Feared opponent reply' },
  { id: 'misread_board_branch', label: 'Misread board ends / branch' },
  { id: 'score_state_error', label: 'Score-state error (too safe/aggressive)' },
  { id: 'time_pressure_autopilot', label: 'Time pressure / autopilot' },
  { id: 'tile_distribution_read', label: 'Tile distribution / bad luck read' },
];

export const MAX_MISS_REASONS_PER_TURN = 2;

const MISS_REASON_LABEL_BY_ID = new Map(
  PIVOTAL_REVIEW_MISS_REASONS.map((reason) => [reason.id, reason.label]),
);

export function getMissReasonLabel(id: PivotalReviewMissReasonId): string {
  return MISS_REASON_LABEL_BY_ID.get(id) ?? id;
}
