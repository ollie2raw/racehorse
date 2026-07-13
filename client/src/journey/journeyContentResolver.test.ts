import { describe, expect, it } from 'vitest';
import {
  CORE_JOURNEY_RULESET_ID,
  type JourneyContentId,
  type JourneyFeedbackId,
  type JourneyLessonDefinition,
  type JourneyNodeId,
  type JourneySkillId,
} from './journeyContentContract';
import { JOURNEY_CHAPTER_DEFINITIONS } from './journeyChapters';
import {
  buildJourneyContentRegistry,
  getAllJourneyContentDescriptors,
  getAllJourneyLessonDefinitions,
  getAllJourneyLessonDefinitionsFromRegistry,
  getJourneyLessonDefinition,
  getJourneyLessonDefinitionFromRegistry,
  getCanonicalJourneyNodeIds,
  getJourneyContentDescriptor,
  resolveJourneyContent,
  PRODUCTION_JOURNEY_CONTENT_REGISTRY,
  PRODUCTION_PREMIUM_LESSON_DEFINITIONS,
} from './journeyContentResolver';
import {
  validateJourneyContentCoverage,
  validateJourneyLessonDefinition,
  summarizeJourneyContent,
} from './journeyContentValidation';
import { validateJourneyDescriptorSet } from './journeyContentValidationPrimitives';

const asContentId = (value: string) => value as JourneyContentId;
const asNodeId = (value: string) => value as JourneyNodeId;
const asSkillId = (value: string) => value as JourneySkillId;
const asFeedbackId = (value: string) => value as JourneyFeedbackId;
const feedback = { kind: 'outcome_bundle' as const, id: asFeedbackId('feedback:tempo') };

function makeFutureLesson(overrides: Partial<JourneyLessonDefinition> = {}): JourneyLessonDefinition {
  return {
    id: asContentId('premium:tempo-foundation'),
    nodeId: asNodeId('ch1-n02'),
    chapterId: 'ch1-fritz-trail',
    skillId: asSkillId('skill:tempo'),
    contentVersion: 1,
    ruleset: { kind: 'core_journey', id: CORE_JOURNEY_RULESET_ID },
    prerequisites: [],
    presentation: { tableContextId: 'table:opening', rivalContextId: 'rival:opening' },
    stages: [
      { id: 'frame', kind: 'frame', copyRef: 'journey.ch1.n02.frame', evidenceRole: 'none' },
      { id: 'demo', kind: 'board_demo', scenarioRef: 'scenario:tempo-demo', evidenceRole: 'none' },
      { id: 'decision', kind: 'decision', scenarioRef: 'scenario:tempo-1', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'none', failurePolicy: 'retry_required' },
      { id: 'guided', kind: 'guided_practice', scenarioRef: 'scenario:tempo-2', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'none', failurePolicy: 'allow_continue' },
      { id: 'practice', kind: 'independent_practice', scenarioRef: 'scenario:tempo-3', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: 'variants:tempo' }, evidenceRole: 'practice', failurePolicy: 'retry_required' },
      { id: 'authored', kind: 'authored_scenario', scenarioRef: 'scenario:tempo-4', feedbackRef: feedback, retry: { kind: 'controller_defined' }, evidenceRole: 'practice', failurePolicy: 'finish_attempt' },
      { id: 'mastery', kind: 'mastery', scenarioRef: 'scenario:tempo-5', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: 'variants:tempo' }, evidenceRole: 'proof', failurePolicy: 'retry_required' },
      { id: 'review', kind: 'review', scenarioRef: 'scenario:tempo-review', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'review', failurePolicy: 'retry_required' },
    ],
    completion: {
      kind: 'scorecard',
      requiredStageIds: ['decision', 'guided', 'practice', 'mastery'],
      keyDecisionIds: ['decision'],
      aggregateThresholdRef: 'threshold:tempo-mastery',
      failurePolicy: { kind: 'end_session' },
      owner: 'journey_lesson_controller',
    },
    ...overrides,
  };
}

function makeLesson(id: string, nodeId: string, prerequisites: string[] = []): JourneyLessonDefinition {
  return makeFutureLesson({
    id: asContentId(id),
    nodeId: asNodeId(nodeId),
    prerequisites: prerequisites.map(asContentId),
  });
}

