import { useState, useMemo } from 'react';
import type { LessonScenario } from './types';
import { applyPlayMove, getLegalMoves, simulatePlacement, isDouble } from '../bot/botEngine';
import type { BotMatchState } from '../bot/botEngine';
import { Board, DominoTile, RotateOverlay } from '../components';
import type { Tile, Move, PlacementPosition, PlacedTile } from '../types';
import { tileEquals } from '../game/tileUtils';
import { compareMovesFeedback } from './feedback';
import type { MoveRating } from './feedback';
import { chooseBotMove, evaluateMove, toBotVisibleState } from '../bot/botHeuristics';
import type { BotChoice } from '../bot/botHeuristics';

interface LearnScenarioScreenProps {
  scenario: LessonScenario;
  onBack: () => void;
  onNext?: () => void;
}

export default function LearnScenarioScreen({ scenario, onBack, onNext }: LearnScenarioScreenProps) {
  const [match, setMatch] = useState<BotMatchState>(() => {
    // Basic match setup
    const state: BotMatchState = {
      players: {
        you: { hand: scenario.setup.playerHand, score: 0 },
        bot: { hand: scenario.setup.botHand, score: 0 },
      },
      board: null,
      boneyard: scenario.setup.boneyard,
      deadTiles: [],
      handOpen: true,
      currentPlayer: scenario.setup.currentPlayer ?? 'you',
      consecutivePasses: 0,
      handNumber: 1,
      handOver: false,
      gameOver: false,
      winnerId: null,
      winningScore: 100,
      lastHandWinner: null,
      lastHandReason: null,
      dealSize: 7,
    };

    // Pre-play tiles if any
    if (scenario.setup.boardTiles && scenario.setup.boardTiles.length > 0) {
      const first = scenario.setup.boardTiles[0];
      // Create initial board state directly for the first tile
      // This bypasses position validation which can fail on an empty board
      const firstPlaced: PlacedTile = {
        tile: first.tile,
        orientation: isDouble(first.tile) ? 'vertical-normal' : 'horizontal-normal'
      };

      state.board = {
        mainLine: [firstPlaced],
        leftEnd: first.tile.low,
        rightEnd: first.tile.high,
        leftEndIsDouble: isDouble(first.tile),
        rightEndIsDouble: isDouble(first.tile),
        hubDoubles: []
      };

      if (isDouble(first.tile)) {
        state.board.hubDoubles.push({
          hubId: 0,
          laneType: 'mainline',
          laneRef: 'mainline',
          tileIndex: 0,
          mainlineIndex: 0,
          hubValue: first.tile.high,
          isCrossed: false,
          leftSideFilled: false,
          rightSideFilled: false,
          branches: [],
        });
      }

      // Add subsequent tiles using standard simulation
      for (let i = 1; i < scenario.setup.boardTiles.length; i++) {
        const entry = scenario.setup.boardTiles[i];
        state.board = simulatePlacement(state.board, entry.tile, entry.position as PlacementPosition);
      }
    }

    if (import.meta.env.DEV) {
      console.log('[Learn] Initialized match state:', {
        board: state.board,
        playerHand: state.players.you.hand,
        boardTiles: scenario.setup.boardTiles
      });
      (window as Window & { MATCH?: typeof state }).MATCH = state;
    }
    return state;
  });

  const [stepIndex, setStepIndex] = useState(0);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [streakCount, setStreakCount] = useState(0);
  const [feedback, setFeedback] = useState<{ 
    text: string; 
    type: 'info' | 'success' | 'error' | 'hint';
    rating?: MoveRating;
    bestMove?: BotChoice;
  } | null>(null);
  const [completed, setCompleted] = useState(false);

  const currentStep = scenario.script?.[stepIndex];

  const userLegalMoves = useMemo(() => {
    return getLegalMoves(match, 'you');
  }, [match]);

  const handleTileClick = (tile: Tile) => {
    if (completed) return;
    setSelectedTile(tile);
    setFeedback(null);
  };

  const handlePositionClick = (position: PlacementPosition) => {
    if (!selectedTile || completed) return;

    const move: Move = { type: 'play', tile: selectedTile, position };
    const legalMove = userLegalMoves.find(m => 
      m.type === 'play' && 
      m.tile && tileEquals(m.tile, selectedTile) && 
      m.position === position
    );

    if (!legalMove) {
      setFeedback({ text: "That move isn't legal. You can't play that tile there.", type: 'error' });
      return;
    }

    // Check against script if it's a guided tutorial
    if (scenario.type === 'guided_tutorial' && currentStep) {
      // 1. Check mistake handlers for explicit educational blocks
      for (const handler of currentStep.mistakeHandlers) {
        if (handler.condition(move, match)) {
          setFeedback({ text: handler.feedbackText, type: 'error' });
          return;
        }
      }

      // 2. Determine if this is the expected move
      const isExpected = 
        tileEquals(currentStep.expectedMove.tile, selectedTile) && 
        currentStep.expectedMove.position === position;

      // 3. Special case: The very first lesson remains strict
      if (scenario.id === 'matching-basics' && !isExpected) {
        setFeedback({ text: "Not quite! For this first lesson, try exactly what the instruction says to learn the pattern.", type: 'error' });
        return;
      }

      // 4. Evaluate move quality compared to best possible move
      const visibleState = toBotVisibleState(match);
      const bestMoveChoice = chooseBotMove(visibleState, 'hard');
      const userMoveChoice = evaluateMove(visibleState, move, 'hard');
      
      let feedbackResult = { rating: 'Valid play' as MoveRating, text: "" };
      if (isExpected) {
        feedbackResult = { rating: 'Best move', text: currentStep.successText };
      } else if (bestMoveChoice && userMoveChoice) {
        feedbackResult = compareMovesFeedback(userMoveChoice, bestMoveChoice, isExpected);
      } else {
        feedbackResult = { rating: 'Valid play', text: "That's a valid play! It keeps the game moving." };
      }

      const isBest = isExpected || feedbackResult.rating === 'Best move';
      let finalText = feedbackResult.text;
      
      if (isBest) {
        const nextStreak = streakCount + 1;
        setStreakCount(nextStreak);
        if (nextStreak === 2) finalText += " Nice—you’re reading the board really well.";
        else if (nextStreak >= 3) finalText += " You’re starting to spot these quickly!";
      } else {
        setStreakCount(0);
      }

      // Apply the move
      const result = applyPlayMove(match, 'you', legalMove);
      setMatch(result.state);
      setFeedback({ 
        text: finalText, 
        type: isBest ? 'success' : 'info',
        rating: feedbackResult.rating,
        bestMove: (!isBest && bestMoveChoice) ? bestMoveChoice : undefined
      });
      setSelectedTile(null);

      // Advance to next step or complete
      if (stepIndex < (scenario.script?.length ?? 0) - 1) {
        setStepIndex(prev => prev + 1);
      } else {
        setCompleted(true);
      }
    } else {
      // Practice drill or end of script
      const result = applyPlayMove(match, 'you', legalMove);
      const visibleState = toBotVisibleState(match);
      const userMoveChoice = evaluateMove(visibleState, move, 'hard');
      const bestMoveChoice = chooseBotMove(visibleState, 'hard');

      setMatch(result.state);
      setSelectedTile(null);
      
      if (userMoveChoice && bestMoveChoice) {
        const feedbackResult = compareMovesFeedback(userMoveChoice, bestMoveChoice, false);
        const isBest = feedbackResult.rating === 'Best move';
        let finalText = feedbackResult.text;

        if (isBest) {
          const nextStreak = streakCount + 1;
          setStreakCount(nextStreak);
          if (nextStreak === 2) finalText += " Nice—you’re reading the board really well.";
          else if (nextStreak >= 3) finalText += " You’re starting to spot these quickly!";
        } else {
          setStreakCount(0);
        }

        setFeedback({ 
          text: finalText, 
          type: isBest ? 'success' : 'info',
          rating: feedbackResult.rating,
          bestMove: !isBest ? bestMoveChoice : undefined
        });
      }
    }
  };

  const currentActionCue = useMemo(() => {
    if (completed) return null;
    if (selectedTile) return "Now tap a target zone on the board";
    return currentStep?.actionCue || "Select a tile to play";
  }, [completed, selectedTile, currentStep]);

  return (
    <>
    <RotateOverlay />
    <div className="screen learn-scenario-screen" style={{ 
      color: 'white',
      height: '100vh',
      maxHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', color: 'rgba(255,255,255,0.6)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {scenario.title}
          </h2>
          {scenario.script && (
            <div style={{ fontSize: '0.75rem', opacity: 0.5 }}>
              Step {stepIndex + 1} of {scenario.script.length}
            </div>
          )}
        </div>
        <button className="mode-inline-btn rh-back-button" onClick={onBack}>← Back to Learn</button>
      </div>

      {/* Teacher Panel */}
      <div style={{ 
        padding: '16px 20px', 
        background: 'rgba(30, 41, 59, 0.5)', 
        margin: '12px 16px 0', 
        borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        flexShrink: 0
      }}>
        <div style={{ fontSize: '1.05rem', lineHeight: '1.4', color: 'rgba(255,255,255,0.95)' }}>
          {currentStep?.instructionText || "Choose your move. Look for tiles that match the ends or score points!"}
        </div>
        
        {feedback && (
          <div style={{ 
            padding: '10px 14px', 
            borderRadius: '8px',
            background: feedback.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 
                       feedback.type === 'error' ? 'rgba(239, 68, 68, 0.15)' : 
                       'rgba(59, 130, 246, 0.15)',
            border: `1px solid ${feedback.type === 'success' ? 'rgba(34, 197, 94, 0.4)' : 
                               feedback.type === 'error' ? 'rgba(239, 68, 68, 0.4)' : 
                               'rgba(59, 130, 246, 0.4)'}`,
            color: feedback.type === 'success' ? 'var(--tier-rookie)' :
                   feedback.type === 'error' ? 'var(--accent-red)' :
                   'var(--tier-standard)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            {feedback.rating && (
              <div style={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.8 }}>
                {feedback.rating}
              </div>
            )}
            <div style={{ fontSize: '0.92rem' }}>{feedback.text}</div>
            {feedback.bestMove && feedback.bestMove.move.tile && (
              <div style={{ 
                fontSize: '0.8rem', 
                opacity: 0.9, 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px',
                marginTop: '2px',
                paddingTop: '6px',
                borderTop: '1px solid rgba(255,255,255,0.08)'
              }}>
                <span style={{ fontWeight: 700, color: 'var(--accent-amber)' }}>Coach&apos;s Choice:</span>
                <DominoTile tile={feedback.bestMove.move.tile} size={20} />
                <span>scores {feedback.bestMove.breakdown.immediate} pts</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Board Area - Pushed center */}
      <div style={{ 
        flex: 1, 
        position: 'relative', 
        overflow: 'hidden',
        margin: '0 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <Board 
          board={match.board}
          legalMoves={userLegalMoves}
          selectedTile={selectedTile}
          onPositionClick={handlePositionClick}
          lastPlayedTile={feedback?.bestMove?.move.tile}
          highlightedPosition={feedback?.bestMove?.move.position}
          highlightedEnds={currentStep?.highlightBoardEnds}
          tileSize={80}
        />
      </div>

      {/* Action Cue */}
      {currentActionCue && (
        <div style={{
          textAlign: 'center',
          fontSize: '0.85rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: 'var(--accent-amber)',
          marginBottom: '8px',
          animation: 'pulse 2s infinite'
        }}>
          {currentActionCue}
        </div>
      )}

      {/* Player Hand */}
      <div style={{ 
        padding: '16px 20px 24px', 
        background: 'rgba(15, 23, 42, 0.8)', 
        borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          {(match.players.you.hand ?? []).map((tile, idx) => {
            const isHighlighted = currentStep?.highlightHandTile && 
              tileEquals(tile, currentStep.highlightHandTile);
            
            return (
              <div 
                key={`tile-${idx}`} 
                onClick={() => handleTileClick(tile)} 
                style={{ 
                  cursor: 'pointer',
                  position: 'relative'
                }}
              >
                <DominoTile 
                  tile={tile} 
                  size={64} 
                  selected={selectedTile ? tileEquals(selectedTile, tile) : false}
                  highlight={Boolean(isHighlighted)}
                />
                {isHighlighted && !selectedTile && (
                  <div style={{
                    position: 'absolute',
                    top: -8,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'var(--accent-amber)',
                    color: 'var(--text-on-elite)',
                    fontSize: '0.6rem',
                    fontWeight: 900,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    whiteSpace: 'nowrap'
                  }}>
                    PICK THIS
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        {completed && (
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', marginTop: '4px' }}>
            {onNext ? (
              <button className="mode-option mode-option-primary" onClick={onNext} style={{ maxWidth: '280px', minHeight: '54px' }}>
                <span className="mode-option-title">Next Lesson</span>
              </button>
            ) : (
              <button className="mode-option mode-option-primary" onClick={onBack} style={{ maxWidth: '280px', minHeight: '54px' }}>
                <span className="mode-option-title">Finish Academy</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
