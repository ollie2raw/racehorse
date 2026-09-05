import { describe, it, expect } from 'vitest';
import {
  computeActivePlacementMoves,
  buildGuidedCoachingFlags,
  buildLessonRecommendedTileKey,
  buildLessonCoachVm,
  buildLessonCoachPanelContent,
  buildGuidedCoachPresentation,
} from './buildGuidedCoachPresentation.ts';
import type {
  BuildGuidedCoachPresentationInput,
} from './guidedCoachPresentationTypes.ts';
import type { GuidedCoachViewModel } from '../match/types.ts';
import type { Move } from '../../types.ts';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import {
  makeAuthoredStep,
  makeFrozenLesson,
  makeGuidedTranscript,
  makeGuidedTurn,
  makeLessonV2,
  makeLessonV2Event,
} from './guidedTestFixtures.ts';

const play = (low: number, high: number, position: Move['position'] = 'left'): Move => ({
  type: 'play',
  tile: { low, high },
  position,
});

const matchWith = (overrides: Partial<BotMatchState> = {}): BotMatchState =>
  ({ ...createBotMatch(), ...overrides } as BotMatchState);

// ── computeActivePlacementMoves ────────────────────────────────────────────
describe('computeActivePlacementMoves', () => {
  const moves = [play(3, 4, 'left'), play(3, 4, 'right'), play(5, 6, 'left')];

  it('returns userPlayMoves untouched when not in V2 mode', () => {
    expect(computeActivePlacementMoves(false, false, makeLessonV2Event(), moves)).toBe(moves);
  });

  it('returns userPlayMoves untouched when V2 but off-line', () => {
    expect(computeActivePlacementMoves(true, true, makeLessonV2Event(), moves)).toBe(moves);
  });

  it('returns userPlayMoves untouched when the expected event is not a play', () => {
    const drawEvent = makeLessonV2Event({ action: 'draw', tile: undefined });
    expect(computeActivePlacementMoves(true, false, drawEvent, moves)).toBe(moves);
  });

  it('filters to every placement of the expected tile when no position is pinned', () => {
    const event = makeLessonV2Event({ action: 'play', tile: '3|4', position: undefined });
    expect(computeActivePlacementMoves(true, false, event, moves)).toEqual([
      play(3, 4, 'left'),
      play(3, 4, 'right'),
    ]);
  });

  it('filters to the single placement matching both tile and position', () => {
    const event = makeLessonV2Event({ action: 'play', tile: '3|4', position: 'right' });
    expect(computeActivePlacementMoves(true, false, event, moves)).toEqual([play(3, 4, 'right')]);
  });

  it('returns [] when no user move matches the expected tile', () => {
    const event = makeLessonV2Event({ action: 'play', tile: '0|1' });
    expect(computeActivePlacementMoves(true, false, event, moves)).toEqual([]);
  });

});

