import type { BoardState, Tile } from '../../../types.ts';

/**
 * Greedy Hands — the authored positions, as DATA.
 *
 * Provenance. Each board was built by the real engine (`applyPlayMove` from a single tile, so orientations and
 * open ends are the engine's own) and each position was found by a seeded search that played out EVERY legal first
 * play through the engine — the whole turn, because a score or a double keeps your turn going — and then asked what
 * the tiles you cannot see could score back on the ends that play leaves. A position was kept only if every legal
 * first play resolves to a deterministic end of turn (see `greedyHandsFacts.ts`) and the intended answer is the
 * single best by points taken minus the most one unseen tile could take back.
 *
 * Nothing in this file is trusted at runtime: `greedyHandsValidation.ts` re-derives every fact from the engine
 * when the content registry is built, and fails the build of the registry if a position stops being what it claims.
 *
 * `type` is the teaching role of the position:
 *   cost — the play that scores most hands back more than the quieter play does;
 *   take — the play that scores most is right even though the quieter play looks safer.
 * `accepted` is the intended answer; `tempting` is the plausible wrong one ("greed" for cost, "caution" for take).
 */

export type GreedyHandsPositionType = 'cost' | 'take';

export type GreedyHandsPositionSpec = {
  id: string;
  type: GreedyHandsPositionType;
  board: BoardState;
  rack: Tile[];
  /** `<low>-<high>@<left|right>` */
  accepted: string;
  tempting: string;
};

