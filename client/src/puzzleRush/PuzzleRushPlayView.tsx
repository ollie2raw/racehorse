import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board, RotateOverlay } from '../components';
import { MatchLiveLayout } from '../match/board';
import { applyPlayMove, getLegalMoves, type BotMatchState } from '../bot/botEngine';
import { tileEquals } from '../game/tileUtils';
import type { Move, Tile } from '../types';
import { DailyPuzzleSoloHandDock } from '../dailyPuzzle/DailyPuzzleSoloHandDock';
import { useResponsiveHandTileSize } from '../dailyPuzzle/useResponsiveHandTileSize';
import {
  evaluateOneTurnHighScoreMoveOutcome,
  isDominoDouble,
  shouldAutoFailOneTurnHighScoreWithNoLegalMoves,
  shouldRecoverCompletedOneTurnHighScore,
} from '../dailyPuzzle/dailyPuzzlePlayMoveCompletion';
import { RushHudStageMeter } from './RushHudStageMeter';
import { formatClock } from './rushScoring';
import type { PuzzleRushPuzzle, PuzzleRushStage, RushPuzzleResult } from './types';

/**
 * The board for one rush puzzle.
 *
 * Reuses the daily-puzzle solving stack wholesale — `Board`, `MatchLiveLayout`,
 * `DailyPuzzleSoloHandDock`, `applyPlayMove`/`getLegalMoves`, and the
 * `evaluateOneTurnHighScoreMoveOutcome` terminal rules — so a rush puzzle plays
 * exactly like a ladder puzzle. Only the surrounding run/clock chrome is new.
 *
 * ⚠️  `src/dailyPuzzle/` IS NOT FULLY DEAD CODE.
 *
 * The ladder *screens* are unreachable (Daily Puzzle launches Rush now), but
 * this file depends on three live modules from that directory:
 *   - `DailyPuzzleSoloHandDock`            (the hand dock rendered below)
 *   - `useResponsiveHandTileSize`          (hand tile sizing)
 *   - `dailyPuzzlePlayMoveCompletion`      (the terminal-outcome rules)
 * Deleting `src/dailyPuzzle/` wholesale would break Puzzle Rush. Move these
 * three out first if that directory is ever cleaned up.
 */

function createRushMatchState(puzzle: PuzzleRushPuzzle): BotMatchState {
  return {
    players: {
      you: { hand: [...puzzle.startingHand], score: 0 },
      bot: { hand: [], score: 0 },
    },
    board: {
      ...puzzle.startingBoard,
      mainLine: [...puzzle.startingBoard.mainLine],
      hubDoubles: [...puzzle.startingBoard.hubDoubles],
    },
    boneyard: [],
    deadTiles: [],
    handOpen: true,
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 1,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 999,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: puzzle.dealSize === 14 ? 14 : 7,
  };
}