// ── buildGuidedCoachingFlags ───────────────────────────────────────────────
describe('buildGuidedCoachingFlags', () => {
  const baseInput = (overrides: Partial<Parameters<typeof buildGuidedCoachingFlags>[0]> = {}) => ({
    match: matchWith({ currentPlayer: 'you', handOver: false, gameOver: false }),
    handActive: true,
    botTurn: false,
    drawSequenceActive: false,
    handReveal: null,
    isTransitioning: false,
    lessonLayoutMode: true,
    isGuidedV2Mode: false,
    isGuidedV2OffLine: false,
    currentV2CursorEvent: null,
    ...overrides,
  });

  it('happy path: player is coached, fritz panel hidden', () => {
    const f = buildGuidedCoachingFlags(baseInput());
    expect(f.isAwaitingPlayerTurnAction).toBe(true);
    expect(f.showPlayerCoaching).toBe(true);
    expect(f.canPlayCoachedMove).toBe(true);
    expect(f.showLessonCoachPanel).toBe(true);
    expect(f.showFritzCoachingPanel).toBe(false);
  });

  it('botTurn -> fritz panel shows, player coaching off', () => {
    const f = buildGuidedCoachingFlags(baseInput({ botTurn: true }));
    expect(f.showPlayerCoaching).toBe(false);
    expect(f.showFritzCoachingPanel).toBe(true);
  });

  it('a pending hand reveal opens the transition and closes both panels', () => {
    const f = buildGuidedCoachingFlags(
      baseInput({ handReveal: { winner: 'you' } as never, botTurn: true }),
    );
    expect(f.isHandOverTransitionOpen).toBe(true);
    expect(f.showPlayerCoaching).toBe(false);
    expect(f.showFritzCoachingPanel).toBe(false);
  });

  it('drawSequenceActive suppresses awaiting-action and the fritz panel', () => {
    const f = buildGuidedCoachingFlags(baseInput({ botTurn: true, drawSequenceActive: true }));
    expect(f.isAwaitingPlayerTurnAction).toBe(false);
    expect(f.showFritzCoachingPanel).toBe(false);
  });

  it('handOver keeps the lesson panel but drops player coaching', () => {
    const f = buildGuidedCoachingFlags(baseInput({ match: matchWith({ handOver: true }) }));
    expect(f.showPlayerCoaching).toBe(false);
    expect(f.showLessonCoachPanel).toBe(true);
  });

  it('gameOver closes the lesson panel entirely', () => {
    const f = buildGuidedCoachingFlags(baseInput({ match: matchWith({ gameOver: true }) }));
    expect(f.showLessonCoachPanel).toBe(false);
    expect(f.showPlayerCoaching).toBe(false);
    expect(f.showFritzCoachingPanel).toBe(false);
  });

  it('V2: fritz cursor event -> isGuidedV2FritzResolving, fritz panel on, player coaching off', () => {
    const f = buildGuidedCoachingFlags(
      baseInput({ isGuidedV2Mode: true, currentV2CursorEvent: makeLessonV2Event({ actor: 'fritz' }) }),
    );
    expect(f.isGuidedV2FritzResolving).toBe(true);
    expect(f.showFritzCoachingPanel).toBe(true);
    expect(f.showPlayerCoaching).toBe(false);
  });

  it('V2 online with a null cursor event -> player coaching off (cursor gate fails closed)', () => {
    const f = buildGuidedCoachingFlags(
      baseInput({ isGuidedV2Mode: true, currentV2CursorEvent: null }),
    );
    expect(f.isAwaitingPlayerTurnAction).toBe(false);
    expect(f.showPlayerCoaching).toBe(false);
  });

  it('lessonLayoutMode false -> every panel flag is false', () => {
    const f = buildGuidedCoachingFlags(baseInput({ lessonLayoutMode: false }));
    expect(f.showPlayerCoaching).toBe(false);
    expect(f.showFritzCoachingPanel).toBe(false);
    expect(f.showLessonCoachPanel).toBe(false);
  });
});

