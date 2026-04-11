import { useEffect, useMemo, useRef, useState } from 'react';
import LayoutScreen from '../ui/LayoutScreen';
import DominoTile from '../components/DominoTile';
import { computeOpenEndsSum } from '../bot/botEngine';
import { learnLessons } from './data';
import LearnBoard from './components/LearnBoard';
import { getMatchableOpenEnds, isTilePlayable, toBoardState, toTile } from './engine/rulesAdapter';
import type {
  DrillTileSpeedStep,
  GuidedPlayStep,
  LearnBoardState,
  LearnTile,
  PredictionStep,
  QuizPlaceStep,
  QuizScoreSumStep,
  QuizTileStep,
} from './engine/types';
import {
  isLearnLessonCompleted,
  loadProgress,
  markLessonCompleted,
  setLastLocation,
} from './progress/storage';
import './learnPlayer.css';

interface LearnPlayerProps {
  lessonId: string;
  onExit: () => void;
}

const LESSON_HOOKS: Record<string, string> = {
  'l1-open-ends': 'Two numbers control the entire board. Learn to see them instantly.',
  'l1-legal-move': "One side. One end. That's the only rule — until the board gets interesting.",
  'l1-scoring-basics': "Miss by 1 and you get nothing. Hit it exactly and your turn keeps going.",
  'l1-doubles-crossing': 'Play a double and the board transforms. Learn to use that — before your opponent does.',
  'l1-opening-strategy': "The best opening move looks like a mistake. Here's why it isn't.",
  'l1-turn-continuation': 'One move can turn into ten. This is how big scores happen.',
  'l1-speed-drill': 'You know the rules. Now build the reflexes.',
  'l1-final-challenge': "Everything you've learned. One board. No hints.",
};

