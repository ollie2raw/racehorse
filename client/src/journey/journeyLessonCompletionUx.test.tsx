// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ tamper: null as null | ((session: unknown) => unknown) }));

// The existing completion boundary, WRAPPED — never replaced: the real `recordJourneyLessonCompletion` still decides.
// A test can hand it a session that is not a genuine completed one and get a genuine refusal back.
vi.mock('./journeyStageCompletion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./journeyStageCompletion')>();
  return {
    ...actual,
    recordJourneyLessonCompletion: (input: Parameters<typeof actual.recordJourneyLessonCompletion>[0]) =>
      actual.recordJourneyLessonCompletion(hooks.tamper ? { ...input, session: hooks.tamper(input.session) as typeof input.session } : input),
  };
});

import { AuthProvider } from '../auth/useAuth';
import { loadJourneyAttempts } from './journeyAttempts';
import { listPendingCompletions } from './journeyPendingCompletions';
import { loadJourneyProgress, markJourneyNodeCompleted } from './journeyStorage';
import RacehorseJourneyScreen from './RacehorseJourneyScreen';
import type { JourneyAuthoredLessonBundle, JourneyAuthoredScenario } from './journeyAuthoredLessonBundle';
import { getJourneyAuthoredLessonBundle } from './journeyAuthoredLessonRegistry';
import { GREEDY_HANDS_BUNDLE } from './lessons/greedyHands/greedyHandsBundle';

/**
 * What the player is told when a lesson run ends — through the REAL screen, host, completion boundary, attempt log,
 * pending-completion records and recovery. Failures are injected at the existing boundary: a refusal by handing the
 * real record function a session that is not a genuine completed one; an unverifiable write by making the real
 * progress write fail at the storage layer (so the real durable obligation and the real recovery are what run).
 */

const NODE = 'ch1-n11';
const BEFORE = ['ch1-n07', 'ch1-n02'];
const SUCCESS = 'Proof challenge passed';
const PENDING = 'Passed — your progress is still saving';
const REJECTED = 'Passed, but your progress wasn’t saved';
const notGenuine = (session: unknown) => ({ ...(session as object), status: 'active', phase: 'presenting', completion: null });

const completedIds = () => loadJourneyProgress().chapters['ch1-fritz-trail']?.completedNodeIds ?? [];
const lessonAttempts = () => loadJourneyAttempts().filter((attempt) => attempt.nodeId === NODE && attempt.kind === 'lesson');
const owed = () => listPendingCompletions().filter(({ record }) => record?.nodeId === NODE);

let realStorage: PropertyDescriptor | undefined;
let dropProgressWrites = false;
function installFlakyProgressWrites() {
  const real = window.localStorage;
  realStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
  const wrapper = {
    get length() { return real.length; },
    key: (index: number) => real.key(index),
    getItem: (key: string) => real.getItem(key),
    removeItem: (key: string) => real.removeItem(key),
    clear: () => real.clear(),
    setItem: (key: string, value: string) => { if (dropProgressWrites && key.startsWith('rh_journey_progress_v1')) return; real.setItem(key, value); },
  } as unknown as Storage;
  Object.defineProperty(window, 'localStorage', { configurable: true, value: wrapper });
}

/** The intended answer of any authored position, read from the lesson's own data (works for every authored lesson). */
const accepted = (scenario: JourneyAuthoredScenario) => {
  const action = scenario.acceptedActions[0];
  return { tile: `${action.tile.low}-${action.tile.high}`, position: action.position };
};

function renderJourney() {
  return render(<RacehorseJourneyScreen onBack={vi.fn()} />, { wrapper: AuthProvider });
}
async function openLesson(label: string, button: RegExp | string, title = 'Greedy Hands') {
  fireEvent.click(await screen.findByLabelText(label));
  fireEvent.click(await screen.findByRole('button', { name: button }));
  await screen.findByRole('heading', { name: title, level: 1 });
}

