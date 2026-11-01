import { describe, expect, it } from 'vitest';
import {
  buildCoachingFeedback,
  buildPreMoveRecommendation,
  resolveInterventionDecision,
  type CoachingFeedbackInput,
} from './coachMessaging';
import type { LearningMoveAnalysis, MoveEvaluationResult } from './moveAnalysis';
import {
  DEFAULT_THRESHOLD_CONFIG,
  type CoachingConceptTag,
  type LearnGameMode,
  type MoveCategory,
  type PlayerLevel,
  type RiskFlag,
} from './types';

// Distinctive internal numbers: if either ever shows up in player-facing copy, the "never expose engine
// scores" rule in coachMessaging.ts has been broken.
const ENGINE_SCORE = 7777.123;
const SCORE_DELTA = 4321.5;

function analysis(overrides: Partial<LearningMoveAnalysis> = {}): LearningMoveAnalysis {
  return {
    moveId: '3|4-left',
    moveNotation: '[3|4] → left',
    move: { type: 'play', tile: { low: 3, high: 4 }, position: 'left' },
    rank: 1,
    engineScore: ENGINE_SCORE,
    scoreDeltaFromBest: 0,
    immediatePoints: 0,
    category: 'best',
    primaryReason: 'simple_strong_move',
    conceptTags: ['tempo'],
    riskFlags: [],
    explanationShort: 'It keeps your options open.',
    resultingOpenEnds: [3, 5],
    isEquivalentToBest: false,
    debugSignals: {
      turnContinues: false,
      remainingPlayableCount: 3,
      playerNextTurnScoringCount: 0,
      playerConstraintLevel: 'free',
      playerEndCoverage: 2,
      opponentResponseCount: 3,
      opponentScoringResponseCount: 0,
      opponentConstraintLevel: 'free',
      opponentForcedDefensiveCount: 0,
    },
    ...overrides,
  };
}

function evaluation(overrides: Partial<MoveEvaluationResult> & { chosen?: LearningMoveAnalysis | null } = {}): MoveEvaluationResult {
  const { chosen, ...rest } = overrides;
  const bestMove = rest.bestMove ?? analysis();
  const chosenMove = chosen === null ? undefined : (chosen ?? undefined);
  return {
    rankedMoves: [bestMove],
    bestMove,
    chosenMove,
    engineConfidence: 0.9,
    isAmbiguousPosition: false,
    neitherScores: false,
    thresholds: DEFAULT_THRESHOLD_CONFIG,
    evaluatedAt: 0,
    ...rest,
  };
}

function chosenMove(category: MoveCategory, overrides: Partial<LearningMoveAnalysis> = {}): LearningMoveAnalysis {
  return analysis({
    moveId: '1|2-right',
    moveNotation: '[1|2] → right',
    move: { type: 'play', tile: { low: 1, high: 2 }, position: 'right' },
    rank: 3,
    category,
    scoreDeltaFromBest: SCORE_DELTA,
    ...overrides,
  });
}

const feedback = (input: CoachingFeedbackInput) => buildCoachingFeedback(input);

