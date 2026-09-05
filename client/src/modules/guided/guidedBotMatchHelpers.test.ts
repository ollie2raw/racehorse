import { describe, it, expect, vi } from 'vitest';
import {
  splitCoachingSummaryBlock,
  buildCoachPreviewText,
  parseGuidedLessonCoachContent,
  syncGuidedBoneyardCount,
  sameTileKeyMultiset,
  guidedWinnerIdFromScores,
  formatLessonTileLabel,
  getGuidedV1AuthoredStepByIndex,
  getGuidedV1OrderedAuthoredSteps,
  getNextGuidedV1StepIndex,
  restoreGuidedV1NextFullMatchState,
  restoreGuidedV1StepMatchState,
  parseGuidedTranscriptState,
  notifyGuidedV2EventToasts,
} from './guidedBotMatchHelpers.ts';
import type { Tile } from '../../types.ts';
import { makeAuthoredStep, makeFrozenLesson, makeLessonV2Event } from './guidedTestFixtures.ts';

describe('splitCoachingSummaryBlock', () => {
  it('returns { summary: null, body: raw } when there is no @summary block', () => {
    expect(splitCoachingSummaryBlock('Just some coaching text.')).toEqual({
      summary: null,
      body: 'Just some coaching text.',
    });
  });

  it('extracts the summary text from a leading @summary … --- block', () => {
    const raw = '@summary\nBlock the sixes early.\n---\nThe long body explanation follows here.';
    expect(splitCoachingSummaryBlock(raw).summary).toBe('Block the sixes early.');
  });

  it('NOTE(latent): body is dropped to "" whenever a @summary block matches — the regex has no capture group for the remainder, so match[2] is undefined', () => {
    const raw = '@summary\nBlock the sixes.\n---\nThis body text is silently discarded.';
    expect(splitCoachingSummaryBlock(raw).body).toBe('');
  });

  it('an empty summary line collapses to null (match[1] === "" -> "" || null)', () => {
    const raw = '@summary\n\n---\nbody';
    expect(splitCoachingSummaryBlock(raw).summary).toBeNull();
  });
});

describe('buildCoachPreviewText', () => {
  it('returns the trimmed summary when one is supplied, ignoring the body', () => {
    expect(buildCoachPreviewText('a much longer body that should be ignored', '  Short summary  ')).toBe(
      'Short summary',
    );
  });

  it('collapses newlines and returns the body as-is when under the 600-char cap', () => {
    expect(buildCoachPreviewText('line one\n\nline two', null)).toBe('line one line two');
  });

  it('cuts at the last word boundary past the 65% mark and appends an ellipsis', () => {
    // 595 "a"s, a space, then a long run — the space at index 595 sits past 0.65 * 600 = 390.
    const body = `${'a'.repeat(595)} ${'b'.repeat(50)}`;
    const preview = buildCoachPreviewText(body, null);
    expect(preview).toBe(`${'a'.repeat(595)}…`);
  });

  it('hard-cuts mid-token when the last space in the first 600 chars is before the 65% mark', () => {
    // one space at index 100, then 600 more non-space chars → lastSpace (100) <= 390 → no word cut.
    const body = `${'a'.repeat(100)} ${'b'.repeat(600)}`;
    const preview = buildCoachPreviewText(body, null);
    expect(preview).toBe(`${'a'.repeat(100)} ${'b'.repeat(499)}…`);
    expect(preview).toHaveLength(601); // 600 sliced chars + ellipsis
  });
});