const POSITIONS_JSON = `[
{"id":"demo","type":"cost","board":{"mainLine":[{"tile":{"low":4,"high":0},"orientation":"horizontal-normal"}],"leftEnd":4,"rightEnd":0,"leftEndIsDouble":false,"rightEndIsDouble":false,"hubDoubles":[]},"rack":[{"low":3,"high":5},{"low":0,"high":2},{"low":3,"high":4},{"low":0,"high":6},{"low":1,"high":3}],"accepted":"3-4@left","tempting":"0-6@right"},
{"id":"guided","type":"cost","board":{"mainLine":[{"tile":{"low":2,"high":4},"orientation":"horizontal-normal"},{"tile":{"low":4,"high":6},"orientation":"horizontal-normal"}],"leftEnd":2,"rightEnd":6,"leftEndIsDouble":false,"rightEndIsDouble":false,"hubDoubles":[]},"rack":[{"low":4,"high":4},{"low":0,"high":0},{"low":1,"high":6},{"low":3,"high":6},{"low":2,"high":6}],"accepted":"2-6@left","tempting":"3-6@right"},
{"id":"practice-cost-1","type":"cost","board":{"mainLine":[{"tile":{"low":5,"high":4},"orientation":"horizontal-normal"}],"leftEnd":5,"rightEnd":4,"leftEndIsDouble":false,"rightEndIsDouble":false,"hubDoubles":[]},"rack":[{"low":1,"high":5},{"low":5,"high":6},{"low":3,"high":4},{"low":0,"high":0}],"accepted":"1-5@left","tempting":"5-6@left"},
{"id":"practice-cost-2","type":"cost","board":{"mainLine":[{"tile":{"low":0,"high":4},"orientation":"horizontal-flipped"},{"tile":{"low":0,"high":6},"orientation":"horizontal-normal"}],"leftEnd":4,"rightEnd":6,"leftEndIsDouble":false,"rightEndIsDouble":false,"hubDoubles":[]},"rack":[{"low":1,"high":6},{"low":2,"high":3},{"low":4,"high":5},{"low":5,"high":6}],"accepted":"4-5@left","tempting":"1-6@right"},
{"id":"practice-cost-3","type":"cost","board":{"mainLine":[{"tile":{"low":1,"high":3},"orientation":"horizontal-flipped"},{"tile":{"low":1,"high":1},"orientation":"horizontal-normal"}],"leftEnd":3,"rightEnd":1,"leftEndIsDouble":false,"rightEndIsDouble":false,"hubDoubles":[]},"rack":[{"low":4,"high":6},{"low":1,"high":4},{"low":1,"high":2},{"low":4,"high":5},{"low":3,"high":6}],"accepted":"3-6@left","tempting":"1-2@right"},
{"id":"practice-take-1","type":"take","board":{"mainLine":[{"tile":{"low":4,"high":6},"orientation":"horizontal-normal"},{"tile":{"low":6,"high":6},"orientation":"horizontal-normal"}],"leftEnd":4,"rightEnd":6,"leftEndIsDouble":false,"rightEndIsDouble":false,"hubDoubles":[]},"rack":[{"low":2,"high":3},{"low":4,"high":4},{"low":0,"high":6},{"low":3,"high":5}],"accepted":"4-4@left","tempting":"0-6@right"},
{"id":"practice-take-2","type":"take","board":{"mainLine":[{"tile":{"low":2,"high":5},"orientation":"horizontal-normal"},{"tile":{"low":4,"high":5},"orientation":"horizontal-flipped"}],"leftEnd":2,"rightEnd":4,"leftEndIsDouble":false,"rightEndIsDouble":false,"hubDoubles":[]},"rack":[{"low":0,"high":4},{"low":0,"high":1},{"low":2,"high":6},{"low":0,"high":3}],"accepted":"2-6@left","tempting":"0-4@right"},
{"id":"practice-take-3","type":"take","board":{"mainLine":[{"tile":{"low":0,"high":6},"orientation":"horizontal-normal"},{"tile":{"low":6,"high":6},"orientation":"horizontal-normal"}],"leftEnd":0,"rightEnd":6,"leftEndIsDouble":false,"rightEndIsDouble":false,"hubDoubles":[]},"rack":[{"low":4,"high":6},{"low":2,"high":2},{"low":0,"high":3},{"low":0,"high":2}],"accepted":"0-3@left","tempting":"4-6@right"},
{"id":"proof-1","type":"cost","board":{"mainLine":[{"tile":{"low":1,"high":5},"orientation":"horizontal-normal"},{"tile":{"low":5,"high":0},"orientation":"horizontal-normal"}],"leftEnd":1,"rightEnd":0,"leftEndIsDouble":false,"rightEndIsDouble":false,"hubDoubles":[]},"rack":[{"low":3,"high":6},{"low":0,"high":4},{"low":6,"high":6},{"low":0,"high":1}],"accepted":"0-1@left","tempting":"0-4@right"},
{"id":"proof-2","type":"take","board":{"mainLine":[{"tile":{"low":1,"high":3},"orientation":"horizontal-normal"},{"tile":{"low":3,"high":4},"orientation":"horizontal-normal"}],"leftEnd":1,"rightEnd":4,"leftEndIsDouble":false,"rightEndIsDouble":false,"hubDoubles":[]},"rack":[{"low":1,"high":6},{"low":2,"high":2},{"low":0,"high":0},{"low":1,"high":4},{"low":3,"high":5}],"accepted":"1-6@left","tempting":"1-4@right"},
{"id":"proof-3","type":"cost","board":{"mainLine":[{"tile":{"low":0,"high":5},"orientation":"horizontal-normal"},{"tile":{"low":5,"high":4},"orientation":"horizontal-normal"}],"leftEnd":0,"rightEnd":4,"leftEndIsDouble":false,"rightEndIsDouble":false,"hubDoubles":[]},"rack":[{"low":0,"high":6},{"low":3,"high":4},{"low":0,"high":1},{"low":3,"high":3}],"accepted":"0-1@left","tempting":"0-6@left"},
{"id":"proof-4","type":"take","board":{"mainLine":[{"tile":{"low":4,"high":6},"orientation":"horizontal-flipped"},{"tile":{"low":4,"high":4},"orientation":"horizontal-normal"}],"leftEnd":6,"rightEnd":4,"leftEndIsDouble":false,"rightEndIsDouble":false,"hubDoubles":[]},"rack":[{"low":5,"high":5},{"low":0,"high":2},{"low":6,"high":6},{"low":0,"high":4}],"accepted":"6-6@left","tempting":"0-4@right"}
]`;

export const GREEDY_HANDS_POSITION_SPECS: ReadonlyArray<GreedyHandsPositionSpec> = JSON.parse(POSITIONS_JSON) as GreedyHandsPositionSpec[];