/** Plays every decision with the intended answer; `beforeStage` lets a test arrange a failure at a chosen point. */
async function playLesson(beforeStage?: (stageId: string) => void, bundle: JourneyAuthoredLessonBundle = GREEDY_HANDS_BUNDLE) {
  fireEvent.click(await screen.findByRole('button', { name: /take a seat/i }));
  for (let step = 0; step < 12; step += 1) { // the walk-through: any number of "Next", then its closing button
    const button = await screen.findByRole('button', { name: /^(next|continue to decision|i see the open ends)$/i });
    const wasNext = /^next$/i.test(button.textContent ?? ''); // read BEFORE clicking: the same node becomes "Continue to Decision"
    fireEvent.click(button);
    if (!wasNext) break;
  }
  for (let guard = 0; guard < 30; guard += 1) {
    const section = await waitFor(() => {
      const found = document.querySelector('[data-scenario-id]');
      if (found || screen.queryByRole('heading', { name: new RegExp(`${SUCCESS}|still saving|wasn’t saved|couldn’t confirm|Saving your result`) })) return found ?? document.body;
      throw new Error('waiting for a position or a result');
    });
    if (!section.getAttribute?.('data-scenario-id')) return;
    const scenario = bundle.scenarios[section.getAttribute('data-scenario-id')!];
    beforeStage?.(section.getAttribute('data-stage-id') ?? '');
    const answer = accepted(scenario);
    fireEvent.click(await screen.findByRole('button', { name: `Domino ${answer.tile}` }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`play on ${answer.position} end`, 'i') }));
    fireEvent.click(screen.getByRole('button', { name: /submit move/i }));
    await screen.findByText('Board consequence');
    fireEvent.click(await screen.findByRole('button', { name: /^(continue|try again|new position)$/i }));
  }
  throw new Error('the lesson did not finish');
}

const heading = (name: string) => screen.findByRole('heading', { name });
const noSuccessClaim = () => expect(screen.queryByRole('heading', { name: SUCCESS })).toBeNull();

beforeEach(() => {
  window.localStorage.clear();
  hooks.tamper = null;
  dropProgressWrites = false;
  installFlakyProgressWrites();
  BEFORE.forEach((id) => markJourneyNodeCompleted(id));
});
afterEach(() => {
  cleanup();
  if (realStorage) Object.defineProperty(window, 'localStorage', realStorage);
  else delete (window as unknown as Record<string, unknown>).localStorage;
  vi.restoreAllMocks();
});

describe('confirmed completion', () => {
  it('shows the success experience only after the stage reads back as credited, then unlocks the next stage', async () => {
    renderJourney();
    await openLesson('Greedy Hands, Current', 'Play');
    await playLesson();
    await heading(SUCCESS);
    expect(screen.queryByText(PENDING)).toBeNull();
    expect(screen.queryByText(REJECTED)).toBeNull();
    expect(completedIds()).toEqual([...BEFORE, NODE]);
    expect(owed()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /return to journey/i }));
    expect(await screen.findByLabelText('Greedy Hands, Completed')).toBeTruthy();
    expect(await screen.findByLabelText('Count the Yard, Current')).toBeTruthy();
    expect(lessonAttempts().map((attempt) => attempt.outcome)).toEqual(['won']);
  }, 60_000);
});