// ── buildLessonRecommendedTileKey ──────────────────────────────────────────
describe('buildLessonRecommendedTileKey', () => {
  const base = (overrides: Partial<Parameters<typeof buildLessonRecommendedTileKey>[0]> = {}) => ({
    showPlayerCoaching: true,
    isGuidedV2Mode: false,
    isGuidedV2OffLine: false,
    currentExpectedV2PlayerEvent: null,
    isGuidedTranscriptMode: false,
    currentTranscriptTurn: null,
    isGuidedFrozenLessonMode: false,
    currentLessonStep: null,
    ...overrides,
  });

  it('null when the player is not being coached', () => {
    expect(buildLessonRecommendedTileKey(base({ showPlayerCoaching: false }))).toBeNull();
  });

  it('V2 online play event -> the expected tile key', () => {
    expect(
      buildLessonRecommendedTileKey(
        base({
          isGuidedV2Mode: true,
          currentExpectedV2PlayerEvent: makeLessonV2Event({ action: 'play', tile: '3|4' }),
        }),
      ),
    ).toBe('3|4');
  });

  it('V2 online non-play event -> null', () => {
    expect(
      buildLessonRecommendedTileKey(
        base({
          isGuidedV2Mode: true,
          currentExpectedV2PlayerEvent: makeLessonV2Event({ action: 'draw', tile: undefined }),
        }),
      ),
    ).toBeNull();
  });

  it('transcript mode play turn -> the expected tile', () => {
    expect(
      buildLessonRecommendedTileKey(
        base({
          isGuidedTranscriptMode: true,
          currentTranscriptTurn: makeGuidedTurn({
            expectedPlayerMove: { type: 'play', tile: '5|6', position: 'left' },
          }),
        }),
      ),
    ).toBe('5|6');
  });

  it('transcript mode non-play turn -> null', () => {
    expect(
      buildLessonRecommendedTileKey(
        base({
          isGuidedTranscriptMode: true,
          currentTranscriptTurn: makeGuidedTurn({ expectedPlayerMove: { type: 'draw' } }),
        }),
      ),
    ).toBeNull();
  });

  it('frozen mode: strips the ":position" suffix, returning the "low|high" key (F22/F23)', () => {
    expect(
      buildLessonRecommendedTileKey(
        base({
          isGuidedFrozenLessonMode: true,
          currentLessonStep: makeAuthoredStep({ chosenMove: '6|6:left' }),
        }),
      ),
    ).toBe('6|6');
  });

  it('frozen mode: a "draw"/"pass" chosenMove yields null (F22 guard)', () => {
    for (const chosenMove of ['draw', 'pass']) {
      expect(
        buildLessonRecommendedTileKey(
          base({ isGuidedFrozenLessonMode: true, currentLessonStep: makeAuthoredStep({ chosenMove }) }),
        ),
      ).toBeNull();
    }
  });
});

