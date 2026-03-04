import type { LearnModule } from '../engine/types';

export const learnModules: LearnModule[] = [
  {
    id: 'level-1',
    title: 'Level 1 — Foundations',
    description: 'Master open ends, scoring, doubles, turn chaining, and the opening strategy that separates beginners from players.',
    unlocked: true,
    progressPct: 0,
    estMinutes: 12,
  },
  {
    id: 'level-2',
    title: 'Level 2 — Core Tactics',
    description: 'Practice legal move reads, scoring choices, and blocking lines.',
    unlocked: false,
    progressPct: 0,
    estMinutes: 15,
  },
  {
    id: 'level-3',
    title: 'Level 3 — Speed Training',
    description: 'Build fast recognition with timed board-read drills.',
    unlocked: false,
    progressPct: 0,
    estMinutes: 10,
  },
  {
    id: 'level-4',
    title: 'Level 4 — Simulation',
    description: 'Apply everything in guided match simulations.',
    unlocked: false,
    progressPct: 0,
    estMinutes: 18,
  },
];