describe('copy rules, over every combination of the inputs that steer tone', () => {
  const categories: MoveCategory[] = ['best', 'excellent', 'good', 'dubious', 'blunder'];
  const levels: PlayerLevel[] = ['beginner', 'intermediate', 'advanced'];
  const modes: LearnGameMode[] = ['guided', 'training', 'challenge'];
  const riskSets: RiskFlag[][] = [[], ['gives_easy_score_back']];
  // The words coachMessaging.ts's own design rules forbid ("Never say optimal, engine, heuristic, or expected value").
  const BANNED = /\b(optimal|engine|heuristic|expected value)\b/i;

  it('never exposes engine internals, never exceeds an 8-word headline, and fills the body whenever it speaks', () => {
    let cases = 0;
    for (const category of categories)
      for (const playerLevel of levels)
        for (const gameMode of modes)
          for (const isAmbiguousPosition of [false, true])
            for (const neitherScores of [false, true])
              for (const riskFlags of riskSets)
                for (const immediatePoints of [0, 2])
                  for (const engineConfidence of [0.1, 0.9])
                    for (const isEquivalentToBest of [false, true]) {
                      cases += 1;
                      const best = analysis({ immediatePoints: immediatePoints > 0 ? 2 : 0 });
                      const result = evaluation({
                        bestMove: best,
                        chosen: chosenMove(category, { immediatePoints, riskFlags, isEquivalentToBest }),
                        engineConfidence,
                        isAmbiguousPosition,
                        neitherScores,
                      });
                      const packet = feedback({ result, playerLevel, gameMode });
                      const label = JSON.stringify({ category, playerLevel, gameMode, isAmbiguousPosition, neitherScores, riskFlags, immediatePoints, engineConfidence, isEquivalentToBest });

                      const copy = [packet.coachHeadline, packet.coachBodyShort, packet.coachBodyLong ?? '', packet.bestMoveLabel ?? ''].join('\n');
                      expect(copy, label).not.toMatch(BANNED);
                      expect(copy, label).not.toContain(String(ENGINE_SCORE));
                      expect(copy, label).not.toContain(String(SCORE_DELTA));
                      expect(packet.coachHeadline.trim().split(/\s+/).length, label).toBeLessThanOrEqual(8);
                      // Silence is deliberate (a mild miss at low confidence): headline and body are then empty together,
                      // and only when the coach decided not to intervene. Otherwise both must be filled.
                      if (packet.coachHeadline === '') {
                        expect(packet.coachBodyShort, label).toBe('');
                        expect(packet.interventionLevel, label).toBe('none');
                      } else {
                        expect(packet.coachBodyShort.length, label).toBeGreaterThan(0);
                      }
                      expect(packet.teachableMoments.length, label).toBeLessThanOrEqual(3);
                      expect(packet.confidence, label).toBe(engineConfidence);
                    }
    expect(cases).toBe(5 * 3 * 3 * 2 * 2 * 2 * 2 * 2 * 2);
  });
});

describe('before the player moves', () => {
  it('is silent: no grade, no intervention, no best-move label, no retry', () => {
    const packet = feedback({ result: evaluation({ chosen: null }), playerLevel: 'beginner', gameMode: 'challenge' });
    expect(packet.coachHeadline).toBe('Your turn.');
    expect(packet.moveGrade).toBeUndefined();
    expect(packet.interventionLevel).toBe('none');
    expect(packet.bestMoveLabel).toBeUndefined();
    expect(packet.retryRecommended).toBeUndefined();
  });
});

describe('equivalent moves', () => {
  it('are celebrated and never presented as a correction, even when the engine ranked them lower', () => {
    const packet = feedback({
      result: evaluation({ chosen: chosenMove('dubious', { isEquivalentToBest: true }) }),
      playerLevel: 'beginner',
      gameMode: 'guided',
    });
    expect(packet.coachHeadline).toBe('Nice one!');
    expect(packet.bestMoveLabel).toBeUndefined();
  });
});

describe('the best-move label', () => {
  const correction = (best: LearningMoveAnalysis, chosen: LearningMoveAnalysis) =>
    feedback({ result: evaluation({ bestMove: best, chosen }), playerLevel: 'beginner', gameMode: 'guided' }).bestMoveLabel;

  it('names the tile and side when the player missed a better play', () => {
    expect(correction(analysis(), chosenMove('dubious'))).toBe('[3|4] on the left');
  });

  it('says Pass when the better move was to pass', () => {
    const pass = analysis({ moveId: 'pass', move: { type: 'pass' } });
    expect(correction(pass, chosenMove('dubious'))).toBe('Pass');
  });

  it('falls back to the notation when the better move has no tile or position', () => {
    const odd = analysis({ moveId: 'odd', moveNotation: 'Some play', move: { type: 'play' } });
    expect(correction(odd, chosenMove('dubious'))).toBe('Some play');
  });

  it('is absent when the player played the best move', () => {
    expect(correction(analysis(), analysis())).toBeUndefined();
  });
});