// ── buildLessonCoachVm ─────────────────────────────────────────────────────
describe('buildLessonCoachVm', () => {
  const base = (overrides: Partial<Parameters<typeof buildLessonCoachVm>[0]> = {}) => ({
    showLessonCoachPanel: true,
    showPlayerCoaching: true,
    isGuidedTranscriptMode: false,
    guidedTranscript: null,
    lessonStepIndex: 0,
    isOffAuthoredLine: false,
    currentTranscriptTurn: null,
    isGuidedFrozenLessonMode: false,
    frozenLesson: null,
    currentLessonStep: null,
    guidedV2PlaybackReady: false,
    frozenV2Lesson: null,
    guidedV2EventIndex: 0,
    currentV2CoachingText: '',
    currentExpectedV2PlayerEvent: null,
    isGuidedV2OffLine: false,
    userPlayMoves: [] as Move[],
    ...overrides,
  });

  it('null when the lesson coach panel is not shown', () => {
    expect(buildLessonCoachVm(base({ showLessonCoachPanel: false }))).toBeNull();
  });

  it('transcript: totalSteps = turn count, coaching text + canBestMove on a play turn with moves', () => {
    const transcript = makeGuidedTranscript({
      turns: [makeGuidedTurn({ stepIndex: 0, coachingText: 'Block sixes' }), makeGuidedTurn({ stepIndex: 1 })],
    });
    const vm = buildLessonCoachVm(
      base({
        isGuidedTranscriptMode: true,
        guidedTranscript: transcript,
        currentTranscriptTurn: transcript.turns[0],
        userPlayMoves: [play(3, 4)],
      }),
    );
    expect(vm).toMatchObject({ stepIndex: 0, totalSteps: 2, coachingText: 'Block sixes', canBestMove: true });
  });

  it('transcript: showPlayerCoaching false blanks the text and disables canBestMove', () => {
    const transcript = makeGuidedTranscript();
    const vm = buildLessonCoachVm(
      base({
        showPlayerCoaching: false,
        isGuidedTranscriptMode: true,
        guidedTranscript: transcript,
        currentTranscriptTurn: transcript.turns[0],
        userPlayMoves: [play(3, 4)],
      }),
    );
    expect(vm?.coachingText).toBe('');
    expect(vm?.canBestMove).toBe(false);
  });

  it('transcript: isOffAuthoredLine disables canBestMove and is echoed on the vm', () => {
    const transcript = makeGuidedTranscript();
    const vm = buildLessonCoachVm(
      base({
        isGuidedTranscriptMode: true,
        guidedTranscript: transcript,
        currentTranscriptTurn: transcript.turns[0],
        isOffAuthoredLine: true,
        userPlayMoves: [play(3, 4)],
      }),
    );
    expect(vm?.canBestMove).toBe(false);
    expect(vm?.isOffAuthoredLine).toBe(true);
  });

  it('frozen: totalSteps = authored (non-draft) step count; canBestMove on a real tile move', () => {
    const frozenLesson = makeFrozenLesson({
      steps: [
        makeAuthoredStep({ stepIndex: 0, chosenMove: '0|0:left' }),
        makeAuthoredStep({ stepIndex: 1, chosenMove: null }),
        makeAuthoredStep({ stepIndex: 2, chosenMove: '2|2:right' }),
      ],
    });
    const vm = buildLessonCoachVm(
      base({
        isGuidedFrozenLessonMode: true,
        frozenLesson,
        currentLessonStep: frozenLesson.steps[0],
        userPlayMoves: [play(0, 0)],
      }),
    );
    expect(vm).toMatchObject({ totalSteps: 2, canBestMove: true });
  });

  it('frozen: a "draw" chosenMove disables canBestMove', () => {
    const frozenLesson = makeFrozenLesson();
    const vm = buildLessonCoachVm(
      base({
        isGuidedFrozenLessonMode: true,
        frozenLesson,
        currentLessonStep: makeAuthoredStep({ chosenMove: 'draw' }),
        userPlayMoves: [play(0, 0)],
      }),
    );
    expect(vm?.canBestMove).toBe(false);
  });

  it('V2: stepIndex counts player plays before the cursor; totalSteps = max(playerPlays, 1)', () => {
    const events = [
      makeLessonV2Event({ eventIndex: 0, actor: 'player', action: 'play', tile: '1|1' }),
      makeLessonV2Event({ eventIndex: 1, actor: 'fritz', action: 'play', tile: '2|2' }),
      makeLessonV2Event({ eventIndex: 2, actor: 'player', action: 'play', tile: '3|3' }),
    ];
    const vm = buildLessonCoachVm(
      base({
        guidedV2PlaybackReady: true,
        frozenV2Lesson: makeLessonV2({ events }),
        guidedV2EventIndex: 2,
        currentExpectedV2PlayerEvent: events[2],
        currentV2CoachingText: 'Play the 3-3',
        userPlayMoves: [play(3, 3)],
      }),
    );
    expect(vm).toMatchObject({ stepIndex: 1, totalSteps: 2, coachingText: 'Play the 3-3', canBestMove: true });
  });

  it('V2: canBestMove false when no user move matches the expected tile', () => {
    const events = [makeLessonV2Event({ eventIndex: 0, actor: 'player', action: 'play', tile: '3|3' })];
    const vm = buildLessonCoachVm(
      base({
        guidedV2PlaybackReady: true,
        frozenV2Lesson: makeLessonV2({ events }),
        guidedV2EventIndex: 0,
        currentExpectedV2PlayerEvent: events[0],
        userPlayMoves: [play(5, 6)],
      }),
    );
    expect(vm?.canBestMove).toBe(false);
  });

  it('V2: isGuidedV2OffLine sets isOffAuthoredLine on the vm and forces canBestMove false', () => {
    const events = [makeLessonV2Event({ eventIndex: 0, actor: 'player', action: 'play', tile: '3|3' })];
    const vm = buildLessonCoachVm(
      base({
        guidedV2PlaybackReady: true,
        frozenV2Lesson: makeLessonV2({ events }),
        guidedV2EventIndex: 0,
        currentExpectedV2PlayerEvent: events[0],
        userPlayMoves: [play(3, 3)],
        isGuidedV2OffLine: true,
      }),
    );
    expect(vm?.isOffAuthoredLine).toBe(true);
    expect(vm?.canBestMove).toBe(false);
  });
});