describe('parseGuidedLessonCoachContent', () => {
  it('returns the "Your decision" fallback for empty coaching text', () => {
    expect(parseGuidedLessonCoachContent('')).toEqual({
      title: 'Your decision',
      bodyParagraphs: ['Study the board, compare your options, and follow the coached line.'],
      summary: null,
    });
  });

  it('uses a short first line as the title and the rest as the body', () => {
    const result = parseGuidedLessonCoachContent('Block the sixes\n\nFritz is holding heavy tiles.');
    expect(result.title).toBe('Block the sixes');
    expect(result.bodyParagraphs).toEqual(['Fritz is holding heavy tiles.']);
  });

  it('does NOT use the first line as a title when it exceeds 72 chars', () => {
    const longFirst = 'x'.repeat(80);
    const result = parseGuidedLessonCoachContent(`${longFirst}\n\nmore`);
    expect(result.title).toBe('Your decision');
    expect(result.bodyParagraphs).toEqual([longFirst, 'more']);
  });

  it('does NOT use a "play:"-prefixed first line as a title (case-insensitive)', () => {
    const result = parseGuidedLessonCoachContent('Play: 6|6 on the left\n\nrationale');
    expect(result.title).toBe('Your decision');
    expect(result.bodyParagraphs[0]).toBe('Play: 6|6 on the left');
  });

  it('splits the body on blank lines into paragraphs, flattening single newlines', () => {
    const result = parseGuidedLessonCoachContent('Title line\n\nPara one\nwrapped.\n\nPara two.');
    expect(result.bodyParagraphs).toEqual(['Para one wrapped.', 'Para two.']);
  });

  it('takes the summary from an inline @summary block (body then falls back — see splitCoachingSummaryBlock latent note)', () => {
    const result = parseGuidedLessonCoachContent('@summary\nKeep the 6-6 back.\n---\nlong body here');
    expect(result.summary).toBe('Keep the 6-6 back.');
    expect(result.bodyParagraphs).toEqual([
      'Study the board, compare your options, and follow the coached line.',
    ]);
  });

  it('prefers the explicit summary arg over an inline @summary block', () => {
    const result = parseGuidedLessonCoachContent('@summary\nInline\n---\n', 'Explicit summary');
    expect(result.summary).toBe('Explicit summary');
  });

  it('keeps a normal body while attaching the explicit summary arg', () => {
    const result = parseGuidedLessonCoachContent('Push wide\n\nopen both ends', '  My summary  ');
    expect(result).toEqual({
      title: 'Push wide',
      bodyParagraphs: ['open both ends'],
      summary: 'My summary',
    });
  });
});

describe('syncGuidedBoneyardCount', () => {
  const t = (n: number): Tile => ({ low: n, high: n });

  it('returns the same array reference when the count already matches', () => {
    const current = [t(1), t(2), t(3)];
    expect(syncGuidedBoneyardCount(current, 3)).toBe(current);
  });

  it('trims to a prefix slice when the current array is too long', () => {
    const current = [t(1), t(2), t(3), t(4)];
    expect(syncGuidedBoneyardCount(current, 2)).toEqual([t(1), t(2)]);
  });

  it('pads with {0,0} placeholders when the current array is too short', () => {
    expect(syncGuidedBoneyardCount([t(1)], 3)).toEqual([t(1), { low: 0, high: 0 }, { low: 0, high: 0 }]);
  });
});

describe('sameTileKeyMultiset', () => {
  it('true for the same keys in a different order', () => {
    expect(sameTileKeyMultiset(['1|1', '2|3', '1|1'], ['1|1', '1|1', '2|3'])).toBe(true);
  });

  it('false on a length mismatch', () => {
    expect(sameTileKeyMultiset(['1|1'], ['1|1', '2|3'])).toBe(false);
  });

  it('false when b contains a key absent from a', () => {
    expect(sameTileKeyMultiset(['1|1', '2|3'], ['1|1', '4|5'])).toBe(false);
  });

  it('false when duplicate counts differ (same length, same key set)', () => {
    expect(sameTileKeyMultiset(['1|1', '1|1', '2|3'], ['1|1', '2|3', '2|3'])).toBe(false);
  });

  it('true for two empty lists', () => {
    expect(sameTileKeyMultiset([], [])).toBe(true);
  });
});

describe('guidedWinnerIdFromScores', () => {
  it('"you" when the player is strictly ahead or exactly level', () => {
    expect(guidedWinnerIdFromScores(60, 42)).toBe('you');
    expect(guidedWinnerIdFromScores(50, 50)).toBe('you');
  });

  it('"bot" when fritz is ahead', () => {
    expect(guidedWinnerIdFromScores(41, 60)).toBe('bot');
  });
});

describe('formatLessonTileLabel', () => {
  it('null / empty / undefined -> null', () => {
    expect(formatLessonTileLabel(null)).toBeNull();
    expect(formatLessonTileLabel('')).toBeNull();
    expect(formatLessonTileLabel(undefined)).toBeNull();
  });

  it('replaces the pipe with a hyphen', () => {
    expect(formatLessonTileLabel('3|4')).toBe('3-4');
  });
});

