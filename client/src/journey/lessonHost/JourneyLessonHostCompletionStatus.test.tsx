// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJourneyAuthoredLessonBundle } from '../journeyAuthoredLessonRegistry.ts';
import { normalizeJourneyLessonCompletionStatus, type JourneyLessonCompletionStatus } from '../journeyLessonCompletionStatus.ts';
import { OPEN_END_DISCIPLINE_LESSON_DEFINITION } from '../lessons/openEndDiscipline/openEndDisciplineLesson.ts';
import { JourneyLessonHost } from './JourneyLessonHost.tsx';

/**
 * The shared host must FAIL CLOSED: success is shown only for a status that is exactly "confirmed" or
 * "already_credited". A missing, malformed or thrown-for status is "unverified" — a notice, never success. These run
 * against Open-End Discipline (not Greedy Hands) because the host is shared by every authored lesson.
 */

const SUCCESS = 'Proof challenge passed';
const UNVERIFIED = 'Passed — we couldn’t confirm it was saved';
const PENDING = 'Passed — your progress is still saving';
const REJECTED = 'Passed, but your progress wasn’t saved';
const bundle = getJourneyAuthoredLessonBundle(String(OPEN_END_DISCIPLINE_LESSON_DEFINITION.id))!;

function runtime() {
  let execution = 0;
  let attempt = 0;
  return { now: () => '2026-01-01T00:00:00.000Z', nextSessionId: () => 'session:status', nextExecutionId: () => `execution:${++execution}`, nextAttemptId: () => `attempt:${++attempt}` };
}

/** Plays Open-End Discipline with the intended answer at every decision, until the host shows a result. */
async function playToResult() {
  fireEvent.click(await screen.findByRole('button', { name: /take a seat/i }));
  fireEvent.click(await screen.findByRole('button', { name: /i see the open ends/i }));
  for (let guard = 0; guard < 20; guard += 1) {
    const found = await waitFor(() => {
      const section = document.querySelector('[data-scenario-id]');
      if (section || screen.queryByRole('heading', { name: new RegExp(`${SUCCESS}|couldn’t confirm|still saving|wasn’t saved|Saving your result`) })) return section;
      throw new Error('waiting');
    });
    if (!found) return;
    const scenario = bundle.scenarios[found.getAttribute('data-scenario-id')!];
    const action = scenario.acceptedActions[0];
    fireEvent.click(await screen.findByRole('button', { name: `Domino ${action.tile.low}-${action.tile.high}` }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`play on ${action.position} end`, 'i') }));
    fireEvent.click(screen.getByRole('button', { name: /submit move/i }));
    await screen.findByText('Board consequence');
    fireEvent.click(await screen.findByRole('button', { name: /^(continue|try again|new position)$/i }));
  }
  throw new Error('the lesson did not finish');
}

function mount(onLessonCompleted: () => unknown, onRecheckCompletion?: () => unknown, strict = false) {
  const host = (
    <JourneyLessonHost
      definition={OPEN_END_DISCIPLINE_LESSON_DEFINITION}
      onExit={vi.fn()}
      onReplay={vi.fn()}
      runtime={runtime()}
      // Cast: these tests deliberately violate the type contract to prove the runtime still fails closed.
      onLessonCompleted={onLessonCompleted as () => JourneyLessonCompletionStatus}
      onRecheckCompletion={onRecheckCompletion as (() => JourneyLessonCompletionStatus) | undefined}
    />
  );
  return render(strict ? <StrictMode>{host}</StrictMode> : host);
}
/** Mounts the host and plays the lesson to its result. */
async function run(...args: Parameters<typeof mount>) {
  const rendered = mount(...args);
  await playToResult();
  return rendered;
}
const noSuccess = () => expect(screen.queryByRole('heading', { name: SUCCESS })).toBeNull();

afterEach(() => {
  cleanup();
});

