// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { validateGuidedMatchLesson } from './guidedMatchValidation';
import type { GuidedMatchLesson } from './guidedMatchTypes';

describe('guidedMatchValidation', () => {
  const createValidLesson = (): GuidedMatchLesson => ({
    version: 1,
    lessonId: 'lesson-1',
    title: 'Intro to Strategy',
    opponent: 'standard-fritz',
    dealSize: 7,
    targetScore: 60,
    rootSeed: 'seed-abc',
    createdAt: '2026-06-28T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
    initialMatchSnapshot: '{"score":0}',
    finalMatchSnapshot: '{"score":0}',
    events: [
      {
        id: 'event-0001-play',
        kind: 'tile-play',
        actor: 'player',
        handNumber: 1,
        turnNumber: 1,
        chainIndex: 0,
        beforeSnapshot: '{"score":0}',
        afterSnapshot: '{"score":0}',
        openCountBefore: 2,
        openCountAfter: 2,
        tileId: '0-0',
        tile: { low: 0, high: 0 },
        legalMoveMetadata: {
          legalMovesBeforeCount: 1,
          playableTileIdsBefore: ['0-0'],
          openTargetsBefore: ['left'],
        },
        pointsScored: 0,
        coaching: {
          title: 'Opening Play',
          body: 'This is a valid coaching description for final mode.',
        },
      } as any,
    ],
  });

  it('1. validates a correct draft lesson successfully', () => {
    const lesson = createValidLesson();
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('2. fails validation if version is invalid', () => {
    const lesson = createValidLesson();
    (lesson as any).version = 2;
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'version')).toBe(true);
  });

  it('3. fails if lessonId is empty', () => {
    const lesson = createValidLesson();
    lesson.lessonId = '   ';
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'lessonId')).toBe(true);
  });

  it('4. fails if title is empty', () => {
    const lesson = createValidLesson();
    lesson.title = '';
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'title')).toBe(true);
  });

  it('5. fails if opponent is not standard-fritz', () => {
    const lesson = createValidLesson();
    lesson.opponent = 'advanced-fritz' as any;
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'opponent')).toBe(true);
  });

  it('6. fails if dealSize is non-positive', () => {
    const lesson = createValidLesson();
    lesson.dealSize = 0;
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'dealSize')).toBe(true);
  });

  it('7. fails if targetScore is not 60', () => {
    const lesson = createValidLesson();
    lesson.targetScore = 100;
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'targetScore')).toBe(true);
  });

  it('8. fails if rootSeed is empty', () => {
    const lesson = createValidLesson();
    lesson.rootSeed = '';
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'rootSeed')).toBe(true);
  });

  it('9. fails if createdAt or updatedAt are not ISO strings', () => {
    const lesson = createValidLesson();
    lesson.createdAt = 'not-a-date';
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'createdAt')).toBe(true);
  });

  it('10. fails if snapshots are unparseable', () => {
    const lesson = createValidLesson();
    lesson.initialMatchSnapshot = 'bad-json';
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'initialMatchSnapshot')).toBe(true);
  });

  it('11. fails if first event beforeSnapshot !== initialMatchSnapshot', () => {
    const lesson = createValidLesson();
    lesson.initialMatchSnapshot = '{"score":10}';
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'events[0].beforeSnapshot')).toBe(true);
  });

  it('12. fails if event ids sequence number is incorrect', () => {
    const lesson = createValidLesson();
    lesson.events[0].id = 'event-0002-play'; // should be event-0001
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'events[0].id')).toBe(true);
  });

  it('13. fails if event ids are not unique', () => {
    const lesson = createValidLesson();
    lesson.events.push({
      ...lesson.events[0],
      id: 'event-0002-play',
    } as any);
    lesson.events[0].id = 'event-0002-play'; // duplicates
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('ids must be unique'))).toBe(true);
  });

  it('14. fails if turnNumber moves backwards', () => {
    const lesson = createValidLesson();
    lesson.events.push({
      ...lesson.events[0],
      id: 'event-0002-play',
      turnNumber: 0, // invalid turn
    } as any);
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'events[1].turnNumber')).toBe(true);
  });

  it('15. fails if handNumber moves backwards', () => {
    const lesson = createValidLesson();
    lesson.events.push({
      ...lesson.events[0],
      id: 'event-0002-play',
      handNumber: 0, // invalid hand
    } as any);
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'events[1].handNumber')).toBe(true);
  });

  it('16. fails if tile low pip > high pip', () => {
    const lesson = createValidLesson();
    (lesson.events[0] as any).tile = { low: 5, high: 3 };
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'events[0].tile')).toBe(true);
  });

  it('17. fails if coaching title or body is missing for player plays', () => {
    const lesson = createValidLesson();
    (lesson.events[0] as any).coaching.title = '';
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'events[0].coaching.title')).toBe(true);
  });

  it('18. validates final mode successfully', () => {
    const lesson = createValidLesson();
    lesson.finalMatchSnapshot = '{"score":60,"gameOver":true}';
    (lesson.events[0] as any).afterSnapshot = '{"score":60,"gameOver":true}';
    const result = validateGuidedMatchLesson(lesson, { mode: 'final' });
    expect(result.ok).toBe(true);
  });

  it('19. final mode fails if coaching title is too short', () => {
    const lesson = createValidLesson();
    lesson.finalMatchSnapshot = '{"score":60,"gameOver":true}';
    (lesson.events[0] as any).afterSnapshot = '{"score":60,"gameOver":true}';
    (lesson.events[0] as any).coaching.title = 'Play'; // 4 chars, < 5
    const result = validateGuidedMatchLesson(lesson, { mode: 'final' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'events[0].coaching.title')).toBe(true);
  });

  it('20. final mode fails if coaching body is too short', () => {
    const lesson = createValidLesson();
    lesson.finalMatchSnapshot = '{"score":60,"gameOver":true}';
    (lesson.events[0] as any).afterSnapshot = '{"score":60,"gameOver":true}';
    (lesson.events[0] as any).coaching.body = 'Short body'; // < 20
    const result = validateGuidedMatchLesson(lesson, { mode: 'final' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'events[0].coaching.body')).toBe(true);
  });

  it('21. final mode fails if title uses placeholder text', () => {
    const lesson = createValidLesson();
    lesson.finalMatchSnapshot = '{"score":60,"gameOver":true}';
    (lesson.events[0] as any).afterSnapshot = '{"score":60,"gameOver":true}';
    (lesson.events[0] as any).coaching.title = 'TODO-123';
    const result = validateGuidedMatchLesson(lesson, { mode: 'final' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('placeholder'))).toBe(true);
  });

  it('22. final mode fails if finalMatchSnapshot gameOver is not true', () => {
    const lesson = createValidLesson();
    const result = validateGuidedMatchLesson(lesson, { mode: 'final' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'finalMatchSnapshot' && i.message.includes('gameOver true'))).toBe(true);
  });

  it('23. warns on pendingPlayerEvent', () => {
    const lesson = createValidLesson();
    const pendingEvent = lesson.events[0] as any;
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft', pendingPlayerEvent: pendingEvent });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'pendingPlayerEvent')).toBe(true);
  });

  it('24. fails if event turn increments but chainIndex is wrong', () => {
    const lesson = createValidLesson();
    lesson.events.push({
      ...lesson.events[0],
      id: 'event-0002-play',
      chainIndex: 2, // should start at 0 since turn changed
      turnNumber: 2,
    } as any);
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'events[1].chainIndex' && i.message.includes('start at chainIndex 0'))).toBe(true);
  });

  it('25. fails if hand-end is not followed by next-hand', () => {
    const lesson = createValidLesson();
    lesson.events[0].kind = 'hand-end';
    lesson.events.push({
      ...lesson.events[0],
      id: 'event-0002-play',
      kind: 'tile-play', // invalid: should be next-hand
    } as any);
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'events[1].kind' && i.message.includes('next-hand event'))).toBe(true);
  });

  it('26. validates hand-end points and leftover pips successfully', () => {
    const lesson = createValidLesson();
    lesson.events[0].kind = 'hand-end';
    (lesson.events[0] as any).pointsAwarded = -5; // invalid
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'events[0].pointsAwarded')).toBe(true);
  });

  it('27. fails if handNumber moves backwards across events', () => {
    const lesson = createValidLesson();
    lesson.events.push({
      ...lesson.events[0],
      id: 'event-0002-play',
      handNumber: 2,
      turnNumber: 1,
    } as any);
    lesson.events.push({
      ...lesson.events[0],
      id: 'event-0003-play',
      handNumber: 1, // backwards!
      turnNumber: 1,
    } as any);
    const result = validateGuidedMatchLesson(lesson, { mode: 'draft' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'events[2].handNumber')).toBe(true);
  });
});