describe('retry recommendation', () => {
  const retry = (category: MoveCategory, gameMode: LearnGameMode) =>
    feedback({ result: evaluation({ chosen: chosenMove(category) }), playerLevel: 'intermediate', gameMode }).retryRecommended;

  it('is only ever set for a strong intervention in challenge mode', () => {
    expect(retry('blunder', 'challenge')).toBe(true);
    expect(retry('dubious', 'challenge')).toBe(true);
    expect(retry('blunder', 'guided')).toBeUndefined();
    expect(retry('blunder', 'training')).toBeUndefined();
  });

  it('is not set for moves worth praising', () => {
    expect(retry('best', 'challenge')).toBeUndefined();
    expect(retry('excellent', 'challenge')).toBeUndefined();
  });
});

describe('intervention level in the packet', () => {
  it('stays quiet in an ambiguous position unless the move was a blunder', () => {
    const level = (category: MoveCategory) =>
      feedback({ result: evaluation({ chosen: chosenMove(category), isAmbiguousPosition: true }), playerLevel: 'beginner', gameMode: 'challenge' }).interventionLevel;
    expect(level('dubious')).toBe('none');
    expect(level('good')).toBe('none');
    expect(level('blunder')).toBe('strong');
  });

  it('softens one tier when nothing scores either way', () => {
    const level = (neitherScores: boolean) =>
      feedback({ result: evaluation({ chosen: chosenMove('blunder'), neitherScores }), playerLevel: 'beginner', gameMode: 'guided' }).interventionLevel;
    expect(level(false)).toBe('strong');
    expect(level(true)).toBe('medium');
  });
});

describe('teachable moments', () => {
  it('leads with the better move\'s concepts on a correction, deduplicates, and caps at three', () => {
    const best = analysis({ conceptTags: ['scoring', 'tempo'] as CoachingConceptTag[] });
    const chosen = chosenMove('dubious', {
      conceptTags: ['tempo', 'safety'] as CoachingConceptTag[],
      riskFlags: ['gives_easy_score_back', 'opens_dangerous_end'],
    });
    const packet = feedback({ result: evaluation({ bestMove: best, chosen }), playerLevel: 'intermediate', gameMode: 'guided' });
    expect(packet.teachableMoments).toEqual(['scoring', 'tempo', 'safety']);
  });

  it('adds the concept each risk flag teaches', () => {
    const chosen = chosenMove('good', {
      conceptTags: [],
      riskFlags: ['gives_easy_score_back', 'opens_dangerous_end', 'reduces_future_options'],
    });
    const packet = feedback({ result: evaluation({ chosen }), playerLevel: 'intermediate', gameMode: 'guided' });
    expect(packet.teachableMoments).toEqual(['risk_management', 'defense', 'flexibility']);
  });
});