describe('getGuidedV1AuthoredStepByIndex', () => {
  const lesson = makeFrozenLesson({
    steps: [
      makeAuthoredStep({ stepIndex: 0, chosenMove: '0|0:left' }),
      makeAuthoredStep({ stepIndex: 1, chosenMove: null }), // note-only draft
      makeAuthoredStep({ stepIndex: 2, chosenMove: '3|4:right' }),
    ],
  });

  it('returns null for a negative index', () => {
    expect(getGuidedV1AuthoredStepByIndex(lesson, -1)).toBeNull();
  });

  it('returns the real step whose stepIndex matches', () => {
    expect(getGuidedV1AuthoredStepByIndex(lesson, 2)?.chosenMove).toBe('3|4:right');
  });

  it('returns null when the matching step is a note-only draft (chosenMove null)', () => {
    expect(getGuidedV1AuthoredStepByIndex(lesson, 1)).toBeNull();
  });

  it('returns null when no step has that index', () => {
    expect(getGuidedV1AuthoredStepByIndex(lesson, 9)).toBeNull();
  });
});

describe('getGuidedV1OrderedAuthoredSteps', () => {
  it('drops note-only drafts and sorts the rest by stepIndex ascending', () => {
    const lesson = makeFrozenLesson({
      steps: [
        makeAuthoredStep({ stepIndex: 4, chosenMove: '4|4:left' }),
        makeAuthoredStep({ stepIndex: 1, chosenMove: null }),
        makeAuthoredStep({ stepIndex: 0, chosenMove: '0|0:left' }),
        makeAuthoredStep({ stepIndex: 2, chosenMove: '2|2:right' }),
      ],
    });
    expect(getGuidedV1OrderedAuthoredSteps(lesson).map((s) => s.stepIndex)).toEqual([0, 2, 4]);
  });
});

describe('getNextGuidedV1StepIndex', () => {
  const lesson = makeFrozenLesson({
    steps: [
      makeAuthoredStep({ stepIndex: 0, chosenMove: '0|0:left' }),
      makeAuthoredStep({ stepIndex: 3, chosenMove: '3|3:left' }),
      makeAuthoredStep({ stepIndex: 5, chosenMove: '5|5:left' }),
    ],
  });

  it('returns the next authored stepIndex greater than the current one', () => {
    expect(getNextGuidedV1StepIndex(lesson, 0)).toBe(3);
    expect(getNextGuidedV1StepIndex(lesson, 3)).toBe(5);
  });

  it('returns null when there is no later authored step', () => {
    expect(getNextGuidedV1StepIndex(lesson, 5)).toBeNull();
  });
});

describe('restoreGuidedV1NextFullMatchState', () => {
  it('skips authored steps without a restorable snapshot and returns the next one that has one', () => {
    const lesson = makeFrozenLesson({
      steps: [
        makeAuthoredStep({ stepIndex: 0, chosenMove: '0|0:left', matchStateJson: null }),
        makeAuthoredStep({ stepIndex: 1, chosenMove: '1|2:right', matchStateJson: null }),
        makeAuthoredStep({
          stepIndex: 2,
          chosenMove: '3|4:left',
          matchStateJson: JSON.stringify({ handNumber: 2 }),
        }),
      ],
    });
    expect(restoreGuidedV1NextFullMatchState(lesson, -1)).toEqual({
      nextStepIndex: 2,
      nextState: { handNumber: 2 },
    });
  });

  it('returns { nextStepIndex: null, nextState: null } when nothing ahead is restorable', () => {
    const lesson = makeFrozenLesson({
      steps: [
        makeAuthoredStep({ stepIndex: 0, chosenMove: '0|0:left', matchStateJson: null }),
        makeAuthoredStep({ stepIndex: 1, chosenMove: '1|2:right', matchStateJson: null }),
      ],
    });
    expect(restoreGuidedV1NextFullMatchState(lesson, 0)).toEqual({
      nextStepIndex: null,
      nextState: null,
    });
  });
});