describe('Journey content resolver coverage', () => {
  it('keeps the three production premium migration boundaries explicit', () => {
    expect(PRODUCTION_JOURNEY_CONTENT_REGISTRY.descriptors).toHaveLength(108);
    expect(PRODUCTION_JOURNEY_CONTENT_REGISTRY.descriptors.filter((descriptor) => descriptor.migrationClass === 'legacy')).toHaveLength(105);
    expect(PRODUCTION_JOURNEY_CONTENT_REGISTRY.descriptors.filter((descriptor) => descriptor.migrationClass === 'premium')).toHaveLength(3);
    expect(PRODUCTION_PREMIUM_LESSON_DEFINITIONS).toHaveLength(3);
    expect(PRODUCTION_PREMIUM_LESSON_DEFINITIONS[0].nodeId).toBe('ch1-n07');
    expect(PRODUCTION_PREMIUM_LESSON_DEFINITIONS[0].id).not.toBe('ch1-n07');
  });

  it('resolves every canonical node exactly once with stable ordering', () => {
    const nodeIds = getCanonicalJourneyNodeIds();
    const descriptors = getAllJourneyContentDescriptors();
    expect(descriptors.map((descriptor) => descriptor.nodeId)).toEqual(nodeIds);
    expect(new Set(descriptors.map((descriptor) => descriptor.nodeId)).size).toBe(nodeIds.length);
    expect(validateJourneyContentCoverage()).toEqual([]);
  });

  it('reports the current inventory and normalized capability baseline', () => {
    const summary = summarizeJourneyContent();
    expect(summary.totalNodeCount).toBe(108);
    expect(summary.trials.fullMatchCount + summary.trials.shortRaceCount).toBe(41);
    expect(summary.puzzleAnswerDistribution.totalPuzzles).toBe(48);
    expect(summary.normalizedContent).toMatchObject({
      supported: 90,
      legacyFallback: 0,
      placeholder: 18,
      unsupported: 0,
      coreJourneyRuleset: 108,
    });
    expect(summary.normalizedContent.capabilities).toMatchObject({
      briefing_acknowledgement: 18,
      static_decision: 45,
      interactive_board_decision: 1,
      bot_match: 35,
      boss_match: 6,
    });
  });

  it('activates the production Open-End Discipline lesson on the former fallback node', () => {
    const result = resolveJourneyContent('ch1-n07');
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.descriptor.migrationClass).toBe('premium');
    if (result.descriptor.migrationClass !== 'premium') return;
    expect(result.descriptor.runtime).toEqual({
      kind: 'lesson_sequence',
      lessonId: 'journey:ch1:open-end-discipline',
    });
    expect(result.descriptor.supportStatus).toBe('supported');
    expect(result.descriptor.runtimeAvailability).toBe('available');
    expect(result.descriptor.completion).toEqual({ kind: 'lesson_controller_result', owner: 'journey_lesson_controller' });
  });

  it('marks placeholders without promoting them to premium content', () => {
    const descriptor = getJourneyContentDescriptor('ch1-n01');
    expect(descriptor?.supportStatus).toBe('placeholder');
    expect(descriptor?.migrationClass).toBe('legacy');
    expect(descriptor?.runtime.kind).toBe('briefing_acknowledgement');
    expect(descriptor?.completion.kind).toBe('briefing_acknowledged');
  });

  it('rejects an unsupported descriptor that tries to use acknowledgement fallback', () => {
    const descriptor = getJourneyContentDescriptor('ch1-n01');
    expect(descriptor).not.toBeNull();
    if (!descriptor) return;
    const errors = validateJourneyContentCoverage([
      { ...descriptor, supportStatus: 'unsupported', runtime: { kind: 'unsupported', reason: 'fixture' } },
      ...getAllJourneyContentDescriptors().filter((entry) => entry.nodeId !== descriptor.nodeId),
    ]);
    expect(errors).toContainEqual(expect.stringContaining('incompatible'));
  });

  it('represents current puzzle, interactive puzzle, match, and boss authority', () => {
    expect(getJourneyContentDescriptor('ch1-n03')?.runtime.kind).toBe('interactive_board_decision');
    expect(getJourneyContentDescriptor('ch2-n02')?.runtime.kind).toBe('static_decision');
    expect(getJourneyContentDescriptor('ch1-n02')?.completion).toEqual({
      kind: 'bot_result', owner: 'journey_match_bridge', requiredResult: 'win',
    });
    expect(getJourneyContentDescriptor('ch1-n12')?.completion).toEqual({
      kind: 'boss_result', owner: 'journey_match_bridge', requiredResult: 'win',
    });
  });

  it('returns a typed missing result and rejects coverage drift', () => {
    expect(resolveJourneyContent('does-not-exist')).toEqual({ kind: 'missing', nodeId: 'does-not-exist' });
    const descriptors = getAllJourneyContentDescriptors();
    expect(validateJourneyContentCoverage(descriptors.slice(1))).toContain('ch1-n01: missing normalized descriptor');
    expect(validateJourneyContentCoverage([
      ...descriptors,
      { ...descriptors[0], nodeId: asNodeId('unknown-node'), contentId: asContentId('unknown-node') },
    ])).toContain('unknown-node: descriptor references unknown node');
  });
});

