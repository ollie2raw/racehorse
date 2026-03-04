import Board from '../../components/Board';
import { toBoardState } from '../engine/rulesAdapter';
import type { LearnBoardState } from '../engine/types';

export interface LearnBoardProps {
  board: LearnBoardState;
  highlightOpenEnds?: boolean;
}

export default function LearnBoard({ board, highlightOpenEnds = false }: LearnBoardProps) {
  const convertedBoard = toBoardState(board);

  if (import.meta.env.DEV && convertedBoard === null) {
    return (
      <div
        style={{
          border: '1px solid rgba(255, 120, 120, 0.28)',
          borderRadius: 8,
          background: 'rgba(255, 120, 120, 0.08)',
          color: 'rgba(255, 210, 210, 0.92)',
          fontSize: '0.82rem',
          padding: '10px 12px',
        }}
      >
        Invalid Learn board fixture
      </div>
    );
  }

  return (
    <Board
      board={convertedBoard}
      legalMoves={[]}
      selectedTile={null}
      onPositionClick={() => {}}
      showOpenEndGlow={highlightOpenEnds}
    />
  );
}