describe('restoreGuidedV1StepMatchState', () => {
  it('returns null for a null step or a step with no matchStateJson', () => {
    expect(restoreGuidedV1StepMatchState(null)).toBeNull();
    expect(restoreGuidedV1StepMatchState(makeAuthoredStep({ matchStateJson: null }))).toBeNull();
  });

  it('parses valid JSON', () => {
    const step = makeAuthoredStep({ matchStateJson: JSON.stringify({ handNumber: 5 }) });
    expect(restoreGuidedV1StepMatchState(step)).toEqual({ handNumber: 5 });
  });

  it('returns null on malformed JSON', () => {
    expect(restoreGuidedV1StepMatchState(makeAuthoredStep({ matchStateJson: '{not json' }))).toBeNull();
  });
});

describe('parseGuidedTranscriptState', () => {
  it('returns null for an empty string', () => {
    expect(parseGuidedTranscriptState('')).toBeNull();
  });

  it('parses valid JSON', () => {
    expect(parseGuidedTranscriptState('{"handNumber":3}')).toEqual({ handNumber: 3 });
  });

  it('returns null on garbage', () => {
    expect(parseGuidedTranscriptState('not json')).toBeNull();
  });
});

describe('notifyGuidedV2EventToasts', () => {
  const makeCallbacks = () => ({
    showScoreToast: vi.fn(),
    showBoardToast: vi.fn(),
  });

  it('fires a score toast for the player when points were scored on a play', () => {
    const cb = makeCallbacks();
    notifyGuidedV2EventToasts(
      makeLessonV2Event({ actor: 'player', action: 'play', pointsScored: 10 }),
      'Fritz',
      cb,
    );
    expect(cb.showScoreToast).toHaveBeenCalledWith('you', 10);
    expect(cb.showBoardToast).not.toHaveBeenCalled();
  });

  it('fires a score toast for the bot ("bot") when fritz scored', () => {
    const cb = makeCallbacks();
    notifyGuidedV2EventToasts(
      makeLessonV2Event({ actor: 'fritz', action: 'play', pointsScored: 6 }),
      'Fritz',
      cb,
    );
    expect(cb.showScoreToast).toHaveBeenCalledWith('bot', 6);
  });

  it('draw by the player -> "You drew a tile" board toast, tone "bot"', () => {
    const cb = makeCallbacks();
    notifyGuidedV2EventToasts(
      makeLessonV2Event({ actor: 'player', action: 'draw', tile: undefined, pointsScored: 0 }),
      'Fritz',
      cb,
    );
    expect(cb.showBoardToast).toHaveBeenCalledWith('You drew a tile', 'bot');
  });

  it('draw by fritz uses the opponentLabel', () => {
    const cb = makeCallbacks();
    notifyGuidedV2EventToasts(
      makeLessonV2Event({ actor: 'fritz', action: 'draw', tile: undefined, pointsScored: 0 }),
      'Fritz',
      cb,
    );
    expect(cb.showBoardToast).toHaveBeenCalledWith('Fritz drew a tile', 'bot');
  });

  it('pass by the player -> "You passed", tone "you"', () => {
    const cb = makeCallbacks();
    notifyGuidedV2EventToasts(
      makeLessonV2Event({ actor: 'player', action: 'pass', tile: undefined, pointsScored: 0 }),
      'Fritz',
      cb,
    );
    expect(cb.showBoardToast).toHaveBeenCalledWith('You passed', 'you');
  });

  it('pass by fritz -> "<opponentLabel> passed", tone "bot"', () => {
    const cb = makeCallbacks();
    notifyGuidedV2EventToasts(
      makeLessonV2Event({ actor: 'fritz', action: 'pass', tile: undefined, pointsScored: 0 }),
      'Fritz',
      cb,
    );
    expect(cb.showBoardToast).toHaveBeenCalledWith('Fritz passed', 'bot');
  });

  it('a scoreless play fires neither callback', () => {
    const cb = makeCallbacks();
    notifyGuidedV2EventToasts(
      makeLessonV2Event({ actor: 'player', action: 'play', pointsScored: 0 }),
      'Fritz',
      cb,
    );
    expect(cb.showScoreToast).not.toHaveBeenCalled();
    expect(cb.showBoardToast).not.toHaveBeenCalled();
  });
});
