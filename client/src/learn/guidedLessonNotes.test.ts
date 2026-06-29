import { describe, it, expect } from 'vitest';
import { GUIDED_LESSON_COACHING_BY_VISIBLE_STEP, applyGuidedLessonCoachingText } from './guidedLessonNotes';

describe('guidedLessonNotes', () => {
  it('1. contains an array of coaching notes', () => {
    expect(Array.isArray(GUIDED_LESSON_COACHING_BY_VISIBLE_STEP)).toBe(true);
    expect(GUIDED_LESSON_COACHING_BY_VISIBLE_STEP.length).toBeGreaterThan(0);
  });

  it('2. all coaching notes are strings', () => {
    GUIDED_LESSON_COACHING_BY_VISIBLE_STEP.forEach((note) => {
      expect(typeof note).toBe('string');
      expect(note.length).toBeGreaterThan(0);
    });
  });

  it('3. first note describes the opening play', () => {
    const firstNote = GUIDED_LESSON_COACHING_BY_VISIBLE_STEP[0];
    expect(firstNote).toContain('1-1');
  });

  it('4. returns unmodified lesson if lesson is null', () => {
    expect(applyGuidedLessonCoachingText(null as any)).toBeNull();
  });

  it('5. returns unmodified lesson if lesson is undefined', () => {
    expect(applyGuidedLessonCoachingText(undefined as any)).toBeUndefined();
  });

  it('6. returns unmodified lesson if events field is missing', () => {
    const lesson = { name: 'lesson' };
    expect(applyGuidedLessonCoachingText(lesson as any)).toEqual(lesson);
  });

  it('7. applies coaching text to first player play event', () => {
    const lesson = {
      events: [
        { actor: 'player', action: 'play', tile: '1|1' },
      ],
    };
    const result = applyGuidedLessonCoachingText(lesson as any) as any;
    expect(result.events[0].coachingText).toBe(GUIDED_LESSON_COACHING_BY_VISIBLE_STEP[0]);
  });

  it('8. increments visibleCoachStep only on player play events', () => {
    const lesson = {
      events: [
        { actor: 'bot', action: 'play', tile: '6|6' }, // index 0 skipped
        { actor: 'player', action: 'play', tile: '1|1' }, // gets index 0
        { actor: 'player', action: 'draw' }, // skipped
        { actor: 'player', action: 'play', tile: '1|6' }, // gets index 1
      ],
    };
    const result = applyGuidedLessonCoachingText(lesson as any) as any;
    expect(result.events[0].coachingText).toBeUndefined();
    expect(result.events[1].coachingText).toBe(GUIDED_LESSON_COACHING_BY_VISIBLE_STEP[0]);
    expect(result.events[2].coachingText).toBeUndefined();
    expect(result.events[3].coachingText).toBe(GUIDED_LESSON_COACHING_BY_VISIBLE_STEP[1]);
  });

  it('9. does not overwrite existing coachingText on events', () => {
    const lesson = {
      events: [
        { actor: 'player', action: 'play', tile: '1|1', coachingText: 'already set' },
        { actor: 'player', action: 'play', tile: '1|6' },
      ],
    };
    const result = applyGuidedLessonCoachingText(lesson as any) as any;
    expect(result.events[0].coachingText).toBe('already set');
    // Note index is still incremented, so the next player play receives index 1
    expect(result.events[1].coachingText).toBe(GUIDED_LESSON_COACHING_BY_VISIBLE_STEP[1]);
  });

  it('10. handles empty spaces in existing coachingText as empty and overwrites', () => {
    const lesson = {
      events: [
        { actor: 'player', action: 'play', tile: '1|1', coachingText: '   ' },
      ],
    };
    const result = applyGuidedLessonCoachingText(lesson as any) as any;
    expect(result.events[0].coachingText).toBe(GUIDED_LESSON_COACHING_BY_VISIBLE_STEP[0]);
  });

  it('11. does not apply notes beyond array bounds', () => {
    // Generate events exceeding GUIDED_LESSON_COACHING_BY_VISIBLE_STEP length
    const count = GUIDED_LESSON_COACHING_BY_VISIBLE_STEP.length + 5;
    const events = Array.from({ length: count }, () => ({
      actor: 'player',
      action: 'play',
      tile: '1|1',
    }));
    const result = applyGuidedLessonCoachingText({ events } as any) as any;
    // last 5 should be undefined or unchanged
    for (let i = GUIDED_LESSON_COACHING_BY_VISIBLE_STEP.length; i < count; i++) {
      expect(result.events[i].coachingText).toBeUndefined();
    }
  });

  it('12. ignores player passes', () => {
    const lesson = {
      events: [
        { actor: 'player', action: 'pass' },
      ],
    };
    const result = applyGuidedLessonCoachingText(lesson as any) as any;
    expect(result.events[0].coachingText).toBeUndefined();
  });

  it('13. ignores player draws', () => {
    const lesson = {
      events: [
        { actor: 'player', action: 'draw' },
      ],
    };
    const result = applyGuidedLessonCoachingText(lesson as any) as any;
    expect(result.events[0].coachingText).toBeUndefined();
  });

  it('14. ignores bot plays', () => {
    const lesson = {
      events: [
        { actor: 'bot', action: 'play', tile: '3|3' },
      ],
    };
    const result = applyGuidedLessonCoachingText(lesson as any) as any;
    expect(result.events[0].coachingText).toBeUndefined();
  });

  it('15. ignores bot passes', () => {
    const lesson = {
      events: [
        { actor: 'bot', action: 'pass' },
      ],
    };
    const result = applyGuidedLessonCoachingText(lesson as any) as any;
    expect(result.events[0].coachingText).toBeUndefined();
  });

  it('16. handles empty events list', () => {
    const result = applyGuidedLessonCoachingText({ events: [] } as any) as any;
    expect(result.events).toEqual([]);
  });

  it('17. copies other non-relevant fields in events list without change', () => {
    const lesson = {
      events: [
        { actor: 'player', action: 'play', tile: '1|1', customField: 'hello' },
      ],
    };
    const result = applyGuidedLessonCoachingText(lesson as any) as any;
    expect(result.events[0].customField).toBe('hello');
  });

  it('18. preserves immutable structure (returns new object)', () => {
    const lesson = {
      events: [
        { actor: 'player', action: 'play', tile: '1|1' },
      ],
    };
    const result = applyGuidedLessonCoachingText(lesson as any) as any;
    expect(result).not.toBe(lesson);
    expect(result.events).not.toBe(lesson.events);
  });

  it('19. verify index 6 coaching note content', () => {
    const note = GUIDED_LESSON_COACHING_BY_VISIBLE_STEP[2]; // corresponding to note index 2 (RAW_NOTES_FROM_MARKDOWN[6])
    expect(note).toContain('We have a couple of scoring choices here.');
  });

  it('20. verify index 7 coaching note content', () => {
    const note = GUIDED_LESSON_COACHING_BY_VISIBLE_STEP[3]; // RAW_NOTES_FROM_MARKDOWN[7]
    expect(note).toContain('Now the setup from the previous move pays off.');
  });
});
