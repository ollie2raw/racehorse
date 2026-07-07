/** Hand / match transition phases for local bot matches. */
export type HandLifecyclePhase =
  | 'playing'
  | 'resolving-hand'
  | 'showing-hand-result'
  | 'advancing-hand'
  | 'dealing-next-hand'
  | 'playing-next-hand'
  | 'set-complete'
  | 'match-complete'
  | 'error';

export type HandLifecycleLogPayload = {
  phase: HandLifecyclePhase;
  previousPhase?: HandLifecyclePhase;
  mode?: string;
  handNumber?: number;
  detail?: Record<string, unknown>;
  hypothesisId?: string;
};