describe('future Journey lesson contract validation', () => {
  it('represents table context, all planned stages, retries, feedback, and a scorecard finale', () => {
    expect(validateJourneyLessonDefinition(makeFutureLesson())).toEqual([]);
  });

  it.each([
    ['content version', { contentVersion: 0 }, 'contentVersion'],
    ['skill ID', { skillId: '' }, 'skill ID'],
    ['stages', { stages: [] }, 'at least one stage'],
    ['duplicate stage IDs', { stages: [{ id: 'frame', kind: 'frame', copyRef: 'x' }, { id: 'frame', kind: 'frame', copyRef: 'y' }] }, 'duplicate stage ID'],
    ['unknown prerequisite', { prerequisites: [asContentId('missing-content')] }, 'unknown prerequisite'],
    ['invalid retry', { stages: [{ id: 'decision', kind: 'decision', scenarioRef: 'scenario:x', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: '' } }] }, 'variant-set ID'],
    ['unsupported stage', { stages: [{ id: 'bad', kind: 'unknown' }] }, 'unsupported stage kind'],
    ['unknown completion stage', { completion: { kind: 'required_stages', stageIds: ['missing'], owner: 'journey_lesson_controller' } }, 'unknown stage'],
  ])('rejects invalid %s', (_label, overrides, expected) => {
    expect(validateJourneyLessonDefinition(makeFutureLesson(overrides as Partial<JourneyLessonDefinition>))).toContainEqual(expect.stringContaining(expected));
  });

  it('rejects an unknown node and invalid ruleset reference', () => {
    const errors = validateJourneyLessonDefinition(makeFutureLesson({
      nodeId: asNodeId('missing-node'),
      ruleset: { kind: 'core_journey', id: 'wrong-ruleset' as typeof CORE_JOURNEY_RULESET_ID },
    }));
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('unknown node ID'),
      expect.stringContaining('invalid Core Journey ruleset ID'),
    ]));
  });

  it('rejects missing, empty, and unknown feedback references', () => {
    const missing = makeFutureLesson({
      stages: [{ id: 'decision', kind: 'decision', scenarioRef: 'scenario:x', retry: { kind: 'same_scenario' } } as never],
    });
    expect(validateJourneyLessonDefinition(missing)).toContainEqual(expect.stringContaining('missing feedback'));
    const unknown = makeFutureLesson({
      stages: [{ id: 'decision', kind: 'decision', scenarioRef: 'scenario:x', feedbackRef: { kind: 'unknown', id: '' }, retry: { kind: 'same_scenario' } } as never],
    });
    expect(validateJourneyLessonDefinition(unknown)).toContainEqual(expect.stringContaining('unknown feedback reference kind'));
    expect(validateJourneyLessonDefinition(unknown)).toContainEqual(expect.stringContaining('non-empty ID'));
  });

  it('requires explicit evidence roles and failure policies', () => {
    const frameWithProof = makeFutureLesson({ stages: [{ id: 'frame', kind: 'frame', copyRef: 'x', evidenceRole: 'proof' }] as never[] });
    expect(validateJourneyLessonDefinition(frameWithProof)).toContainEqual(expect.stringContaining('frame must use none evidence role'));
    const demoWithPractice = makeFutureLesson({ stages: [{ id: 'demo', kind: 'board_demo', scenarioRef: 'scenario:x', evidenceRole: 'practice' }] as never[] });
    expect(validateJourneyLessonDefinition(demoWithPractice)).toContainEqual(expect.stringContaining('board_demo must use none evidence role'));
    const missingFailure = makeFutureLesson({ stages: [{ id: 'decision', kind: 'decision', scenarioRef: 'scenario:x', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'none' }] as never[] });
    expect(validateJourneyLessonDefinition(missingFailure)).toContainEqual(expect.stringContaining('failure policy is required'));
    const wrongRole = makeFutureLesson({ stages: [{ id: 'mastery', kind: 'mastery', scenarioRef: 'scenario:x', feedbackRef: feedback, retry: { kind: 'same_scenario' }, evidenceRole: 'practice', failurePolicy: 'retry_required' }] as never[] });
    expect(validateJourneyLessonDefinition(wrongRole)).toContainEqual(expect.stringContaining('mastery must use proof evidence role'));
  });

  it('rejects malformed descriptor boundary values and incompatible authority', () => {
    const descriptor = getJourneyContentDescriptor('ch1-n02');
    expect(descriptor).not.toBeNull();
    if (!descriptor) return;
    const makeFixture = (changes: Record<string, unknown>) => [
      ...getAllJourneyContentDescriptors().filter((entry) => entry.nodeId !== descriptor.nodeId),
      { ...descriptor, ...changes },
    ];
    expect(validateJourneyContentCoverage(makeFixture({ runtime: { kind: 'future_runtime' } }))).toContainEqual(expect.stringContaining('unknown or missing runtime kind'));
    expect(validateJourneyContentCoverage(makeFixture({ completion: { kind: 'future_completion' } }))).toContainEqual(expect.stringContaining('unknown or missing completion kind'));
    expect(validateJourneyContentCoverage(makeFixture({ supportStatus: 'future_status' }))).toContainEqual(expect.stringContaining('unknown or missing support status'));
    expect(validateJourneyContentCoverage(makeFixture({ migrationClass: 'future_migration' }))).toContainEqual(expect.stringContaining('unknown or missing migration class'));
    expect(validateJourneyContentCoverage(makeFixture({ ruleset: { kind: 'future_ruleset', id: 'x' } }))).toContainEqual(expect.stringContaining('unknown or missing ruleset kind'));
    expect(validateJourneyContentCoverage(makeFixture({ completion: { kind: 'briefing_acknowledged', owner: 'journey_ui' } }))).toContainEqual(expect.stringContaining('incompatible'));
    expect(validateJourneyContentCoverage(makeFixture({ runtime: { kind: 'lesson_sequence', lessonId: 'premium:x' }, runtimeAvailability: 'unavailable', completion: { kind: 'briefing_acknowledged', owner: 'journey_ui' } }))).toContainEqual(expect.stringContaining('incompatible'));
    expect(validateJourneyContentCoverage(makeFixture({ runtime: { kind: 'external_navigation', mode: 'home' }, completion: { kind: 'briefing_acknowledged', owner: 'journey_ui' } }))).toContainEqual(expect.stringContaining('incompatible'));
    expect(validateJourneyContentCoverage(makeFixture({ supportStatus: 'unsupported', runtime: { kind: 'unsupported', reason: 'fixture' }, completion: { kind: 'briefing_acknowledged', owner: 'journey_ui' } }))).toContainEqual(expect.stringContaining('incompatible'));
  });

  it('overlays one test-only premium lesson without changing node coverage', () => {
    const registry = buildJourneyContentRegistry({
      canonicalChapters: JOURNEY_CHAPTER_DEFINITIONS,
      premiumLessonDefinitions: [makeFutureLesson()],
    });
    expect(registry.descriptors).toHaveLength(108);
    expect(new Set(registry.descriptors.map((descriptor) => descriptor.nodeId)).size).toBe(108);
    const descriptor = registry.descriptors.find((entry) => entry.nodeId === 'ch1-n02');
    expect(descriptor?.migrationClass).toBe('premium');
    expect(descriptor?.contentId).toBe('premium:tempo-foundation');
    expect(descriptor?.runtime).toEqual({ kind: 'lesson_sequence', lessonId: 'premium:tempo-foundation' });
    expect(descriptor?.runtimeAvailability).toBe('unavailable');
    expect(descriptor?.migrationClass === 'premium' && 'legacy' in descriptor).toBe(false);
    expect(validateJourneyContentCoverage(registry.descriptors)).toEqual([]);
  });

  it('rejects duplicate premium targets, duplicate IDs, unknown nodes, and chapter mismatches', () => {
    expect(() => buildJourneyContentRegistry({
      canonicalChapters: JOURNEY_CHAPTER_DEFINITIONS,
      premiumLessonDefinitions: [makeLesson('ch1-n03', 'ch1-n02')],
    })).toThrow('collides with untouched legacy content');
    expect(() => buildJourneyContentRegistry({
      canonicalChapters: JOURNEY_CHAPTER_DEFINITIONS,
      premiumLessonDefinitions: [makeFutureLesson(), makeFutureLesson({ id: asContentId('premium:other') })],
    })).toThrow('Multiple premium lessons target node ch1-n02');
    expect(() => buildJourneyContentRegistry({
      canonicalChapters: JOURNEY_CHAPTER_DEFINITIONS,
      premiumLessonDefinitions: [makeFutureLesson(), makeFutureLesson({ nodeId: asNodeId('ch1-n03') })],
    })).toThrow('Duplicate premium content ID');
    expect(() => buildJourneyContentRegistry({
      canonicalChapters: JOURNEY_CHAPTER_DEFINITIONS,
      premiumLessonDefinitions: [makeFutureLesson({ nodeId: asNodeId('missing-node') })],
    })).toThrow('targets unknown node');
    expect(() => buildJourneyContentRegistry({
      canonicalChapters: JOURNEY_CHAPTER_DEFINITIONS,
      premiumLessonDefinitions: [makeFutureLesson({ chapterId: 'ch2-high-line' })],
    })).toThrow('does not match node');
  });

  it('validates premium definitions during registry construction', () => {
    const invalidCases: Array<[string, Partial<JourneyLessonDefinition>, string]> = [
      ['content version', { contentVersion: 0 }, 'contentVersion'],
      ['skill', { skillId: asSkillId('') }, 'skill ID'],
      ['empty stages', { stages: [] }, 'at least one stage'],
      ['missing scenario', { stages: [{ id: 'decision', kind: 'decision', feedbackRef: feedback, retry: { kind: 'same_scenario' } }] as never[] }, 'requires scenarioRef'],
      ['missing feedback', { stages: [{ id: 'decision', kind: 'decision', scenarioRef: 'scenario:x', retry: { kind: 'same_scenario' } }] as never[] }, 'missing feedback'],
      ['unknown feedback', { stages: [{ id: 'decision', kind: 'decision', scenarioRef: 'scenario:x', feedbackRef: { kind: 'unknown', id: asFeedbackId('feedback:x') }, retry: { kind: 'same_scenario' } }] as never[] }, 'unknown feedback reference kind'],
      ['duplicate stage', { stages: [{ id: 'decision', kind: 'decision', scenarioRef: 'scenario:x', feedbackRef: feedback, retry: { kind: 'same_scenario' } }, { id: 'decision', kind: 'decision', scenarioRef: 'scenario:y', feedbackRef: feedback, retry: { kind: 'same_scenario' } }] as never[] }, 'duplicate stage ID'],
      ['invalid retry', { stages: [{ id: 'decision', kind: 'decision', scenarioRef: 'scenario:x', feedbackRef: feedback, retry: { kind: 'fresh_variant', variantSetId: '' } }] as never[] }, 'variant-set ID'],
      ['missing retry', { stages: [{ id: 'decision', kind: 'decision', scenarioRef: 'scenario:x', feedbackRef: feedback }] as never[] }, 'retry policy is required'],
      ['completion stage', { completion: { kind: 'required_stages', stageIds: ['missing'], owner: 'journey_lesson_controller' } }, 'unknown stage'],
      ['scorecard threshold', { completion: { kind: 'scorecard', requiredStageIds: ['decision'], keyDecisionIds: ['decision'], aggregateThresholdRef: '', failurePolicy: { kind: 'end_session' }, owner: 'journey_lesson_controller' } }, 'aggregateThresholdRef'],
      ['ruleset', { ruleset: { kind: 'core_journey', id: 'invalid' } as never }, 'invalid Core Journey'],
      ['prerequisite', { prerequisites: [asContentId('missing-content')] }, 'unknown prerequisite'],
    ];
    for (const [_label, overrides, expected] of invalidCases) {
      expect(() => buildJourneyContentRegistry({
        canonicalChapters: JOURNEY_CHAPTER_DEFINITIONS,
        premiumLessonDefinitions: [makeFutureLesson(overrides)],
      })).toThrow(expected);
    }
    expect(() => buildJourneyContentRegistry({
      canonicalChapters: JOURNEY_CHAPTER_DEFINITIONS,
      premiumLessonDefinitions: [makeLesson('premium:self', 'ch1-n02', ['premium:self'])],
    })).toThrow('cannot prerequisite itself');
    expect(() => buildJourneyContentRegistry({
      canonicalChapters: JOURNEY_CHAPTER_DEFINITIONS,
      premiumLessonDefinitions: [makeLesson('premium:removed-prereq', 'ch1-n02', ['ch1-n02'])],
    })).toThrow('unknown prerequisite content ID ch1-n02');
    expect(() => buildJourneyContentRegistry({
      canonicalChapters: JOURNEY_CHAPTER_DEFINITIONS,
      premiumLessonDefinitions: [makeLesson('premium:duplicate-prereq', 'ch1-n02', ['ch1-n01', 'ch1-n01'])],
    })).toThrow('duplicate prerequisite');
  });

  it('validates cross-premium prerequisites independent of input order', () => {
    const lessonA = makeLesson('premium:lesson-a', 'ch1-n02');
    const lessonB = makeLesson('premium:lesson-b', 'ch1-n03', ['premium:lesson-a']);
    const first = buildJourneyContentRegistry({ canonicalChapters: JOURNEY_CHAPTER_DEFINITIONS, premiumLessonDefinitions: [lessonA, lessonB] });
    const second = buildJourneyContentRegistry({ canonicalChapters: JOURNEY_CHAPTER_DEFINITIONS, premiumLessonDefinitions: [lessonB, lessonA] });
    expect(first.descriptors.map((descriptor) => descriptor.nodeId)).toEqual(second.descriptors.map((descriptor) => descriptor.nodeId));
    expect(first.premiumDefinitions.map((definition) => definition.id)).toEqual(['premium:lesson-a', 'premium:lesson-b']);
    expect(second.premiumDefinitions.map((definition) => definition.id)).toEqual(['premium:lesson-a', 'premium:lesson-b']);
    expect(first.descriptors).toHaveLength(108);
    expect(first.premiumDefinitions).toHaveLength(2);
    expect(getJourneyLessonDefinitionFromRegistry(first, 'premium:lesson-a')?.id).toBe('premium:lesson-a');
    expect(getJourneyLessonDefinitionFromRegistry(first, 'ch1-n02')).toBeNull();
  });

  it('exposes isolated production and registry lookup collections', () => {
    expect(getJourneyLessonDefinition('premium:lesson-a')).toBeNull();
    expect(getAllJourneyLessonDefinitions()).toHaveLength(3);
    expect(getAllJourneyLessonDefinitions()[0].id).toBe('journey:ch1:open-end-discipline');
    const registry = buildJourneyContentRegistry({ canonicalChapters: JOURNEY_CHAPTER_DEFINITIONS, premiumLessonDefinitions: [makeLesson('premium:lookup', 'ch1-n02')] });
    const definitions = getAllJourneyLessonDefinitionsFromRegistry(registry);
    definitions.pop();
    expect(getJourneyLessonDefinitionFromRegistry(registry, 'premium:lookup')).not.toBeNull();
  });

  it('rejects descriptor-definition drift through the pure integrity validator', () => {
    const definition = makeLesson('premium:integrity', 'ch1-n02');
    const registry = buildJourneyContentRegistry({ canonicalChapters: JOURNEY_CHAPTER_DEFINITIONS, premiumLessonDefinitions: [definition] });
    const context = {
      canonicalNodeIds: new Set(JOURNEY_CHAPTER_DEFINITIONS.flatMap((chapter) => chapter.nodes.map((node) => node.id))),
      chapterByNodeId: new Map(JOURNEY_CHAPTER_DEFINITIONS.flatMap((chapter) => chapter.nodes.map((node) => [node.id, chapter.chapterId] as const))),
      knownContentIds: new Set(registry.descriptors.map((descriptor) => descriptor.contentId)),
    };
    expect(validateJourneyDescriptorSet([{ ...registry.descriptors[1], contentId: asContentId('premium:missing') }], [definition], context)).toContainEqual(expect.stringContaining('missing definition'));
    const premium = registry.descriptors.find((descriptor) => descriptor.migrationClass === 'premium');
    expect(premium).toBeDefined();
    if (!premium || premium.migrationClass !== 'premium') return;
    expect(validateJourneyDescriptorSet([{ ...premium, chapterId: 'ch2-high-line' }, ...registry.descriptors.filter((descriptor) => descriptor.nodeId !== premium.nodeId)], [definition], context)).toContainEqual(expect.stringContaining('chapter mismatch'));
  });
});