describe('definitive rejection', () => {
  it('does not claim success, unlock anything, or credit the stage; says what happened; offers a safe next step', async () => {
    hooks.tamper = notGenuine;
    renderJourney();
    await openLesson('Greedy Hands, Current', 'Play');
    await playLesson();
    const title = await heading(REJECTED);
    noSuccessClaim();
    expect(title.closest('section')?.getAttribute('role')).toBe('alert'); // announced assertively to assistive tech
    expect(screen.getByText(/couldn’t save it to your Journey, so the next stage hasn’t unlocked/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replay Lesson' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Return to Journey' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull(); // nothing is owed, so there is nothing to re-check
    expect(completedIds()).toEqual(BEFORE);
    expect(owed()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Return to Journey' }));
    expect(await screen.findByLabelText('Greedy Hands, Current')).toBeTruthy(); // not credited
    expect(await screen.findByLabelText('Count the Yard, Locked')).toBeTruthy(); // not unlocked
    expect(completedIds()).toEqual(BEFORE);
    expect(lessonAttempts().map((attempt) => attempt.outcome)).toEqual(['abandoned']);
  }, 60_000);

  it('Replay Lesson from the notice starts a NEW attempt and session, and a genuine run is then credited exactly once', async () => {
    hooks.tamper = notGenuine;
    renderJourney();
    await openLesson('Greedy Hands, Current', 'Play');
    await playLesson();
    await heading(REJECTED);
    hooks.tamper = null;
    fireEvent.click(screen.getByRole('button', { name: 'Replay Lesson' }));
    await playLesson();
    await heading(SUCCESS);
    expect(completedIds()).toEqual([...BEFORE, NODE]);
    const outcomes = lessonAttempts().map((attempt) => attempt.outcome).sort();
    expect(outcomes).toEqual(['abandoned', 'won']); // the refused run was never credited and never became a win
    expect(lessonAttempts()).toHaveLength(2);
  }, 90_000);

  it('a stage that is not open reports that, instead of the generic message, and still credits nothing', async () => {
    window.localStorage.clear();
    markJourneyNodeCompleted('ch1-n07'); // Dot's Table is NOT complete, so Greedy Hands is locked
    renderJourney();
    // the real screen will not start a locked stage, so exercise the classifier on the real store instead
    const { classifyJourneyLessonCompletion } = await import('./journeyLessonCompletionStatus');
    expect(classifyJourneyLessonCompletion({ attemptId: null, nodeId: NODE, result: { recorded: true, completedNode: false } })).toEqual({ kind: 'rejected', reason: 'stage_not_open' });
    expect(completedIds()).toEqual(['ch1-n07']);
  });
});

describe('pending (uncertain) completion', () => {
  async function reachPending() {
    renderJourney();
    await openLesson('Greedy Hands, Current', 'Play');
    await playLesson((stage) => { if (stage === 'proof') dropProgressWrites = true; }); // the progress write fails at the boundary
    await heading(PENDING);
  }

  it('says it is saving (not rejected, not passed-and-done), keeps the durable obligation, and credits nothing yet', async () => {
    await reachPending();
    noSuccessClaim();
    expect(screen.queryByText(REJECTED)).toBeNull();
    expect(screen.getByText('Passed — your progress is still saving').closest('section')?.getAttribute('role')).toBe('status');
    expect(screen.getByText(/kept on this device and will be finished the next time you open the Journey/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Replay Lesson' })).toBeNull(); // a replay is not the way to finish a pending save
    expect(completedIds()).toEqual(BEFORE);
    expect(owed()).toHaveLength(1);
    expect(lessonAttempts().map((attempt) => attempt.outcome)).toEqual(['won']);
  }, 60_000);

  it('"Check again" while the write still fails stays pending and never duplicates, re-records or clears anything', async () => {
    await reachPending();
    const before = JSON.stringify(lessonAttempts());
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
      await heading(PENDING);
    }
    expect(lessonAttempts()).toHaveLength(1);
    expect(JSON.stringify(lessonAttempts())).toBe(before);
    expect(owed()).toHaveLength(1);
    expect(completedIds()).toEqual(BEFORE);
    noSuccessClaim();
  }, 60_000);

  it('recovers after the write starts working: "Check again" finishes the SAME obligation, once, and only then shows success', async () => {
    await reachPending();
    dropProgressWrites = false;
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await heading(SUCCESS);
    expect(completedIds()).toEqual([...BEFORE, NODE]);
    expect(owed()).toEqual([]);
    expect(lessonAttempts().map((attempt) => attempt.outcome)).toEqual(['won']); // no second completion was created
    fireEvent.click(screen.getByRole('button', { name: /return to journey/i }));
    expect(await screen.findByLabelText('Greedy Hands, Completed')).toBeTruthy();
    expect(await screen.findByLabelText('Count the Yard, Current')).toBeTruthy();
  }, 60_000);
});

describe('leaving and returning', () => {
  it('leaving a pending notice keeps the obligation and the trail shows nothing unlocked; the next Journey load finishes it', async () => {
    renderJourney();
    await openLesson('Greedy Hands, Current', 'Play');
    await playLesson((stage) => { if (stage === 'proof') dropProgressWrites = true; });
    await heading(PENDING);
    fireEvent.click(screen.getByRole('button', { name: 'Return to Journey' }));
    expect(await screen.findByLabelText('Greedy Hands, Current')).toBeTruthy();
    expect(await screen.findByLabelText('Count the Yard, Locked')).toBeTruthy();
    expect(owed()).toHaveLength(1); // dismissing the message did not clear the obligation
    expect(lessonAttempts()).toHaveLength(1);

    dropProgressWrites = false;
    cleanup(); // the page is reloaded
    renderJourney();
    expect(await screen.findByLabelText('Greedy Hands, Completed')).toBeTruthy();
    expect(await screen.findByLabelText('Count the Yard, Current')).toBeTruthy();
    expect(owed()).toEqual([]);
    expect(completedIds()).toEqual([...BEFORE, NODE]);
    expect(lessonAttempts().map((attempt) => attempt.outcome)).toEqual(['won']);
  }, 60_000);

  it('if the write recovers before the player leaves, leaving itself lets the recovery credit the stage', async () => {
    renderJourney();
    await openLesson('Greedy Hands, Current', 'Play');
    await playLesson((stage) => { if (stage === 'proof') dropProgressWrites = true; });
    await heading(PENDING);
    dropProgressWrites = false;
    fireEvent.click(screen.getByRole('button', { name: 'Return to Journey' }));
    expect(await screen.findByLabelText('Greedy Hands, Completed')).toBeTruthy();
    expect(owed()).toEqual([]);
    expect(lessonAttempts()).toHaveLength(1);
  }, 60_000);
});

describe('replay of an already-completed stage', () => {
  it('shows success, leaves the existing completion untouched, and creates no obligation', async () => {
    markJourneyNodeCompleted(NODE);
    renderJourney();
    await openLesson('Greedy Hands, Completed', /replay lesson/i);
    await playLesson();
    await heading(SUCCESS);
    expect(completedIds()).toEqual([...BEFORE, NODE]); // exactly once
    expect(owed()).toEqual([]);
    expect(within(document.body).queryByText(REJECTED)).toBeNull();
  }, 60_000);

  it('does not report a false failure when the replay itself is refused but the stage is already credited', async () => {
    markJourneyNodeCompleted(NODE);
    hooks.tamper = notGenuine;
    renderJourney();
    await openLesson('Greedy Hands, Completed', /replay lesson/i);
    await playLesson();
    await heading(SUCCESS); // the stage IS credited, so this is not a failure the player needs to act on
    expect(screen.queryByText(REJECTED)).toBeNull();
    expect(completedIds()).toEqual([...BEFORE, NODE]);
    expect(owed()).toEqual([]);
  }, 60_000);
});

describe('fail-closed through the real screen, for a lesson other than Greedy Hands (Open-End Discipline)', () => {
  const OPEN_END = getJourneyAuthoredLessonBundle('journey:ch1:open-end-discipline')!;
  const playOpenEnd = () => playLesson(undefined, OPEN_END);
  const startOpenEnd = async () => {
    window.localStorage.removeItem('rh_journey_progress_v1'); // Read the Gate is the first stage: nothing completed
    renderJourney();
    await openLesson('Read the Gate, Current', 'Play', OPEN_END.presentation.lessonTitle);
  };

  it('a genuine run is confirmed: success, then the stage reads as completed on the trail', async () => {
    await startOpenEnd();
    await playOpenEnd();
    await heading(SUCCESS);
    fireEvent.click(screen.getByRole('button', { name: /return to journey/i }));
    expect(await screen.findByLabelText('Read the Gate, Completed')).toBeTruthy();
  }, 90_000);

  it('a refused completion is a rejected notice, never success, and the stage stays uncredited', async () => {
    hooks.tamper = notGenuine;
    await startOpenEnd();
    await playOpenEnd();
    await heading(REJECTED);
    noSuccessClaim();
    expect(completedIds()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Return to Journey' }));
    expect(await screen.findByLabelText('Read the Gate, Current')).toBeTruthy();
  }, 90_000);

  it('a record call that THROWS is "unverified" (never success); Check again reads real storage and reports the truth: nothing was saved', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    hooks.tamper = () => { throw new Error('the storage layer blew up'); };
    await startOpenEnd();
    await playOpenEnd();
    await heading('Passed — we couldn’t confirm it was saved');
    noSuccessClaim();
    expect(completedIds()).toEqual([]);
    expect(owed()).toEqual([]); // no obligation was fabricated
    hooks.tamper = null;
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await heading(REJECTED); // storage shows nothing credited and nothing owed: definitive, and replay is offered
    noSuccessClaim();
    expect(completedIds()).toEqual([]);
    expect(loadJourneyAttempts().filter((attempt) => attempt.kind === 'lesson')).toHaveLength(1); // no second attempt
    spy.mockRestore();
  }, 90_000);
});