export default function LearnPlayer({ lessonId, onExit }: LearnPlayerProps) {
  const lesson = useMemo(() => learnLessons.find((item) => item.id === lessonId) ?? null, [lessonId]);
  const [stepIndex, setStepIndex] = useState(0);
  const [showIntroCard, setShowIntroCard] = useState(true);
  const [showCompletedState, setShowCompletedState] = useState(false);
  const [quizSolved, setQuizSolved] = useState(false);
  const [quizWrongAttempts, setQuizWrongAttempts] = useState(0);
  const [quizFeedback, setQuizFeedback] = useState<string | null>(null);
  const [lastClickedTileResult, setLastClickedTileResult] = useState<{ idx: number; correct: boolean } | null>(null);
  const [lastClickedScoreChoice, setLastClickedScoreChoice] = useState<number | null>(null);
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState<boolean | null>(null);
  const [guidedHasPlaced, setGuidedHasPlaced] = useState(false);
  const [guidedPlacedBoard, setGuidedPlacedBoard] = useState<LearnBoardState | null>(null);
  const [guidedSlidingTile, setGuidedSlidingTile] = useState(false);
  const [showScoreFlash, setShowScoreFlash] = useState<number | null>(null);
  const [chainCount, setChainCount] = useState(0);
  const [predictionSelected, setPredictionSelected] = useState<'yes' | 'no' | null>(null);
  const [predictionRevealBoard, setPredictionRevealBoard] = useState<LearnBoardState | null>(null);
  const [predictionRevealVisible, setPredictionRevealVisible] = useState(false);
  const [drillRoundIndex, setDrillRoundIndex] = useState(0);
  const [drillTimeLeftMs, setDrillTimeLeftMs] = useState(0);
  const [drillResults, setDrillResults] = useState<Array<{ roundIndex: number; correct: boolean; ms: number | null }>>(
    [],
  );
  const [drillFeedback, setDrillFeedback] = useState<string | null>(null);
  const [drillRoundResolved, setDrillRoundResolved] = useState(false);
  const [drillCompleted, setDrillCompleted] = useState(false);
  const [drillStarted, setDrillStarted] = useState(false);
  const drillFrameRef = useRef<number | null>(null);
  const drillRoundStartRef = useRef<number>(0);
  const drillRoundDeadlineRef = useRef<number>(0);
  const drillAdvanceTimeoutRef = useRef<number | null>(null);
  const tileResultTimeoutRef = useRef<number | null>(null);
  const scoreResultTimeoutRef = useRef<number | null>(null);
  const guidedPlacementTimeoutRef = useRef<number | null>(null);
  const guidedFeedbackTimeoutRef = useRef<number | null>(null);
  const scoreFlashTimeoutRef = useRef<number | null>(null);
  const predictionTimeoutRef = useRef<number | null>(null);

  const totalSteps = lesson?.steps.length ?? 0;
  const currentStep = lesson?.steps[stepIndex] ?? null;
  const isQuizTileStep = currentStep?.type === 'quiz_tile';
  const isQuizPlaceStep = currentStep?.type === 'quiz_place';
  const isQuizScoreStep = currentStep?.type === 'quiz_score_sum';
  const isDrillStep = currentStep?.type === 'drill_tile_speed';
  const isGuidedPlayStep = currentStep?.type === 'guided_play';
  const isPredictionStep = currentStep?.type === 'prediction';

  const quizBoard = useMemo(
    () =>
      isQuizTileStep || isQuizPlaceStep || isQuizScoreStep || isDrillStep || isGuidedPlayStep || isPredictionStep
        ? toBoardState(currentStep.board)
        : null,
    [isQuizTileStep, isQuizPlaceStep, isQuizScoreStep, isDrillStep, isGuidedPlayStep, isPredictionStep, currentStep],
  );
  const openEnds = useMemo(
    () =>
      isQuizTileStep || isQuizPlaceStep || isQuizScoreStep || isDrillStep || isGuidedPlayStep || isPredictionStep
        ? getMatchableOpenEnds(quizBoard)
        : [],
    [isQuizTileStep, isQuizPlaceStep, isQuizScoreStep, isDrillStep, isGuidedPlayStep, isPredictionStep, quizBoard],
  );
  useEffect(() => {
    if (!lesson) return;
    const progress = loadProgress();
    const restored =
      progress.lastLessonId === lesson.id ? Math.min(Math.max(progress.lastStepIndex, 0), lesson.steps.length - 1) : 0;
    setStepIndex(restored);
    setShowIntroCard(true);
    setShowCompletedState(false);
  }, [lesson]);

  useEffect(() => {
    setQuizSolved(false);
    setQuizWrongAttempts(0);
    setQuizFeedback(null);
    setLastClickedTileResult(null);
    setLastClickedScoreChoice(null);
    setLastAnswerCorrect(null);
    setGuidedHasPlaced(false);
    setGuidedPlacedBoard(null);
    setGuidedSlidingTile(false);
    setShowScoreFlash(null);
    setChainCount((prev) => (currentStep?.type === 'guided_play' ? prev : 0));
    setPredictionSelected(null);
    setPredictionRevealBoard(null);
    setPredictionRevealVisible(false);
    setDrillRoundIndex(0);
    setDrillTimeLeftMs(0);
    setDrillResults([]);
    setDrillFeedback(null);
    setDrillRoundResolved(false);
    setDrillCompleted(false);
    setDrillStarted(false);
    if (drillFrameRef.current !== null) {
      window.cancelAnimationFrame(drillFrameRef.current);
      drillFrameRef.current = null;
    }
    if (drillAdvanceTimeoutRef.current !== null) {
      window.clearTimeout(drillAdvanceTimeoutRef.current);
      drillAdvanceTimeoutRef.current = null;
    }
    if (tileResultTimeoutRef.current !== null) {
      window.clearTimeout(tileResultTimeoutRef.current);
      tileResultTimeoutRef.current = null;
    }
    if (scoreResultTimeoutRef.current !== null) {
      window.clearTimeout(scoreResultTimeoutRef.current);
      scoreResultTimeoutRef.current = null;
    }
    if (guidedPlacementTimeoutRef.current !== null) {
      window.clearTimeout(guidedPlacementTimeoutRef.current);
      guidedPlacementTimeoutRef.current = null;
    }
    if (guidedFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(guidedFeedbackTimeoutRef.current);
      guidedFeedbackTimeoutRef.current = null;
    }
    if (scoreFlashTimeoutRef.current !== null) {
      window.clearTimeout(scoreFlashTimeoutRef.current);
      scoreFlashTimeoutRef.current = null;
    }
    if (predictionTimeoutRef.current !== null) {
      window.clearTimeout(predictionTimeoutRef.current);
      predictionTimeoutRef.current = null;
    }
  }, [lesson?.id, stepIndex]);

  useEffect(() => {
    if (!lesson || showCompletedState) return;
    setLastLocation(lesson.id, stepIndex);
  }, [lesson, stepIndex, showCompletedState]);

  useEffect(() => {
    return () => {
      if (drillFrameRef.current !== null) {
        window.cancelAnimationFrame(drillFrameRef.current);
      }
      if (drillAdvanceTimeoutRef.current !== null) {
        window.clearTimeout(drillAdvanceTimeoutRef.current);
      }
      if (tileResultTimeoutRef.current !== null) {
        window.clearTimeout(tileResultTimeoutRef.current);
      }
      if (scoreResultTimeoutRef.current !== null) {
        window.clearTimeout(scoreResultTimeoutRef.current);
      }
      if (guidedPlacementTimeoutRef.current !== null) {
        window.clearTimeout(guidedPlacementTimeoutRef.current);
      }
      if (guidedFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(guidedFeedbackTimeoutRef.current);
      }
      if (scoreFlashTimeoutRef.current !== null) {
        window.clearTimeout(scoreFlashTimeoutRef.current);
      }
      if (predictionTimeoutRef.current !== null) {
        window.clearTimeout(predictionTimeoutRef.current);
      }
    };
  }, []);

  if (!lesson) {
    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen mode-subpage-screen mode-accent-learn learn-player-screen"
        title="Lesson not found"
        subtitle="This lesson is unavailable right now."
        contentClassName="screen-shell"
      >
        <button className="mode-inline-btn" onClick={onExit}>
          Back to Learn
        </button>
      </LayoutScreen>
    );
  }

  const isLastStep = stepIndex >= totalSteps - 1;

  const handleBack = () => {
    if (stepIndex <= 0 || showCompletedState) return;
    const nextIndex = Math.max(0, stepIndex - 1);
    setStepIndex(nextIndex);
  };

  const handleNext = () => {
    if (showCompletedState) return;

    if (isLastStep) {
      markLessonCompleted(lesson.id);
      setStepIndex(0);
      setShowCompletedState(true);
      return;
    }

    const nextIndex = Math.min(totalSteps - 1, stepIndex + 1);
    setStepIndex(nextIndex);
  };

  const tileEquals = (a: LearnTile, b: LearnTile) =>
    toTile(a).low === toTile(b).low &&
    toTile(a).high === toTile(b).high;
  const tupleToLearnTile = (tile: [number, number]): LearnTile => ({ low: tile[0], high: tile[1] });
  const tupleEquals = (a: [number, number], b: [number, number]) => {
    const first = toTile(tupleToLearnTile(a));
    const second = toTile(tupleToLearnTile(b));
    return first.low === second.low && first.high === second.high;
  };

  const buildGuidedPlacedBoard = (step: GuidedPlayStep): LearnBoardState => {
    const board = step.board as LearnBoardState & {
      mainLine?: Array<{ tile: [number, number]; orientation: string }>;
      leftEnd?: number;
      rightEnd?: number;
      leftEndIsDouble?: boolean;
      rightEndIsDouble?: boolean;
      hubDoubles?: unknown[];
    };
    const mainLine = Array.isArray(board.mainLine) ? [...board.mainLine] : [];
    const [first, second] = step.targetTile;
    const matchValue = step.targetEnd === 'left' ? board.leftEnd : board.rightEnd;
    const otherValue = first === matchValue ? second : second === matchValue ? first : second;
    const placement = {
      tile: [first, second] as [number, number],
      orientation: 'horizontal-normal',
    };

    return {
      ...board,
      mainLine: step.targetEnd === 'left' ? [placement, ...mainLine] : [...mainLine, placement],
      leftEnd: step.targetEnd === 'left' ? otherValue : board.leftEnd,
      rightEnd: step.targetEnd === 'right' ? otherValue : board.rightEnd,
      leftEndIsDouble: step.targetEnd === 'left' ? first === second : board.leftEndIsDouble ?? false,
      rightEndIsDouble: step.targetEnd === 'right' ? first === second : board.rightEndIsDouble ?? false,
      hubDoubles: board.hubDoubles ?? [],
    };
  };

  const isTileOnBoard = (tile: LearnTile, board: typeof quizBoard): boolean => {
    if (!board) return false;
    const normalized = toTile(tile);
    const matches = (other: { low: number; high: number }) =>
      normalized.low === other.low && normalized.high === other.high;

    if (board.mainLine.some((placement) => matches(placement.tile))) return true;
    for (const hub of board.hubDoubles ?? []) {
      for (const branch of hub.branches ?? []) {
        if (branch.tiles.some((placement) => matches(placement.tile))) return true;
      }
    }
    return false;
  };

  const createFallbackHandTile = (board: typeof quizBoard): LearnTile | null => {
    for (let low = 0; low <= 6; low += 1) {
      for (let high = low; high <= 6; high += 1) {
        const candidate = { low, high };
        if (!isTileOnBoard(candidate, board)) return candidate;
      }
    }
    return null;
  };

  const sanitizeHand = (hand: LearnTile[], board: typeof quizBoard): LearnTile[] => {
    const filtered = hand.filter((tile) => !isTileOnBoard(tile, board));
    if (filtered.length > 0) return filtered;
    const fallback = createFallbackHandTile(board);
    return fallback ? [fallback] : hand;
  };

  const getScoringContributors = (board: typeof quizBoard): number[] => {
    if (!board) return [];
    if (board.mainLine.length === 1) {
      const tile = board.mainLine[0]?.tile;
      return tile ? [tile.low, tile.high] : [];
    }
    const contributors: number[] = [];
    contributors.push(board.leftEnd);
    if (board.leftEndIsDouble) contributors.push(board.leftEnd);
    contributors.push(board.rightEnd);
    if (board.rightEndIsDouble) contributors.push(board.rightEnd);
    for (const hub of board.hubDoubles ?? []) {
      for (const branch of hub.branches ?? []) {
        if (!branch) continue;
        contributors.push(branch.openEnd);
        if (branch.openEndIsDouble) contributors.push(branch.openEnd);
      }
    }
    return contributors;
  };

  const getCorrectTiles = (step: QuizTileStep): LearnTile[] => {
    const sanitizedHand = sanitizeHand(step.hand, quizBoard);
    if (step.correctMode === 'anyPlayable') {
      return sanitizedHand.filter((tile) => isTilePlayable(toTile(tile), quizBoard));
    }
    if (Array.isArray(step.correct) && step.correct.length > 0) return step.correct;
    if (step.correctTile) return [step.correctTile];
    return [];
  };

  const isCorrectSelection = (step: QuizTileStep, clicked: LearnTile): boolean => {
    if (step.correctMode === 'anyPlayable') {
      return isTilePlayable(toTile(clicked), quizBoard);
    }
    const correctTiles = getCorrectTiles(step);
    return correctTiles.some((tile) => tileEquals(tile, clicked));
  };

  const buildWrongText = (step: QuizTileStep): string => {
    if (step.wrongFeedback) return step.wrongFeedback;
    if (step.explainWrong) return step.explainWrong;
    if (openEnds.length === 0) return 'That tile is not playable on this board.';
    return `That tile doesn't match either open end (${openEnds.join(' or ')}).`;
  };

  const handleQuizTileClick = (step: QuizTileStep, clicked: LearnTile, idx: number) => {
    if (quizSolved) return;
    if (isCorrectSelection(step, clicked)) {
      setQuizSolved(true);
      setLastAnswerCorrect(true);
      setLastClickedTileResult({ idx, correct: true });
      if (tileResultTimeoutRef.current !== null) {
        window.clearTimeout(tileResultTimeoutRef.current);
      }
      tileResultTimeoutRef.current = window.setTimeout(() => setLastClickedTileResult(null), 500);
      setQuizFeedback(
        step.correctFeedback ?? step.explainCorrect ?? 'Correct. That tile matches the current open ends.',
      );
      return;
    }

    const nextWrong = quizWrongAttempts + 1;
    setQuizWrongAttempts(nextWrong);
    setLastAnswerCorrect(false);
    setLastClickedTileResult({ idx, correct: false });
    if (tileResultTimeoutRef.current !== null) {
      window.clearTimeout(tileResultTimeoutRef.current);
    }
    tileResultTimeoutRef.current = window.setTimeout(() => setLastClickedTileResult(null), 500);
    if (nextWrong >= 1 && step.hints?.level1) {
      setQuizFeedback(step.hints.level1);
    } else if (nextWrong >= 1 && step.hint) {
      setQuizFeedback(step.hint);
    } else {
      setQuizFeedback(buildWrongText(step));
    }
  };

  const handleQuizPlaceClick = (step: QuizPlaceStep, placement: 'left' | 'right') => {
    if (quizSolved) return;
    if (placement === step.correctPlacement) {
      setQuizSolved(true);
      setLastAnswerCorrect(true);
      setQuizFeedback(
        step.correctFeedback ??
        step.explainCorrect ??
          `Correct. [${step.tile.low}|${step.tile.high}] connects to the ${placement} open end.`,
      );
      return;
    }

    const nextWrong = quizWrongAttempts + 1;
    setQuizWrongAttempts(nextWrong);
    setLastAnswerCorrect(false);
    if (nextWrong >= 1 && step.hints?.level1) {
      setQuizFeedback(step.hints.level1);
    } else if (nextWrong >= 1 && step.hint) {
      setQuizFeedback(step.hint);
    } else if (step.wrongFeedback) {
      setQuizFeedback(step.wrongFeedback);
    } else if (step.explainWrong) {
      setQuizFeedback(step.explainWrong);
    } else {
      setQuizFeedback('That side does not match the tile right now.');
    }
  };

  const getScoreSumCorrect = (step: QuizScoreSumStep): number => {
    if (typeof step.correct === 'number') return step.correct;
    return quizBoard ? computeOpenEndsSum(quizBoard) : 0;
  };

  const handleQuizScoreChoice = (step: QuizScoreSumStep, choice: number) => {
    if (quizSolved) return;
    const correct = getScoreSumCorrect(step);
    if (choice === correct) {
      setQuizSolved(true);
      setLastAnswerCorrect(true);
      setLastClickedScoreChoice(null);
      if (step.correctFeedback || step.explainCorrect) {
        setQuizFeedback(step.correctFeedback ?? step.explainCorrect ?? null);
      } else {
        const contributors = getScoringContributors(quizBoard);
        setQuizFeedback(
          contributors.length > 0
            ? `Correct. The scoring ends are ${contributors.join(' + ')}, so the total is ${correct}.`
            : `Correct. The board's scoring total is ${correct}.`,
        );
      }
      return;
    }

    const nextWrong = quizWrongAttempts + 1;
    setQuizWrongAttempts(nextWrong);
    setLastAnswerCorrect(false);
    setLastClickedScoreChoice(choice);
    if (scoreResultTimeoutRef.current !== null) {
      window.clearTimeout(scoreResultTimeoutRef.current);
    }
    scoreResultTimeoutRef.current = window.setTimeout(() => setLastClickedScoreChoice(null), 500);
    if (nextWrong >= 1 && step.hints?.level1) {
      setQuizFeedback(step.hints.level1);
    } else if (step.wrongFeedback) {
      setQuizFeedback(step.wrongFeedback);
    } else if (step.explainWrong) {
      setQuizFeedback(step.explainWrong);
    } else {
      setQuizFeedback('Not quite — add the open ends.');
    }

    const revealEnabled = step.hints?.level3 === 'revealAnswer';
    if (nextWrong >= 3 && revealEnabled && !step.explainWrong) {
      const contributors = getScoringContributors(quizBoard);
      setQuizFeedback(
        contributors.length > 0
          ? `The scoring ends are ${contributors.join(' + ')}, so the correct total is ${correct}.`
          : `The correct scoring total is ${correct}.`,
      );
    }
  };

  const handleGuidedPlayClick = (step: GuidedPlayStep, tile: [number, number]) => {
    if (guidedHasPlaced || guidedSlidingTile || !tupleEquals(tile, step.targetTile)) return;
    setGuidedSlidingTile(true);
    setLastAnswerCorrect(true);
    if (guidedPlacementTimeoutRef.current !== null) {
      window.clearTimeout(guidedPlacementTimeoutRef.current);
    }
    if (guidedFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(guidedFeedbackTimeoutRef.current);
    }
    if (scoreFlashTimeoutRef.current !== null) {
      window.clearTimeout(scoreFlashTimeoutRef.current);
    }
    guidedPlacementTimeoutRef.current = window.setTimeout(() => {
      setGuidedPlacedBoard(buildGuidedPlacedBoard(step));
      setGuidedSlidingTile(false);
      if (typeof step.scoreFlash === 'number') {
        setShowScoreFlash(step.scoreFlash);
        scoreFlashTimeoutRef.current = window.setTimeout(() => setShowScoreFlash(null), 900);
        guidedFeedbackTimeoutRef.current = window.setTimeout(() => {
          setGuidedHasPlaced(true);
          setChainCount((prev) => prev + 1);
          setQuizSolved(true);
        }, 800);
      } else {
        guidedFeedbackTimeoutRef.current = window.setTimeout(() => {
          setGuidedHasPlaced(true);
          setChainCount((prev) => prev + 1);
          setQuizSolved(true);
        }, 400);
      }
    }, 300);
  };

  const handlePredictionChoice = (step: PredictionStep, answer: 'yes' | 'no') => {
    if (predictionSelected) return;
    const isCorrect = answer === step.correctAnswer;
    setPredictionSelected(answer);
    setLastAnswerCorrect(isCorrect);
    setQuizFeedback(isCorrect ? step.correctFeedback : step.wrongFeedback);
    if (predictionTimeoutRef.current !== null) {
      window.clearTimeout(predictionTimeoutRef.current);
    }
    window.setTimeout(() => {
      if (step.revealBoard) {
        setPredictionRevealBoard(step.revealBoard);
      }
      if (step.revealText) {
        setPredictionRevealVisible(true);
      }
    }, 400);
    predictionTimeoutRef.current = window.setTimeout(() => setQuizSolved(true), isCorrect ? 1000 : 1500);
  };

  const advanceDrillRound = (step: DrillTileSpeedStep) => {
    setDrillFeedback(null);
    setDrillRoundResolved(false);
    setDrillRoundIndex((prev) => {
      const next = prev + 1;
      if (next >= step.rounds) {
        setDrillCompleted(true);
        return prev;
      }
      return next;
    });
  };

  const completeDrillRound = (step: DrillTileSpeedStep, correct: boolean, elapsedMs: number | null) => {
    setDrillResults((prev) => {
      if (prev.some((result) => result.roundIndex === drillRoundIndex)) return prev;
      return [...prev, { roundIndex: drillRoundIndex, correct, ms: elapsedMs }];
    });
    setDrillRoundResolved(true);
    setDrillFeedback(
      correct
        ? 'Nice.'
        : `Time. Open ends were ${openEnds.length > 0 ? openEnds.join(' and ') : 'unavailable'}.`,
    );
    if (drillAdvanceTimeoutRef.current !== null) {
      window.clearTimeout(drillAdvanceTimeoutRef.current);
    }
    drillAdvanceTimeoutRef.current = window.setTimeout(() => advanceDrillRound(step), 250);
  };

  const handleDrillTileClick = (step: DrillTileSpeedStep, clicked: LearnTile) => {
    if (drillCompleted || drillRoundResolved) return;
    const playable = isTilePlayable(toTile(clicked), quizBoard);
    if (playable) {
      const elapsed = Math.max(0, performance.now() - drillRoundStartRef.current);
      completeDrillRound(step, true, elapsed);
      return;
    }
    if (step.hints?.level1) {
      setDrillFeedback(step.hints.level1);
      return;
    }
    setDrillFeedback(`Doesn't match ends (${openEnds.join(', ')}).`);
  };

  const handleRetryDrill = () => {
    if (drillAdvanceTimeoutRef.current !== null) {
      window.clearTimeout(drillAdvanceTimeoutRef.current);
      drillAdvanceTimeoutRef.current = null;
    }
    setDrillRoundIndex(0);
    setDrillTimeLeftMs(0);
    setDrillResults([]);
    setDrillFeedback(null);
    setDrillRoundResolved(false);
    setDrillCompleted(false);
    setDrillStarted(false);
  };

  useEffect(() => {
    if (!isDrillStep || drillCompleted || !drillStarted) return;
    const step = currentStep as DrillTileSpeedStep;
    if (drillRoundIndex >= step.rounds || drillRoundResolved) return;

    const start = performance.now();
    const roundMs = Math.max(250, step.secondsPerRound * 1000);
    drillRoundStartRef.current = start;
    drillRoundDeadlineRef.current = start + roundMs;
    setDrillTimeLeftMs(roundMs);

    const tick = () => {
      const now = performance.now();
      const remaining = Math.max(0, drillRoundDeadlineRef.current - now);
      setDrillTimeLeftMs(remaining);
      if (remaining <= 0) {
        completeDrillRound(step, false, null);
        return;
      }
      drillFrameRef.current = window.requestAnimationFrame(tick);
    };

    drillFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (drillFrameRef.current !== null) {
        window.cancelAnimationFrame(drillFrameRef.current);
        drillFrameRef.current = null;
      }
    };
  }, [isDrillStep, currentStep, drillCompleted, drillRoundIndex, drillRoundResolved, drillStarted]);

  const completionLabel = isLearnLessonCompleted(lesson.id) ? 'Completed' : 'In progress';
  const nextDisabled = !showCompletedState
    ? isQuizTileStep || isQuizPlaceStep || isQuizScoreStep || isGuidedPlayStep || isPredictionStep
      ? !quizSolved
      : isDrillStep
        ? !drillCompleted
        : false
    : false;
  const drillStep = isDrillStep ? (currentStep as DrillTileSpeedStep) : null;
  const currentQuizHand = isQuizTileStep ? sanitizeHand(currentStep.hand, quizBoard) : [];
  const currentDrillHand = drillStep
    ? sanitizeHand(drillStep.hands[drillRoundIndex] ?? [], quizBoard)
    : [];
  const drillCorrectCount = drillResults.filter((result) => result.correct).length;
  const drillSuccessfulTimes = drillResults
    .filter((result) => result.correct && typeof result.ms === 'number')
    .map((result) => result.ms as number);
  const drillAverageMs =
    drillSuccessfulTimes.length > 0
      ? drillSuccessfulTimes.reduce((sum, ms) => sum + ms, 0) / drillSuccessfulTimes.length
      : null;
  const drillBestMs = drillSuccessfulTimes.length > 0 ? Math.min(...drillSuccessfulTimes) : null;
  const drillProgressPct =
    drillStep && drillStep.secondsPerRound > 0
      ? Math.max(0, Math.min(100, (drillTimeLeftMs / (drillStep.secondsPerRound * 1000)) * 100))
      : 0;
  const stepTitle = currentStep?.title ?? lesson.title;
  const lessonIndex = Math.max(0, learnLessons.findIndex((item) => item.id === lesson.id));
  const introHook = LESSON_HOOKS[lesson.id] ?? lesson.description;
  const currentBoardData = isGuidedPlayStep
    ? guidedPlacedBoard ?? currentStep.board
    : isPredictionStep
      ? predictionRevealBoard ?? currentStep.board
      : currentStep && 'board' in currentStep && currentStep.board
        ? currentStep.board
        : null;

  return (
    <LayoutScreen
      className="screen lobby-screen mode-home-screen mode-subpage-screen mode-accent-learn learn-player-screen"
      title={lesson.title}
      subtitle={lesson.description}
      contentClassName="screen-shell"
    >
      <div className="learn-player-wrap">
        <div className="learn-player-topbar">
          <button className="mode-inline-btn" onClick={onExit}>
            ← Back to Learn
          </button>
          <div className="learn-player-topbar-right">
            <div className="learn-step-dots" aria-hidden="true">
              {lesson.steps.map((_, i) => (
                <div
                  key={i}
                  className={`learn-step-dot ${i < stepIndex ? 'is-done' : i === stepIndex ? 'is-current' : ''}`}
                />
              ))}
            </div>
            <div className="learn-player-hud-meta">
            <span className="learn-player-step-label">
              Step {Math.min(stepIndex + 1, totalSteps)} / {totalSteps}
            </span>
            <span className="learn-player-status">{lesson.title}</span>
            </div>
          </div>
        </div>

        <div className="learn-player-body">
          {showIntroCard ? (
            <div className="learn-intro-card" onClick={() => setShowIntroCard(false)}>
              <div className="learn-intro-inner">
                <div className="learn-intro-badge">LEVEL 1 · LESSON {lessonIndex + 1}</div>
                <h1 className="learn-intro-title">{lesson.title}</h1>
                <p className="learn-intro-hook">{introHook}</p>
                <button
                  type="button"
                  className="learn-intro-start"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowIntroCard(false);
                  }}
                >
                  Start Lesson →
                </button>
              </div>
              <div className="learn-intro-watermark" aria-hidden="true">
                {lesson.title}
              </div>
            </div>
          ) : showCompletedState ? (
            <div key={stepIndex} className="learn-slide learn-slide-complete">
              <div className="learn-slide-inner">
                <span className="learn-slide-eyebrow">Lesson Complete</span>
                <p className="learn-slide-heading">Nice work.</p>
                <p className="learn-slide-subtext">You've got {lesson.title} locked in. Keep going — the next lesson is waiting.</p>
                <div className="learn-slide-nav">
                  <button className="mode-inline-btn" onClick={onExit}>
                    Back to Learn
                  </button>
                </div>
              </div>
              <div className="learn-slide-ambient" aria-hidden="true">
                <span className="learn-slide-bg-word">{lesson.title}</span>
              </div>
            </div>
          ) : currentStep?.type === 'explain' ? (
            <div key={stepIndex} className="learn-slide learn-slide-explain">
              <div className="learn-slide-inner">
                <span className="learn-slide-eyebrow">{stepTitle}</span>
                <p className="learn-slide-heading">{currentStep.body}</p>
                <div className="learn-slide-nav">
                  <button className="mode-inline-btn" onClick={handleBack} disabled={stepIndex === 0}>
                    Back
                  </button>
                  <button className="mode-inline-btn" onClick={handleNext}>
                    Next
                  </button>
                </div>
              </div>
              <div className="learn-slide-ambient" aria-hidden="true">
                <span className="learn-slide-bg-word">{lesson.title}</span>
              </div>
            </div>
          ) : currentStep?.type === 'summary' ? (
            <div key={stepIndex} className="learn-slide learn-slide-summary">
              <div className="learn-slide-inner">
                <span className="learn-slide-eyebrow">{stepTitle}</span>
                <p className="learn-slide-heading">{currentStep.body}</p>
                <div className="learn-slide-nav">
                  <button className="mode-inline-btn" onClick={handleBack} disabled={stepIndex === 0}>
                    Back
                  </button>
                  <button className="mode-inline-btn" onClick={handleNext}>
                    Finish
                  </button>
                </div>
              </div>
              <div className="learn-slide-ambient" aria-hidden="true">
                <span className="learn-slide-bg-word">✓</span>
              </div>
            </div>
          ) : (
            <div key={stepIndex} className="learn-board-first-layout">
              <div className="learn-board-hero">
                {currentBoardData ? (
                  <div
                    className={`learn-player-board-wrap ${quizWrongAttempts >= 2 && currentStep?.type === 'quiz_score_sum' && currentStep.hints?.level2 === 'highlightOpenEnds' ? 'learn-board-emphasis' : ''}`}
                  >
                    <LearnBoard board={currentBoardData} highlightOpenEnds />
                  </div>
                ) : (
                  <div className="learn-player-board-wrap learn-player-board-placeholder" />
                )}
                {showScoreFlash !== null ? (
                  <div className="score-flash-badge">
                    +{showScoreFlash} pt{showScoreFlash === 1 ? '' : 's'}
                  </div>
                ) : null}
                {chainCount >= 2 ? <div className="chain-counter">🔥 {chainCount} in a row</div> : null}
              </div>

              <div className={`learn-instruction-card ${guidedHasPlaced ? 'success-state' : ''}`}>
                <p className="learn-instruction-eyebrow">{stepTitle}</p>
                <p className="learn-instruction-prompt">
                  {currentStep?.type === 'quiz_tile' ||
                  currentStep?.type === 'quiz_score_sum' ||
                  currentStep?.type === 'quiz_place' ||
                  currentStep?.type === 'drill_tile_speed'
                    ? currentStep.prompt
                    : currentStep?.type === 'guided_play'
                      ? guidedHasPlaced
                        ? (
                            <>
                              <span className="success-check">✓</span>
                              {currentStep.successText}
                            </>
                          )
                        : currentStep.coachText
                      : currentStep?.type === 'prediction'
                        ? currentStep.question
                    : currentStep?.type === 'demo'
                      ? currentStep.body
                    : ''}
                </p>

                {currentStep?.type === 'guided_play' ? (
                  <>
                    <div className="guided-hand-row" role="group" aria-label="Guided play hand">
                      {currentStep.hand.map((tile, idx) => {
                        const isTarget = tupleEquals(tile, currentStep.targetTile);
                        return (
                          <button
                            key={`${idx}-${tile[0]}-${tile[1]}`}
                            type="button"
                            className={`guided-hand-tile ${isTarget ? 'is-target' : ''} ${
                              guidedSlidingTile && isTarget ? `is-sliding-${currentStep.targetEnd}` : ''
                            } ${guidedHasPlaced && isTarget ? 'is-placed' : ''}`}
                            onClick={() => handleGuidedPlayClick(currentStep, tile)}
                            disabled={!isTarget || guidedHasPlaced || guidedSlidingTile}
                            aria-label={`Tile ${tile[0]}|${tile[1]}`}
                          >
                            <span className="pip-top">{tile[0]}</span>
                            <span className="pip-divider" />
                            <span className="pip-bottom">{tile[1]}</span>
                          </button>
                        );
                      })}
                    </div>
                    {!guidedHasPlaced ? <div className="guided-play-hint-arrow">↑ tap the glowing tile</div> : null}
                    {guidedHasPlaced && currentStep.chainContinues ? (
                      <div className="chain-continues-banner">🔥 Chain continues — keep playing</div>
                    ) : null}
                  </>
                ) : null}

                <div className="learn-instruction-answers">
                  {currentStep?.type === 'prediction' ? (
                    <>
                      <div className="prediction-tile-display">
                        <span className="prediction-tile-label">You're considering playing this tile</span>
                        <div className="guided-hand-tile is-target prediction-tile-static" aria-hidden="true">
                          <span className="pip-top">{currentStep.tileToConsider[0]}</span>
                          <span className="pip-divider" />
                          <span className="pip-bottom">{currentStep.tileToConsider[1]}</span>
                        </div>
                      </div>
                      <div className="prediction-buttons">
                        {(['yes', 'no'] as const).map((answer) => {
                          const selected = predictionSelected === answer;
                          const revealedCorrect = predictionSelected !== null && currentStep.correctAnswer === answer;
                          return (
                            <button
                              key={answer}
                              type="button"
                              className={`prediction-btn ${
                                selected
                                  ? answer === currentStep.correctAnswer
                                    ? 'is-correct'
                                    : 'is-wrong'
                                  : revealedCorrect
                                    ? 'is-correct'
                                    : ''
                              }`}
                              onClick={() => handlePredictionChoice(currentStep, answer)}
                              disabled={predictionSelected !== null}
                            >
                              {answer === 'yes' ? 'YES, it scores' : "NO, it doesn't"}
                            </button>
                          );
                        })}
                      </div>
                      {predictionRevealVisible && currentStep.revealText ? (
                        <div className="prediction-reveal-board">
                          <p className="learn-player-body-text">{currentStep.revealText}</p>
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {currentStep?.type === 'quiz_tile' ? (
                    <div className="learn-hand-row" role="group" aria-label="Lesson hand tiles">
                      {currentQuizHand.map((tile, idx) => {
                        const playable = isTilePlayable(toTile(tile), quizBoard);
                        const showPlayableHint = quizWrongAttempts >= 2 && playable;
                        const revealEnabled = currentStep.hints?.level3 === 'revealAnswer' || !currentStep.hints?.level3;
                        const revealTile =
                          quizWrongAttempts >= 3 &&
                          revealEnabled &&
                          getCorrectTiles(currentStep).some((correct) => tileEquals(correct, tile));
                        return (
                          <button
                            key={`${idx}-${tile.low}-${tile.high}`}
                            type="button"
                            className={`learn-hand-tile ${showPlayableHint ? 'is-playable-hint' : ''} ${revealTile ? 'is-revealed' : ''} ${
                              lastClickedTileResult?.idx === idx
                                ? lastClickedTileResult.correct
                                  ? 'is-correct-answer'
                                  : 'is-wrong-answer'
                                : ''
                            }`}
                            onClick={() => handleQuizTileClick(currentStep, tile, idx)}
                            disabled={quizSolved}
                            aria-label={`Tile ${tile.low}|${tile.high}`}
                          >
                            <DominoTile tile={toTile(tile)} size={30} className="learn-hand-domino" />
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {currentStep?.type === 'quiz_place' ? (
                    <>
                      <div className="learn-place-tile-wrap">
                        <DominoTile tile={toTile(currentStep.tile)} size={30} className="learn-hand-domino" />
                      </div>
                      <div className="learn-place-options">
                        {(['left', 'right'] as const).map((placement) => {
                          const hintEnabled = currentStep.hints?.level2 === 'highlightPlayable';
                          const revealEnabled =
                            currentStep.hints?.level3 === 'revealAnswer' || !currentStep.hints?.level3;
                          const isCorrect = placement === currentStep.correctPlacement;
                          const showHint = quizWrongAttempts >= 2 && hintEnabled && isCorrect;
                          const showReveal = quizWrongAttempts >= 3 && revealEnabled && isCorrect;

                          return (
                            <button
                              key={placement}
                              type="button"
                              className={`learn-place-btn ${showHint ? 'is-place-hint' : ''} ${showReveal ? 'is-place-reveal' : ''}`}
                              onClick={() => handleQuizPlaceClick(currentStep, placement)}
                              disabled={quizSolved}
                            >
                              {placement === 'left' ? 'Place on Left' : 'Place on Right'}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : null}

                  {currentStep?.type === 'quiz_score_sum' ? (
                    <div className="learn-score-choices">
                      {currentStep.choices.map((choice) => {
                        const correct = getScoreSumCorrect(currentStep);
                        const revealEnabled = currentStep.hints?.level3 === 'revealAnswer';
                        const revealChoice = quizWrongAttempts >= 3 && revealEnabled && choice === correct;
                        return (
                          <button
                            key={choice}
                            type="button"
                            className={`learn-score-choice-btn ${revealChoice ? 'is-choice-reveal' : ''} ${
                              lastClickedScoreChoice === choice && lastAnswerCorrect === false ? 'is-wrong-answer' : ''
                            }`}
                            onClick={() => handleQuizScoreChoice(currentStep, choice)}
                            disabled={quizSolved}
                          >
                            {choice}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {currentStep?.type === 'drill_tile_speed' ? (
                    <>
                      {drillCompleted ? (
                        <div className="learn-drill-results">
                          <p className="learn-drill-results-title">Drill complete</p>
                          <p className="mode-option-meta">Accuracy: {drillCorrectCount}/{currentStep.rounds}</p>
                          <p className="mode-option-meta">
                            Avg time: {drillAverageMs !== null ? `${(drillAverageMs / 1000).toFixed(2)}s` : 'n/a'}
                          </p>
                          <p className="mode-option-meta">
                            Best time: {drillBestMs !== null ? `${(drillBestMs / 1000).toFixed(2)}s` : 'n/a'}
                          </p>
                          <button type="button" className="mode-inline-btn" onClick={handleRetryDrill}>
                            Retry Drill
                          </button>
                        </div>
                      ) : !drillStarted ? (
                        <div className="learn-drill-start-gate">
                          <p className="learn-drill-start-label">
                            Round 1 of {currentStep.rounds} — {currentStep.secondsPerRound}s per round
                          </p>
                          <button
                            type="button"
                            className="mode-inline-btn learn-drill-start-btn"
                            onClick={() => setDrillStarted(true)}
                          >
                            Start Drill
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="learn-drill-timer">
                            <span className="learn-drill-round-label">
                              Round {Math.min(drillRoundIndex + 1, currentStep.rounds)} / {currentStep.rounds}
                            </span>
                            <span className="learn-drill-countdown">{(drillTimeLeftMs / 1000).toFixed(1)}s</span>
                          </div>
                          <div className="learn-drill-timer-bar" aria-hidden="true">
                            <div className="learn-drill-timer-fill" style={{ width: `${drillProgressPct}%` }} />
                          </div>
                          <div className="learn-hand-row" role="group" aria-label="Drill hand tiles">
                            {currentDrillHand.map((tile, idx) => (
                              <button
                                key={`${idx}-${tile.low}-${tile.high}`}
                                type="button"
                                className="learn-hand-tile"
                                onClick={() => handleDrillTileClick(currentStep, tile)}
                                disabled={drillRoundResolved}
                                aria-label={`Tile ${tile.low}|${tile.high}`}
                              >
                                <DominoTile tile={toTile(tile)} size={30} className="learn-hand-domino" />
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  ) : null}

                  {currentStep &&
                  ![
                    'explain',
                    'demo',
                    'summary',
                    'quiz_tile',
                    'quiz_place',
                    'quiz_score_sum',
                    'drill_tile_speed',
                    'guided_play',
                    'prediction',
                  ].includes(currentStep.type) ? (
                    <div className="learn-player-coming-soon">
                      <strong>{currentStep.type}</strong> step is coming soon in the interactive runner.
                    </div>
                  ) : null}
                </div>

                {quizFeedback ? (
                  <p
                    className={`learn-quiz-feedback ${
                      lastAnswerCorrect === true ? 'is-correct' : lastAnswerCorrect === false ? 'is-wrong' : ''
                    }`}
                  >
                    {quizFeedback}
                  </p>
                ) : null}
                {drillFeedback ? <p className="learn-drill-feedback">{drillFeedback}</p> : null}
              </div>

              <div className="learn-board-nav">
                <button className="mode-inline-btn" onClick={handleBack} disabled={stepIndex === 0}>
                  Back
                </button>
                <button
                  className={`mode-inline-btn ${quizSolved ? 'is-next-ready' : ''}`}
                  onClick={handleNext}
                  disabled={nextDisabled}
                >
                  {isLastStep ? 'Finish' : 'Next'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </LayoutScreen>
  );
}
