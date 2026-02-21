import type { Move } from "../types";
import type { BotMatchState } from "./botEngine";
import { getLegalMoves, previewPlayMove } from "./botEngine";

export type BotDifficulty = "casual" | "standard" | "hard";

export interface BotChoice {
  move: Move;
  score: number;
  breakdown: {
    immediate: number;
    doubleBias: number;
    mobility: number;
    denial: number;
    unload: number;
    replyRisk: number;
  };
}

function pipExposureLikelihood(openEnds: number[]): number {
  const counts = new Array<number>(7).fill(0);
  for (const pip of openEnds) {
    if (pip >= 0 && pip <= 6) counts[pip] += 1;
  }
  // In double-six, each pip appears in 7 tiles. Lower is better for denial.
  return counts.reduce((sum, count) => sum + count * 7, 0);
}

function estimateMobility(remaining: { low: number; high: number }[], openEnds: number[]): number {
  let mobility = 0;
  for (const tile of remaining) {
    if (openEnds.some(p => p === tile.low || p === tile.high)) {
      mobility += 1;
    }
  }
  return mobility;
}

function estimateReplyRisk(openEnds: number[], openSum: number): number {
  // Rough one-ply risk proxy: number of ways opponent can likely score next.
  // Uses non-double replacement approximation.
  let risk = 0;
  for (const end of openEnds) {
    for (let nextPip = 0; nextPip <= 6; nextPip++) {
      const candidate = openSum - end + nextPip;
      if (candidate !== 0 && candidate % 5 === 0) {
        risk += 1;
      }
    }
  }
  return risk;
}

function tiebreak(move: Move): string {
  const tile = move.tile!;
  const total = tile.low + tile.high;
  const pos = move.position ?? "";
  return `${99 - total}-${99 - tile.high}-${99 - tile.low}-${pos}`;
}

export function chooseBotMove(
  state: BotMatchState,
  difficulty: BotDifficulty = "standard"
): BotChoice | null {
  const candidates: Move[] = getLegalMoves(state, "bot").filter(m => m.type === "play");

  if (candidates.length === 0) return null;

  const scored = candidates.map((move) => {
    const preview = previewPlayMove(state, "bot", move)!;
    const immediate = preview.immediateScore;
    const doubleBias = preview.isDouble ? 1 : 0;
    const mobility = estimateMobility(preview.nextHand, preview.openEnds);
    const denial = -pipExposureLikelihood(preview.openEnds);
    const unload = move.tile ? move.tile.low + move.tile.high : 0;
    const replyRisk = estimateReplyRisk(preview.openEnds, preview.openSum);

    let score = immediate * 100 + unload * 0.5;
    if (difficulty !== "casual") {
      score += mobility * 8 + denial * 0.35;
      score += doubleBias * 2;
    } else {
      score += doubleBias * 4;
    }
    if (difficulty === "hard" && !preview.turnContinues) {
      score -= replyRisk * 3.25;
    }

    return {
      move,
      score,
      breakdown: {
        immediate,
        doubleBias,
        mobility,
        denial,
        unload,
        replyRisk,
      },
      tie: tiebreak(move),
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.tie.localeCompare(b.tie);
  });

  return {
    move: scored[0].move,
    score: scored[0].score,
    breakdown: scored[0].breakdown,
  };
}