// ── buildLessonCoachPanelContent ──────────────────────────────────────────
describe('buildLessonCoachPanelContent', () => {
  const vm = (overrides: Partial<GuidedCoachViewModel> = {}): GuidedCoachViewModel => ({
    stepIndex: 0,
    totalSteps: 3,
    coachingText: 'text',
    canBestMove: false,
    isOffAuthoredLine: false,
    ...overrides,
  });

  const base = (overrides: Partial<Parameters<typeof buildLessonCoachPanelContent>[0]> = {}) => ({
    lessonCoachVm: vm(),
    lessonCoachProgressLabel: '1 / 3',
    lessonCoachProgressCount: 1,
    showFritzCoachingPanel: false,
    isHandOverTransitionOpen: false,
    showPlayerCoaching: false,
    lessonCoachContent: { title: 'Your decision', bodyParagraphs: ['body'], summary: null },
    lessonCoachPreviewText: 'preview',
    showCoachMoreButton: false,
    currentExpectedV2PlayerEvent: null,
    lessonRecommendedTileLabel: null,
    ...overrides,
  });

  it('null vm -> null', () => {
    expect(buildLessonCoachPanelContent(base({ lessonCoachVm: null }))).toBeNull();
  });

  it('off the authored line -> "Live position"', () => {
    expect(
      buildLessonCoachPanelContent(base({ lessonCoachVm: vm({ isOffAuthoredLine: true }) }))?.title,
    ).toBe('Live position');
  });

  it('fritz panel -> "Fritz is playing" with a "Fritz turn" chip', () => {
    const content = buildLessonCoachPanelContent(base({ showFritzCoachingPanel: true }));
    expect(content?.title).toBe('Fritz is playing');
    expect(content?.progressChipLabel).toBe('Fritz turn');
  });

  it('hand-over transition -> "Hand complete"', () => {
    expect(buildLessonCoachPanelContent(base({ isHandOverTransitionOpen: true }))?.title).toBe(
      'Hand complete',
    );
  });

  it('player coaching -> content title, footer shown, filtered context chips', () => {
    const content = buildLessonCoachPanelContent(
      base({
        showPlayerCoaching: true,
        lessonCoachContent: { title: 'Block sixes', bodyParagraphs: ['b'], summary: null },
        lessonCoachProgressCount: 2,
        currentExpectedV2PlayerEvent: makeLessonV2Event({ handNumber: 3 }),
        lessonRecommendedTileLabel: '6-6',
      }),
    );
    expect(content?.title).toBe('Block sixes');
    expect(content?.showFooter).toBe(true);
    expect(content?.contextChips).toEqual(['Hand 3', 'Move 2', 'Play 6-6']);
  });

  it('no branch matches -> the "Guided Match" fallback', () => {
    expect(buildLessonCoachPanelContent(base())?.title).toBe('Guided Match');
  });
});