describe('resolveInterventionDecision', () => {
  const best = (immediatePoints = 0) => analysis({ immediatePoints });
  const decide = (chosen: LearningMoveAnalysis | undefined, bestMove = best(), mode: LearnGameMode = 'guided') =>
    resolveInterventionDecision(chosen, bestMove, 'medium', mode);

  it('treats no chosen move, a best move and an excellent move as fine', () => {
    expect(decide(undefined).rationale).toBe('move_is_best_or_excellent');
    expect(decide(analysis({ category: 'best' })).rationale).toBe('move_is_best_or_excellent');
    expect(decide(analysis({ category: 'excellent' })).rationale).toBe('move_is_best_or_excellent');
  });

  it('applies the reasons in precedence order', () => {
    // a self-block outranks everything else
    expect(decide(chosenMove('blunder', { riskFlags: ['self_blocks', 'opens_dangerous_end'], scoreDeltaFromBest: 90 })).rationale).toBe('severe_self_block');
    // a missed clean score (the better move scored, this one did not, and the gap is over 34)
    expect(decide(chosenMove('dubious', { scoreDeltaFromBest: 40 }), best(2)).rationale).toBe('missed_clean_score');
    // gap of exactly 34 is not enough
    expect(decide(chosenMove('dubious', { scoreDeltaFromBest: 34 }), best(2)).rationale).toBe('missed_better_move_teachable');
    // opening a dangerous end
    expect(decide(chosenMove('dubious', { riskFlags: ['opens_dangerous_end'], scoreDeltaFromBest: 20 })).rationale).toBe('opened_risk');
    // blunders split on 60
    expect(decide(chosenMove('blunder', { scoreDeltaFromBest: 61 })).rationale).toBe('huge_missed_score');
    expect(decide(chosenMove('blunder', { scoreDeltaFromBest: 60 })).rationale).toBe('clear_blunder');
    // the rest
    expect(decide(chosenMove('dubious', { scoreDeltaFromBest: 20 })).rationale).toBe('missed_better_move_teachable');
    expect(decide(chosenMove('good', { scoreDeltaFromBest: 10 })).rationale).toBe('small_difference_trivial');
  });

  it('reports the level it was given, the delta, and a mode override only outside guided mode', () => {
    const guided = decide(chosenMove('good', { scoreDeltaFromBest: 12 }));
    expect(guided).toMatchObject({ level: 'medium', scoreDelta: 12 });
    expect(guided.modeOverride).toBeUndefined();
    expect(decide(chosenMove('good'), best(), 'challenge').modeOverride).toBe('challenge');
  });
});

describe('buildPreMoveRecommendation', () => {
  const recommend = (result: MoveEvaluationResult, level: PlayerLevel = 'beginner', mode: LearnGameMode = 'guided') =>
    buildPreMoveRecommendation(result, level, mode);

  it('hedges in an ambiguous position', () => {
    expect(recommend(evaluation({ chosen: null, isAmbiguousPosition: true })).promptText).toMatch(/about even/);
    expect(recommend(evaluation({ chosen: null, isAmbiguousPosition: true }), 'advanced').promptText).toMatch(/nearly equal/);
  });

  it('points at the scoring move when there is one', () => {
    const result = evaluation({ chosen: null, bestMove: analysis({ immediatePoints: 2 }) });
    expect(recommend(result).promptText).toBe('[3|4] → left scores points — that\'s your play.');
    expect(recommend(result, 'advanced').promptText).toMatch(/scoring move here/);
  });

  it('says so when nothing scores', () => {
    const result = evaluation({ chosen: null, neitherScores: true });
    expect(recommend(result).promptText).toMatch(/Nothing scores right now/);
    expect(recommend(result, 'advanced').promptText).toMatch(/No score available/);
  });

  it('falls back to the strongest-play line and lower-cases the explanation for advanced players', () => {
    const result = evaluation({ chosen: null });
    expect(recommend(result).promptText).toBe('[3|4] → left is the strongest play here.');
    expect(recommend(result, 'advanced').promptText).toBe('[3|4] → left — it keeps your options open.');
  });

  it('highlights the suggestion only in guided mode and passes the confidence through', () => {
    const result = evaluation({ chosen: null, engineConfidence: 0.42 });
    expect(recommend(result, 'beginner', 'guided').showHighlight).toBe(true);
    expect(recommend(result, 'beginner', 'training').showHighlight).toBe(false);
    expect(recommend(result, 'beginner', 'challenge').showHighlight).toBe(false);
    expect(recommend(result).confidence).toBe(0.42);
    expect(recommend(result).suggestedMove).toBe(result.bestMove);
  });
});
