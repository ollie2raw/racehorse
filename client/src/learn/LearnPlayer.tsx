import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LayoutScreen from '../ui/LayoutScreen';
import DominoTile from '../components/DominoTile';
import { computeOpenEndsSum } from '../bot/botEngine';
import { getScoringOpenEndPips } from '../game/openEndsGeometry';
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
  const [_quizFeedback, setQuizFeedback] = useState<string | null>(null);
  const [lastClickedTileResult, setLastClickedTileResult] = useState<{ idx: number; correct: boolean } | null>(null);
  const [_lastClickedScoreChoice, setLastClickedScoreChoice] = useState<number | null>(null);
  const [_lastAnswerCorrect, setLastAnswerCorrect] = useState<boolean | null>(null);
  const [guidedHasPlaced, setGuidedHasPlaced] = useState(false);
  const [guidedPlacedBoard, setGuidedPlacedBoard] = useState<LearnBoardState | null>(null);
  const [guidedSlidingTile, setGuidedSlidingTile] = useState(false);
  const [showScoreFlash, setShowScoreFlash] = useState<number | null>(null);
  const [_chainCount, setChainCount] = useState(0);
  const [predictionSelected, setPredictionSelected] = useState<'yes' | 'no' | null>(null);
  const [predictionRevealBoard, setPredictionRevealBoard] = useState<LearnBoardState | null>(null);
  const [_predictionRevealVisible, setPredictionRevealVisible] = useState(false);
  const [drillRoundIndex, setDrillRoundIndex] = useState(0);
  const [_drillTimeLeftMs, setDrillTimeLeftMs] = useState(0);
  const [_drillResults, setDrillResults] = useState<Array<{ roundIndex: number; correct: boolean; ms: number | null }>>(
    [],
  );
  const [_drillFeedback, setDrillFeedback] = useState<string | null>(null);
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

  const resolvedLessonId = lesson?.id ?? '';
  const [restoredLessonId, setRestoredLessonId] = useState<string | null>(null);
  if (lesson && resolvedLessonId !== restoredLessonId) {
    const progress = loadProgress();
    const restored =
      progress.lastLessonId === lesson.id
        ? Math.min(Math.max(progress.lastStepIndex, 0), lesson.steps.length - 1)
        : 0;
    setRestoredLessonId(resolvedLessonId);
    setStepIndex(restored);
    setShowIntroCard(true);
    setShowCompletedState(false);
  }

  const stepKey = `${resolvedLessonId}:${stepIndex}`;
  const [prevStepKey, setPrevStepKey] = useState('');
  useEffect(() => {
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
  }, [stepKey]);

  if (stepKey !== prevStepKey) {
    setPrevStepKey(stepKey);
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
  }

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

  const advanceDrillRound = useCallback((step: DrillTileSpeedStep) => {
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
  }, []);

  const completeDrillRound = useCallback(
    (step: DrillTileSpeedStep, correct: boolean, elapsedMs: number | null) => {
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
    },
    [advanceDrillRound, drillRoundIndex, openEnds],
  );

  useEffect(() => {
    if (!isDrillStep || drillCompleted || !drillStarted) return;
    const step = currentStep as DrillTileSpeedStep;
    if (drillRoundIndex >= step.rounds || drillRoundResolved) return;

    const start = performance.now();
    const roundMs = Math.max(250, step.secondsPerRound * 1000);
    drillRoundStartRef.current = start;
    drillRoundDeadlineRef.current = start + roundMs;

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
  }, [
    completeDrillRound,
    currentStep,
    drillCompleted,
    drillRoundIndex,
    drillRoundResolved,
    drillStarted,
    isDrillStep,
  ]);

  if (!lesson) {
    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen mode-subpage-screen mode-accent-learn learn-player-screen"
        title="Lesson not found"
        subtitle="This lesson is unavailable right now."
        contentClassName="screen-shell"
      >
        <button className="mode-inline-btn rh-back-button" onClick={onExit}>
          ← Back to Learn
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
        if (branch?.tiles.some((placement) => matches(placement.tile))) return true;
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
    return getScoringOpenEndPips(board);
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

  const _handleQuizPlaceClick = (step: QuizPlaceStep, placement: 'left' | 'right') => {
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

  const _handleQuizScoreChoice = (step: QuizScoreSumStep, choice: number) => {
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

  const _handlePredictionChoice = (step: PredictionStep, answer: 'yes' | 'no') => {
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

  const _handleDrillTileClick = (step: DrillTileSpeedStep, clicked: LearnTile) => {
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

  const _handleRetryDrill = () => {
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

  const nextDisabled = !showCompletedState
    ? isQuizTileStep || isQuizPlaceStep || isQuizScoreStep || isGuidedPlayStep || isPredictionStep
      ? !quizSolved
      : isDrillStep
        ? !drillCompleted
        : false
    : false;
  const currentQuizHand = isQuizTileStep ? sanitizeHand(currentStep.hand, quizBoard) : [];
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
    <div className="screen learn-match-screen mode-subpage-screen mode-accent-learn claude-mode-screen-shell">
      <header className="claude-mode-topbar learn-match-topbar">
        <div className="claude-mode-topbar__brand">RACEHORSE · GUIDED MATCH</div>
        <div className="learn-match-topbar__center">
          <span>Turn <strong>{stepIndex + 1} / {totalSteps}</strong></span>
        </div>
        <button type="button" className="claude-mode-topbar__back rh-back-button" onClick={onExit}>
          <span aria-hidden="true">⏻</span><span>Leave</span>
        </button>
      </header>

      <section className="learn-match-grid">
        <aside className="learn-match-coach">
          <div className="rh-coach">
            <div className="rh-coach__avatar">
              <div className="rh-coach__avatar-mark">O</div>
              <div className="rh-coach__avatar-meta">
                <div className="rh-coach__avatar-name">OLIVER · MASTER</div>
                <div className="rh-coach__avatar-sub">COACH</div>
              </div>
            </div>

            <div className="rh-progress">
              <div className="rh-progress__head">
                <span>Lesson Progress</span>
                <strong>{stepIndex + 1} / {totalSteps}</strong>
              </div>
              <div className="rh-progress__rail">
                <div
                  className="rh-progress__fill"
                  style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
                />
              </div>
              <div className="rh-tickrail">
                {Array.from({ length: Math.min(60, totalSteps) }).map((_, i) => (
                  <div
                    key={i}
                    className={`rh-tickrail__tick ${
                      i < stepIndex ? 'is-played' : i === stepIndex ? 'is-current' : ''
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="rh-coach__content">
              <div className="claude-mode-hero__eyebrow">YOUR MOVE</div>
              <h2 className="rh-coach__heading">
                {currentStep?.type === 'explain' ? 'EXPLAIN' : 'YOUR MOVE'}
              </h2>
              <div className="rh-coach__body">
                {currentStep?.type === 'explain' || currentStep?.type === 'summary'
                  ? currentStep.body
                  : currentStep?.type === 'guided_play'
                    ? currentStep.coachText
                    : currentStep?.type === 'quiz_tile' ||
                      currentStep?.type === 'quiz_place' ||
                      currentStep?.type === 'quiz_score_sum' ||
                      currentStep?.type === 'drill_tile_speed'
                      ? currentStep.prompt
                      : currentStep?.type === 'prediction'
                        ? currentStep.question
                        : ''}
              </div>
            </div>

            {isGuidedPlayStep && (
              <div className="rh-coach__rec">
                <div className="rh-coach__rec-head">
                  <div className="claude-mode-section-label">RECOMMENDED</div>
                </div>
                <div className="rh-coach__rec-tile">
                  <DominoTile tile={toTile(tupleToLearnTile(currentStep.targetTile))} size={22} />
                  <button
                    type="button"
                    className="claude-mode-primary"
                    style={{ padding: '8px 12px', minHeight: 0 }}
                    onClick={() => handleGuidedPlayClick(currentStep, currentStep.targetTile)}
                  >
                    <span className="claude-mode-primary__title" style={{ fontSize: '13px' }}>Show Move</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>

        <main className="learn-match-board">
          <div className="rh-match__board-head">
            <div className="claude-mode-section-label">BOARD · TURN {stepIndex + 1}</div>
            {openEnds.length > 0 && (
              <div className="claude-mode-chip-row">
                <span className="claude-mode-chip">LEFT END: {openEnds[0]}</span>
                {openEnds.length > 1 && <span className="claude-mode-chip">RIGHT END: {openEnds[1]}</span>}
              </div>
            )}
          </div>

          <div className="learn-match-board-frame">
            <div className="rh-board__corner rh-board__corner--tl" />
            <div className="rh-board__corner rh-board__corner--tr" />
            <div className="rh-board__corner rh-board__corner--bl" />
            <div className="rh-board__corner rh-board__corner--br" />
            <div className="rh-board__decor">L</div>
            
            <div className="learn-player-board-wrap">
              {currentBoardData && <LearnBoard board={currentBoardData} highlightOpenEnds />}
            </div>

            {showScoreFlash !== null && (
              <div className="score-flash-badge">+{showScoreFlash}</div>
            )}
          </div>

          <div className="rh-match__hand-head">
            <div className="claude-mode-section-label">YOUR HAND</div>
          </div>

          <div className="learn-match-rack rh-rack">
            {isQuizTileStep && currentQuizHand.map((tile, idx) => (
              <div
                key={idx}
                className={`rh-rack__tile-wrap ${lastClickedTileResult?.idx === idx ? (lastClickedTileResult.correct ? 'is-correct' : 'is-wrong') : ''}`}
                onClick={() => handleQuizTileClick(currentStep, tile, idx)}
              >
                <DominoTile tile={toTile(tile)} size={30} />
              </div>
            ))}
            {isGuidedPlayStep && currentStep.hand.map((tile, idx) => {
              const isTarget = tupleEquals(tile, currentStep.targetTile);
              return (
                <div
                  key={idx}
                  className={`rh-rack__tile-wrap ${isTarget ? 'is-recommended' : ''} ${guidedHasPlaced && isTarget ? 'is-placed' : ''}`}
                  onClick={() => handleGuidedPlayClick(currentStep, tile)}
                >
                  <DominoTile tile={toTile(tupleToLearnTile(tile))} size={30} />
                </div>
              );
            })}
          </div>

          <div className="learn-board-nav" style={{ position: 'relative', bottom: 'auto', right: 'auto', marginTop: '14px', justifyContent: 'flex-end' }}>
            <button className="claude-mode-topbar__back rh-back-button" onClick={handleBack} disabled={stepIndex === 0}>
              ← Back to Learn
            </button>
            <button
              className={`claude-mode-primary ${quizSolved ? 'is-next-ready' : ''}`}
              style={{ padding: '10px 24px', width: 'auto', minHeight: 0 }}
              onClick={handleNext}
              disabled={nextDisabled}
            >
              <span className="claude-mode-primary__title">{isLastStep ? 'Finish' : 'Next Step'}</span>
            </button>
          </div>
        </main>
      </section>

      {showIntroCard && (
        <div className="learn-intro-card" onClick={() => setShowIntroCard(false)}>
          <div className="learn-intro-inner">
            <div className="learn-intro-badge">LEVEL 1 · LESSON {lessonIndex + 1}</div>
            <h1 className="learn-intro-title">{lesson.title}</h1>
            <p className="learn-intro-hook">{introHook}</p>
            <button type="button" className="learn-intro-start" onClick={() => setShowIntroCard(false)}>
              Start Lesson →
            </button>
          </div>
          <div className="learn-intro-watermark">L</div>
        </div>
      )}

      {showCompletedState && (
        <div className="rh-modal-overlay">
          <div className="rh-modal">
            <div className="rh-modal__decor">✓</div>
            <p className="rh-modal__eyebrow">Lesson Complete</p>
            <h2 className="rh-modal__title">WELL DONE!</h2>
            <p className="rh-modal__copy">
              You've got {lesson.title} locked in. Keep going — the next lesson is waiting.
            </p>
            <div className="rh-modal__buttons" style={{ gridTemplateColumns: '1fr' }}>
              <button type="button" className="rh-btn-cancel" onClick={onExit}>Finish</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