// ── buildGuidedCoachPresentation (end-to-end) ──────────────────────────────
describe('buildGuidedCoachPresentation', () => {
  const v2Events = [
    makeLessonV2Event({ eventIndex: 0, actor: 'player', action: 'play', tile: '1|1', coachingText: 'one' }),
    makeLessonV2Event({ eventIndex: 1, actor: 'player', action: 'play', tile: '2|2', coachingText: 'two' }),
    makeLessonV2Event({ eventIndex: 2, actor: 'player', action: 'play', tile: '3|3', coachingText: 'three' }),
  ];

  const input = (overrides: Partial<BuildGuidedCoachPresentationInput> = {}): BuildGuidedCoachPresentationInput => ({
    match: matchWith({ currentPlayer: 'you', handOver: false, gameOver: false }),
    userPlayMoves: [play(2, 2)],
    handActive: true,
    botTurn: false,
    drawSequenceActive: false,
    handReveal: null,
    isTransitioning: false,
    showRecommendation: true,
    lessonLayoutMode: true,
    isGuidedV2Mode: true,
    isGuidedV2OffLine: false,
    isGuidedTranscriptMode: false,
    isGuidedFrozenLessonMode: false,
    guidedV2PlaybackReady: true,
    guidedV2EventIndex: 1,
    currentV2CursorEvent: v2Events[1],
    currentExpectedV2PlayerEvent: v2Events[1],
    currentV2CoachingText: 'two',
    guidedTranscript: null,
    frozenLesson: null,
    frozenV2Lesson: makeLessonV2({ events: v2Events }),
    lessonStepIndex: 0,
    isOffAuthoredLine: false,
    currentTranscriptTurn: null,
    currentLessonStep: null,
    ...overrides,
  });

  it('computes progress label/count/pct from the vm (1 play consumed of 3)', () => {
    const p = buildGuidedCoachPresentation(input());
    expect(p.lessonCoachProgressCount).toBe(2); // stepIndex 1 + 1
    expect(p.lessonCoachProgressLabel).toBe('2 / 3');
    expect(p.lessonCoachProgressPct).toBeCloseTo((2 / 3) * 100);
  });

  it('falls back to "1 / 1" and 0% when there is no vm', () => {
    const p = buildGuidedCoachPresentation(input({ lessonLayoutMode: false, guidedV2PlaybackReady: false }));
    expect(p.lessonCoachVm).toBeNull();
    expect(p.lessonCoachProgressLabel).toBe('1 / 1');
    expect(p.lessonCoachProgressPct).toBe(0);
  });

  it('showCoachMoreButton is true when the body exceeds the ~600-char preview cap by > 16 chars', () => {
    // Under 600 chars the preview text equals the body, so "more" only appears
    // once the body is long enough for buildCoachPreviewText to truncate it.
    const longBody = `Short title\n\n${'x'.repeat(700)}`;
    const p = buildGuidedCoachPresentation(
      input({
        currentV2CoachingText: longBody,
        currentExpectedV2PlayerEvent: { ...v2Events[1], coachingText: longBody },
      }),
    );
    expect(p.showCoachMoreButton).toBe(true);
  });

  it('showCoachMoreButton is false for a short body', () => {
    const p = buildGuidedCoachPresentation(input({ currentV2CoachingText: 'Tiny note' }));
    expect(p.showCoachMoreButton).toBe(false);
  });

  it('showCoachedRecommendation requires showPlayerCoaching + showRecommendation + vm.canBestMove', () => {
    expect(buildGuidedCoachPresentation(input()).showCoachedRecommendation).toBe(true);
    expect(buildGuidedCoachPresentation(input({ showRecommendation: false })).showCoachedRecommendation).toBe(
      false,
    );
    expect(
      buildGuidedCoachPresentation(input({ userPlayMoves: [play(5, 5)] })).showCoachedRecommendation,
    ).toBe(false); // no move matches expected 2|2 -> canBestMove false
  });

  it('lessonBoardPlacementMoves is empty when the player is not being coached', () => {
    const p = buildGuidedCoachPresentation(input({ botTurn: true }));
    expect(p.coachingFlags.showPlayerCoaching).toBe(false);
    expect(p.lessonBoardPlacementMoves).toEqual([]);
  });

  it('lessonBoardPlacementMoves mirrors activePlacementMoves while coaching', () => {
    const p = buildGuidedCoachPresentation(input());
    expect(p.lessonBoardPlacementMoves).toEqual(p.activePlacementMoves);
    expect(p.lessonBoardPlacementMoves).toEqual([play(2, 2)]);
  });
});