export function PuzzleRushPlayView({
  puzzle,
  stages,
  completedOrdinals,
  secondsLeft,
  clientTally,
  lastBonusSeconds,
  totalPuzzles,
  onPuzzleFinished,
  onQuit,
}: {
  puzzle: PuzzleRushPuzzle;
  stages: PuzzleRushStage[];
  completedOrdinals: number[];
  secondsLeft: number;
  clientTally: number;
  lastBonusSeconds: number | null;
  totalPuzzles: number;
  onPuzzleFinished: (result: Omit<RushPuzzleResult, 'bonusSeconds'>) => void;
  onQuit: () => void;
}) {
  const [runtimeState, setRuntimeState] = useState<BotMatchState>(() => createRushMatchState(puzzle));
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [lastPlayedTile, setLastPlayedTile] = useState<Tile | null>(null);
  const [done, setDone] = useState(false);

  const runningScoreRef = useRef(0);
  const moveTraceRef = useRef<Array<Record<string, unknown>>>([]);
  const { handTileSize, handCompactStacked } = useResponsiveHandTileSize(
    runtimeState.players.you.hand.length,
  );

  // A new ordinal is a fresh board: reset every per-puzzle ref and piece of state.
  useEffect(() => {
    setRuntimeState(createRushMatchState(puzzle));
    setSelectedTile(null);
    setLastPlayedTile(null);
    setDone(false);
    runningScoreRef.current = 0;
    moveTraceRef.current = [];
  }, [puzzle.puzzleId, puzzle.ordinal]);

  const legalMoves = useMemo(() => {
    if (done) return [] as Move[];
    return getLegalMoves(runtimeState, 'you').filter((move) => move.type === 'play');
  }, [runtimeState, done]);

  const finish = useCallback(
    (rawScore: number, solved: boolean) => {
      if (done) return;
      setDone(true);
      onPuzzleFinished({
        ordinal: puzzle.ordinal,
        puzzleId: puzzle.puzzleId,
        stageKey: puzzle.stageKey,
        rawScore,
        solved,
        submittedLine: moveTraceRef.current,
      });
    },
    [done, onPuzzleFinished, puzzle.ordinal, puzzle.puzzleId, puzzle.stageKey],
  );

  const onPositionClick = useCallback(
    (position: Move['position']) => {
      if (done || !selectedTile) return;
      const move = legalMoves.find(
        (candidate) =>
          candidate.tile && candidate.position === position && tileEquals(candidate.tile, selectedTile),
      );
      if (!move) return;

      const result = applyPlayMove(runtimeState, 'you', move);
      const nextState = result.state;
      const pointsAwarded = result.scored?.points ?? 0;

      setRuntimeState(nextState);
      setSelectedTile(null);
      setLastPlayedTile(move.tile ?? null);
      moveTraceRef.current = [
        ...moveTraceRef.current,
        {
          tile: move.tile,
          position: move.position,
          pointsAwarded,
          totalScore: nextState.players.you.score,
        },
      ];

      const upcoming = getLegalMoves(nextState, 'you').filter((c) => c.type === 'play');
      const outcome = evaluateOneTurnHighScoreMoveOutcome({
        pointsAwarded,
        isDouble: isDominoDouble(move.tile!),
        priorRunningScore: runningScoreRef.current,
        nextCurrentPlayer: nextState.currentPlayer,
        upcomingPlayMovesCount: upcoming.length,
      });
      runningScoreRef.current = outcome.runningScore;
      if (outcome.type === 'terminal') {
        finish(outcome.runningScore, outcome.status === 'SOLVED');
      }
    },
    [done, finish, legalMoves, runtimeState, selectedTile],
  );

  // Same terminal recovery the ladder uses: a puzzle with no legal opening, or
  // one whose turn already handed off, resolves rather than stranding the run.
  useEffect(() => {
    if (done) return;
    if (shouldRecoverCompletedOneTurnHighScore(runtimeState.currentPlayer)) {
      finish(runningScoreRef.current, runningScoreRef.current > 0);
      return;
    }
    if (shouldAutoFailOneTurnHighScoreWithNoLegalMoves(legalMoves.length)) {
      finish(0, false);
    }
  }, [done, finish, legalMoves.length, runtimeState.currentPlayer]);

  const lowClock = secondsLeft <= 10;

  return (
    <>
      <RotateOverlay />
      <div className="screen game-screen walnut-live theme-green rh-match-live rh-match-solo-hud puzzle-rush-root">
        <MatchLiveLayout
          hudLeft={
            /*
             * One pill, not two.
             *
             * Score and stage are the same thing — run state — and the score
             * used to borrow `wl-player-pill`, the two-player match component,
             * whose height and gold rail come from shared match CSS and so
             * could never be squared with the stage pill without touching
             * multiplayer. A single chip sidesteps that and reads as one HUD
             * unit for what is a solo run.
             */
            <div className="pr-hud-left">
              <div className="pr-hud-run" data-ui="rush-hud-run">
                <div className="pr-hud-run__score">
                  <span className="pr-hud-run__score-value" data-ui="rush-tally">
                    {clientTally}
                  </span>
                  <span className="pr-hud-run__score-label">Score</span>
                </div>
                <span className="pr-hud-run__divider" aria-hidden />
                <RushHudStageMeter
                  stages={stages}
                  activeStageKey={puzzle.stageKey}
                  ordinal={puzzle.ordinal}
                  totalPuzzles={totalPuzzles}
                  completedOrdinals={completedOrdinals}
                />
              </div>
            </div>
          }
          hudCenter={
            <div className="wl-center-status" data-ui="turn-status">
              <span
                className={`pr-clock${lowClock ? ' pr-clock--low' : ''}`}
                data-ui="rush-clock"
                role="timer"
                aria-live="off"
              >
                {formatClock(secondsLeft)}
              </span>
              {lastBonusSeconds != null && lastBonusSeconds > 0 && (
                <span className="pr-clock-bonus" key={puzzle.ordinal} data-ui="rush-clock-bonus">
                  +{lastBonusSeconds}s
                </span>
              )}
              <span className="wl-room-code">
                Puzzle {puzzle.ordinal} / {totalPuzzles}
              </span>
            </div>
          }
          hudRight={
            <div className="rh-match-solo-actions">
              <button type="button" className="rh-match-solo-action-btn rh-back-button" onClick={onQuit}>
                End run
              </button>
            </div>
          }
          /*
           * Only the Board goes in here, exactly as the ladder does it.
           *
           * `.nbl-board-canvas` is a position:relative box holding an
           * absolutely-centred `.nbl-board-watermark` (top/left 50%) with the
           * Board painted over it. Passing a second, in-flow element ahead of
           * the Board — the stage progress bar used to live here — consumed
           * flow space at the top, pushing the Board's box down so its own
           * `calc(50% + …)` placement maths no longer lined up with the canvas
           * centre. The board drifted off-centre and the watermark, still
           * pinned to the true centre, stopped being covered and showed as a
           * faded ghost beside the tiles.
           */
          boardInner={
            <Board
              board={runtimeState.board}
              legalMoves={legalMoves}
              selectedTile={selectedTile}
              lastPlayedTile={lastPlayedTile}
              onPositionClick={onPositionClick}
              tileSize={84}
              // No zoom tray. It renders as an empty-looking pill in the
              // board's bottom-left corner, and a single puzzle board is
              // already sized to fit — nothing to zoom. Live multiplayer and
              // No Brainer Lab opt out the same way.
              showZoomTray={false}
            />
          }
          handDock={
            <DailyPuzzleSoloHandDock
              hand={runtimeState.players.you.hand}
              handTileSize={handTileSize}
              handCompactStacked={handCompactStacked}
              selectedTile={selectedTile}
              inProgress={!done}
              isTilePlayable={(tile) =>
                legalMoves.some((candidate) => candidate.tile && tileEquals(candidate.tile, tile))
              }
              onSelectTile={setSelectedTile}
              handRowKeyPrefix="rush-hand-row"
              tileKeyPrefix="rush"
            />
          }
        />
      </div>
    </>
  );
}

export default PuzzleRushPlayView;
