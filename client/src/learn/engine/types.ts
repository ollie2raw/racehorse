export type HintLevel = 0 | 1 | 2 | 3;

export type LearnBoardState = {
  [key: string]: unknown;
};

export type LearnBoardFixture = LearnBoardState;

export type LearnTile = {
  low: number;
  high: number;
};

export type LearnPlacement = 'left' | 'right' | 'branch-up' | 'branch-down';

export type LearnStepBase = {
  id: string;
  title?: string;
};

export type ExplainStep = LearnStepBase & {
  type: 'explain';
  body: string;
  tip?: string;
};

export type DemoStep = LearnStepBase & {
  type: 'demo';
  body: string;
  board: LearnBoardState;
  highlights?: Array<{
    kind: 'open_end' | 'playable_tile' | 'anchor_tile' | 'double';
    key: string;
    label?: string;
  }>;
};

export type QuizTileStep = LearnStepBase & {
  type: 'quiz_tile';
  prompt: string;
  board: LearnBoardState;
  hand: LearnTile[];
  correct?: LearnTile[];
  correctMode?: 'anyPlayable';
  correctTile?: LearnTile;
  correctFeedback?: string;
  wrongFeedback?: string;
  explainCorrect?: string;
  explainWrong?: string;
  hint?: string;
  hints?: {
    level1?: string;
    level2?: 'highlightPlayable';
    level3?: 'revealAnswer';
  };
};

export type QuizPlaceStep = LearnStepBase & {
  type: 'quiz_place';
  prompt: string;
  board: LearnBoardState;
  tile: LearnTile;
  correctPlacement: 'left' | 'right';
  correctFeedback?: string;
  wrongFeedback?: string;
  explainCorrect?: string;
  explainWrong?: string;
  hint?: string;
  hints?: {
    level1?: string;
    level2?: 'highlightPlayable';
    level3?: 'revealAnswer';
  };
};

export type QuizScoreSumStep = LearnStepBase & {
  type: 'quiz_score_sum';
  prompt: string;
  board: LearnBoardState;
  choices: number[];
  correct?: number;
  correctFeedback?: string;
  wrongFeedback?: string;
  explainCorrect?: string;
  explainWrong?: string;
  hints?: {
    level1?: string;
    level2?: 'highlightOpenEnds';
    level3?: 'revealAnswer';
  };
};

export type DrillStep = LearnStepBase & {
  type: 'drill';
  prompt: string;
  rounds: number;
  secondsPerRound: number;
};

export type DrillTileSpeedStep = LearnStepBase & {
  type: 'drill_tile_speed';
  prompt: string;
  board: LearnBoardState;
  rounds: number;
  secondsPerRound: number;
  hands: LearnTile[][];
  hints?: {
    level1?: string;
  };
};

export type GuidedPlayStep = LearnStepBase & {
  type: 'guided_play';
  board: LearnBoardFixture;
  hand: [number, number][];
  targetTile: [number, number];
  targetEnd: 'left' | 'right';
  coachText: string;
  successText: string;
  scoreFlash?: number;
  chainContinues?: boolean;
};

export type PredictionStep = LearnStepBase & {
  type: 'prediction';
  board: LearnBoardFixture;
  question: string;
  tileToConsider: [number, number];
  targetEnd: 'left' | 'right';
  correctAnswer: 'yes' | 'no';
  correctFeedback: string;
  wrongFeedback: string;
  revealBoard?: LearnBoardFixture;
  revealText?: string;
};

export type SummaryStep = LearnStepBase & {
  type: 'summary';
  body: string;
  nextLessonId?: string;
};

export type LearnStep =
  | ExplainStep
  | DemoStep
  | QuizTileStep
  | QuizPlaceStep
  | QuizScoreSumStep
  | DrillStep
  | DrillTileSpeedStep
  | GuidedPlayStep
  | PredictionStep
  | SummaryStep;

export type LearnLesson = {
  id: string;
  moduleId: string;
  title: string;
  description: string;
  estMinutes: number;
  steps: LearnStep[];
};

export type LearnModule = {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
  progressPct: number;
  estMinutes: number;
};

export type StepResult = {
  stepId: string;
  correct: boolean;
  elapsedMs: number;
  hintLevel: HintLevel;
};

export type ProgressRecord = {
  moduleId: string;
  lessonId: string;
  completed: boolean;
  stars: 0 | 1 | 2 | 3;
  bestTimeMs?: number;
  lastPlayedAt?: string;
};
