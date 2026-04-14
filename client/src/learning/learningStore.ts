/**
 * learning/learningStore.ts
 *
 * Phase 6 — Lightweight localStorage-backed learning profile store.
 *
 * Rules:
 *  - Pure functions where possible.
 *  - Never throws (always returns safe defaults on parse errors).
 *  - Storage key is namespaced under 'racehorse:learn:'.
 *  - Profile is schema-versioned so we can migrate later.
 */

import type { CoachingConceptTag, ConceptScoreMap, PlayerLevel, LearnGameMode } from './types.ts';
import type { LearningProfile } from './profileProgress.ts';
import type { HandLearningSummary } from './handSummary.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY   = 'racehorse:learn:profile:v1';
const SCHEMA_VERSION = 1;

const ALL_CONCEPTS: CoachingConceptTag[] = [
  'scoring', 'safety', 'defense', 'flexibility',
  'tempo', 'board_control', 'risk_management', 'endgame',
];

// ---------------------------------------------------------------------------
// Default / empty profile
// ---------------------------------------------------------------------------

export function createDefaultProfile(): LearningProfile {
  const now = new Date().toISOString();
  const conceptScores: ConceptScoreMap = {} as ConceptScoreMap;
  for (const c of ALL_CONCEPTS) conceptScores[c] = 0;

  return {
    createdAt:           now,
    updatedAt:           now,
    gamesPlayed:         0,
    handsPlayed:         0,
    moveCount:           0,
    averageAccuracy:     0,
    conceptScores,
    recurringMistakeTags:[],
    recentLessons:       [],
    streaks: {
      daysPlayed:            0,
      handsWithNoBlunder:    0,
      strongScoringHands:    0,
    },
    preferredMode:   'guided',
    computedLevel:   'beginner',
  };
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

export function loadProfile(): LearningProfile {
  if (typeof window === 'undefined') return createDefaultProfile();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultProfile();
    const parsed = JSON.parse(raw) as LearningProfile & { _v?: number };
    if (parsed._v !== SCHEMA_VERSION) return createDefaultProfile();
    return parsed;
  } catch {
    return createDefaultProfile();
  }
}

export function saveProfile(profile: LearningProfile): void {
  if (typeof window === 'undefined') return;
  try {
    const toSave = { ...profile, _v: SCHEMA_VERSION };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // quota exceeded or private browsing — silently ignore
  }
}

// ---------------------------------------------------------------------------
// Profile update after a hand
// ---------------------------------------------------------------------------

/**
 * Compute the new PlayerLevel from average concept scores.
 * 0–39: beginner | 40–69: intermediate | 70+: advanced
 */
function computeLevel(conceptScores: ConceptScoreMap): PlayerLevel {
  const scores = ALL_CONCEPTS.map((c) => conceptScores[c]);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg >= 70) return 'advanced';
  if (avg >= 40) return 'intermediate';
  return 'beginner';
}

/**
 * ELO-style concept score update.
 * Good hand → concept score moves toward 100.
 * Bad hand  → concept score moves toward 0 (slowly).
 */
function adjustConceptScore(current: number, improved: boolean): number {
  const step = improved ? 8 : -5;
  return Math.max(0, Math.min(100, current + step));
}

/**
 * Update a LearningProfile with the results of one hand.
 * Returns a new profile object (immutable update).
 */
export function updateProfile(
  profile: LearningProfile,
  summary: HandLearningSummary,
  gameMode: LearnGameMode,
  sessionDate: string,
): LearningProfile {
  const updatedScores = { ...profile.conceptScores };

  // Update concept scores based on weakest and strongest concepts this hand
  updatedScores[summary.weakestConcept]   = adjustConceptScore(
    updatedScores[summary.weakestConcept] ?? 0,
    false,
  );
  if (summary.strongestConcept !== summary.weakestConcept) {
    updatedScores[summary.strongestConcept] = adjustConceptScore(
      updatedScores[summary.strongestConcept] ?? 0,
      true,
    );
  }

  // Incremental accuracy average
  const handsPlayed    = profile.handsPlayed + 1;
  const avgAccuracy    = (profile.averageAccuracy * profile.handsPlayed + summary.moveAccuracy) / handsPlayed;
  const moveCount      = profile.moveCount + summary.totalMoves;

  // Streak updates
  const hasBlunder = summary.blundersPlayed > 0;
  const isStrong   = summary.moveAccuracy >= 0.8;
  const prevStreaks = profile.streaks;

  const newLastDate = sessionDate.slice(0, 10);
  const prevLastDate = profile.updatedAt.slice(0, 10);
  const isNewDay = newLastDate !== prevLastDate;

  const streaks = {
    daysPlayed:         isNewDay ? prevStreaks.daysPlayed + 1 : prevStreaks.daysPlayed,
    handsWithNoBlunder: hasBlunder ? 0 : prevStreaks.handsWithNoBlunder + 1,
    strongScoringHands: isStrong  ? prevStreaks.strongScoringHands + 1 : 0,
  };

  // Recurring mistake tracking: keep last 5 weakest concepts, flag repeats
  const weakHistory = [summary.weakestConcept, ...(profile.recentLessons ?? [])].slice(0, 5) as CoachingConceptTag[];
  const recurringMistakeTags = Array.from(
    new Set(weakHistory.filter((c) => weakHistory.filter((x) => x === c).length >= 2)),
  ) as CoachingConceptTag[];

  // Recent lessons (deduplicated, capped at 5)
  const recentLessons = [
    summary.keyLesson,
    ...(profile.recentLessons ?? []).filter((l) => l !== summary.keyLesson),
  ].slice(0, 5);

  const preferredMode: LearnGameMode =
    gameMode === 'guided' || gameMode === 'training' || gameMode === 'challenge'
      ? gameMode
      : profile.preferredMode;

  const newProfile: LearningProfile = {
    ...profile,
    updatedAt:           new Date().toISOString(),
    gamesPlayed:         profile.gamesPlayed,  // updated externally per game
    handsPlayed,
    moveCount,
    averageAccuracy:     avgAccuracy,
    conceptScores:       updatedScores,
    recurringMistakeTags,
    recentLessons,
    streaks,
    preferredMode,
    computedLevel:       computeLevel(updatedScores),
  };

  return newProfile;
}

// ---------------------------------------------------------------------------
// Lightweight profile summary view helper
// ---------------------------------------------------------------------------

export function getProfileSummary(profile: LearningProfile) {
  const scores    = ALL_CONCEPTS.map((c) => ({ concept: c, score: profile.conceptScores[c] }));
  const sorted    = [...scores].sort((a, b) => b.score - a.score);
  const strongest = sorted[0]?.concept ?? 'scoring';
  const weakest   = sorted[sorted.length - 1]?.concept ?? 'scoring';
  const overall   = scores.reduce((a, b) => a + b.score, 0) / scores.length;

  return {
    computedLevel:      profile.computedLevel,
    averageAccuracy:    profile.averageAccuracy,
    overallMasteryScore: overall,
    strongestConcept:   strongest as CoachingConceptTag,
    weakestConcept:     weakest   as CoachingConceptTag,
    streaks:            profile.streaks,
    handsPlayed:        profile.handsPlayed,
    recentLesson:       profile.recentLessons[0] ?? null,
  };
}
