/** Open-end sum pill — always shows canonical geometry sum from board tiles. */

import {
  assertDisplayedOpenCountMatchesCanonical,
  computeOpenEndsSum,
  explainOpenEndsSum,
  getScoringOpenEndPips,
  hydrateBoardForOpenEnds,
} from '../game/openEndsGeometry';
import type { BoardState } from '../types';

export interface BoardOpenEndsPillProps {
  board: BoardState | null;
  /**
   * Optional dev cross-check only. The displayed value always comes from
   * `computeOpenEndsSum(board)` — never from this prop alone.
   */
  openEndsSum?: number;
  visible?: boolean;
}

export function BoardOpenEndsPill({ board, openEndsSum, visible = true }: BoardOpenEndsPillProps) {
  if (!visible) return null;

  // Fresh hands start with board === null; still show "0" until the first tile is played.
  const scoringBoard = board ? hydrateBoardForOpenEnds(board) : null;
  const canonical = scoringBoard ? computeOpenEndsSum(scoringBoard) : (openEndsSum ?? 0);
  const debugPayload = scoringBoard
    ? {
        canonical,
        pips: getScoringOpenEndPips(scoringBoard),
        contributions: explainOpenEndsSum(scoringBoard),
        board: {
          mainLine: scoringBoard.mainLine,
          hubDoubles: scoringBoard.hubDoubles,
        },
      }
    : null;
  if (scoringBoard && openEndsSum !== undefined) {
    assertDisplayedOpenCountMatchesCanonical(scoringBoard, openEndsSum, 'BoardOpenEndsPill');
  }

  if (import.meta.env.DEV && debugPayload) {
    console.log('[open-ends-debug]', debugPayload);
    // #region agent log
    fetch('http://127.0.0.1:7933/ingest/9cab376f-7897-4cfa-8543-b458c17de979', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '246760' },
      body: JSON.stringify({
        sessionId: '246760',
        runId: 'open-pill',
        hypothesisId: 'live-board',
        location: 'BoardOpenEndsPill.tsx',
        message: 'open ends pill render',
        data: {
          canonical: debugPayload.canonical,
          contributionCount: debugPayload.contributions.length,
          contributions: debugPayload.contributions.map((c) => ({
            source: c.source,
            tile: c.tile,
            pip: c.pip,
            value: c.value,
          })),
          branchLaneHubs: debugPayload.board.hubDoubles
            .filter((h) => h.laneType === 'branch')
            .map((h) => ({
              hubValue: h.hubValue,
              laneRef: h.laneRef,
              branchDepth: h.branchDepth,
              isCrossed: h.isCrossed,
            })),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }

  return (
    <>
      <div className="open-ends-pill board-corner-pill board-corner-pill--tl" aria-label={`${canonical} open ends`}>
        <span className="open-ends-pill__label">Open</span>
        <span className="open-ends-count">{canonical}</span>
      </div>
      {import.meta.env.DEV && debugPayload ? (
        <details className="open-ends-debug board-corner-pill-debug">
          <summary>open-debug</summary>
          <pre>{JSON.stringify(debugPayload, null, 2)}</pre>
        </details>
      ) : null}
    </>
  );
}