describe('a missing, malformed or thrown status never reads as success', () => {
  it('normalizing: only the exact recognised statuses survive; everything else is "unverified"', () => {
    for (const value of [undefined, null, 'confirmed', true, 1, [], {}, { kind: 'ok' }, { kind: 'CONFIRMED' }, { kind: 'rejected' }, { kind: 'rejected', reason: 'because' }, { status: 'confirmed' }]) {
      expect(normalizeJourneyLessonCompletionStatus(value), JSON.stringify(value)).toEqual({ kind: 'unverified' });
    }
    expect(normalizeJourneyLessonCompletionStatus({ kind: 'confirmed' })).toEqual({ kind: 'confirmed' });
    expect(normalizeJourneyLessonCompletionStatus({ kind: 'already_credited' })).toEqual({ kind: 'already_credited' });
    expect(normalizeJourneyLessonCompletionStatus({ kind: 'pending' })).toEqual({ kind: 'pending' });
    expect(normalizeJourneyLessonCompletionStatus({ kind: 'rejected', reason: 'stage_not_open' })).toEqual({ kind: 'rejected', reason: 'stage_not_open' });
    expect(normalizeJourneyLessonCompletionStatus({ kind: 'confirmed', extra: 1 })).toEqual({ kind: 'confirmed' }); // extras are dropped, not trusted
  });

  it('a callback that returns nothing shows the unverified notice, NOT success (the old fail-open path)', async () => {
    await run(() => undefined);
    const title = await screen.findByRole('heading', { name: UNVERIFIED });
    noSuccess();
    expect(title.closest('section')?.getAttribute('role')).toBe('alert');
    expect(screen.getByRole('button', { name: 'Return to Journey' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replay Lesson' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull(); // no recheck was supplied, so none is offered
    expect(screen.getByText(/couldn’t confirm that your progress was saved/)).toBeTruthy();
  }, 30_000);

  it('a callback that THROWS shows the unverified notice, and does not crash the lesson screen or claim success', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(() => { throw new Error('storage exploded'); });
    await screen.findByRole('heading', { name: UNVERIFIED });
    noSuccess();
    expect(screen.getByRole('button', { name: 'Return to Journey' })).toBeTruthy();
    spy.mockRestore();
  }, 30_000);

  it('a malformed status (null, a string, an unknown kind, a rejection with no reason) shows unverified', async () => {
    for (const bad of [null, 'confirmed', { kind: 'success' }, { kind: 'rejected' }]) {
      await run(() => bad);
      await screen.findByRole('heading', { name: UNVERIFIED });
      noSuccess();
      cleanup();
    }
  }, 60_000);

  it('the same lesson reports completion exactly once even under Strict Mode, and a thrown first report is not retried by the host', async () => {
    const report = vi.fn(() => { throw new Error('nope'); });
    await run(report, undefined, true);
    await screen.findByRole('heading', { name: UNVERIFIED });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(report).toHaveBeenCalledTimes(1);
  }, 30_000);
});

describe('credited statuses still succeed', () => {
  it.each([{ kind: 'confirmed' }, { kind: 'already_credited' }])('%j shows the existing success experience', async (status) => {
    await run(() => status);
    await screen.findByRole('heading', { name: SUCCESS });
    expect(screen.queryByRole('heading', { name: UNVERIFIED })).toBeNull();
    expect(screen.getByRole('button', { name: /return to journey/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /replay lesson/i })).toBeTruthy();
  }, 30_000);
});

describe('pending, rejected and the user-initiated re-check', () => {
  it('pending keeps its message and offers Check again only when a re-check exists; rejected offers Replay', async () => {
    await run(() => ({ kind: 'pending' }), () => ({ kind: 'pending' }));
    await screen.findByRole('heading', { name: PENDING });
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Replay Lesson' })).toBeNull();
    noSuccess();
    cleanup();
    await run(() => ({ kind: 'rejected', reason: 'not_credited' }));
    await screen.findByRole('heading', { name: REJECTED });
    expect(screen.getByRole('button', { name: 'Replay Lesson' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    noSuccess();
  }, 60_000);

  it('a re-check can upgrade unverified to success only by returning a credited status; the completion callback is never called again', async () => {
    const report = vi.fn(() => undefined);
    let answer: unknown = { kind: 'pending' };
    const recheck = vi.fn(() => answer);
    await run(report, recheck);
    await screen.findByRole('heading', { name: UNVERIFIED });
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByRole('heading', { name: PENDING }); // storage says an obligation exists
    answer = { kind: 'confirmed' };
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByRole('heading', { name: SUCCESS });
    expect(report).toHaveBeenCalledTimes(1); // re-checking never re-records
    expect(recheck).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('a re-check that returns nothing, garbage, "unverified" or throws leaves the notice as it was — never success', async () => {
    const answers: Array<() => unknown> = [() => undefined, () => 'confirmed', () => ({ kind: 'unverified' }), () => { throw new Error('boom'); }];
    let next = 0;
    await run(() => ({ kind: 'pending' }), () => answers[next]());
    await screen.findByRole('heading', { name: PENDING });
    for (next = 0; next < answers.length; next += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
      expect(screen.getByRole('heading', { name: PENDING })).toBeTruthy();
      noSuccess();
    }
  }, 30_000);
});

describe('every caller of the shared host is compatible with the contract', () => {
  // The app tsconfig has no node types: load fs/path through non-literal dynamic imports (same idiom as nativeHomeFit.test.ts).
  const fsId = 'node:fs';
  const pathId = 'node:path';

  it('the screen is the ONLY production caller, and it supplies both the status-returning callback and the re-check', async () => {
    const fs = (await import(/* @vite-ignore */ fsId)) as { readdirSync: (dir: string, o: { recursive: true }) => string[]; readFileSync: (f: string, e: 'utf8') => string };
    const path = (await import(/* @vite-ignore */ pathId)) as { join: (...p: string[]) => string };
    const files = fs.readdirSync('src', { recursive: true }).filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file) && !file.endsWith('JourneyLessonHost.tsx'));
    const callers = files.filter((file) => /<JourneyLessonHost\b/.test(fs.readFileSync(path.join('src', file), 'utf8')));
    expect(callers).toEqual(['journey/RacehorseJourneyScreen.tsx']);
    const screenSource = fs.readFileSync('src/journey/RacehorseJourneyScreen.tsx', 'utf8');
    expect(screenSource).toMatch(/onLessonCompleted=\{\(session\) => \{[\s\S]*?return classifyJourneyLessonCompletion\(/);
    expect(screenSource).toMatch(/onRecheckCompletion=\{\(\) => \{/);
    // it serves every authored lesson through ONE definition lookup, so a status is supplied for all of them
    expect(screenSource.match(/<JourneyLessonHost\b/g)).toHaveLength(1);
  });
});
