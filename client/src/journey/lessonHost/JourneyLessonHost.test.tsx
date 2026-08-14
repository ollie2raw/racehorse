// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OPEN_END_DISCIPLINE_LESSON_DEFINITION } from '../lessons/openEndDiscipline/openEndDisciplineLesson.ts';
import { JourneyLessonHost } from './JourneyLessonHost.tsx';

function deterministicRuntime() {
  let execution = 0;
  let attempt = 0;
  return {
    now: () => '2026-01-01T00:00:00.000Z',
    nextSessionId: () => 'session:test',
    nextExecutionId: () => `execution:${++execution}`,
    nextAttemptId: () => `attempt:${++attempt}`,
  };
}

async function enterGuidedStage() {
  fireEvent.click(await screen.findByRole('button', { name: /take a seat/i }));
  fireEvent.click(await screen.findByRole('button', { name: /i see the open ends/i }));
  await screen.findByRole('button', { name: 'Domino 1-4' });
}

async function play(tile: string, end: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name: tile }));
  fireEvent.click(screen.getByRole('button', { name: end }));
  fireEvent.click(screen.getByRole('button', { name: /submit move/i }));
}

describe('JourneyLessonHost', () => {
  it('starts with Fritz framing and advances into the authored board demo', async () => {
    render(<JourneyLessonHost definition={OPEN_END_DISCIPLINE_LESSON_DEFINITION} onExit={vi.fn()} onLessonCompleted={vi.fn()} runtime={deterministicRuntime()} />);
    expect(await screen.findByText('Fritz’s Table')).toBeInTheDocument();
    expect(screen.getByText('Everybody who beats you later started right here.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /take a seat/i }));
    expect(await screen.findByText('Read the two playable ends before choosing a tile.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /i see the open ends/i })).toBeInTheDocument();
  });

  it('exposes accessible authored hand controls after the demo', async () => {
    render(<JourneyLessonHost definition={OPEN_END_DISCIPLINE_LESSON_DEFINITION} onExit={vi.fn()} onLessonCompleted={vi.fn()} runtime={deterministicRuntime()} />);
    await enterGuidedStage();
    expect(await screen.findByRole('button', { name: 'Domino 1-4' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Domino 1-4' }));
    expect(screen.getByRole('button', { name: /play on left end/i })).toBeInTheDocument();
  });

  it('initializes one logical session under Strict Mode', async () => {
    const runtime = deterministicRuntime();
    const sessionId = vi.spyOn(runtime, 'nextSessionId');
    render(<StrictMode><JourneyLessonHost definition={OPEN_END_DISCIPLINE_LESSON_DEFINITION} onExit={vi.fn()} onLessonCompleted={vi.fn()} runtime={runtime} /></StrictMode>);
    await screen.findByText('Fritz’s Table');
    expect(sessionId).toHaveBeenCalledTimes(1);
  });

  it('completes once after passed proof and keeps failed proof non-terminal', async () => {
    const onLessonCompleted = vi.fn();
    render(<JourneyLessonHost definition={OPEN_END_DISCIPLINE_LESSON_DEFINITION} onExit={vi.fn()} onLessonCompleted={onLessonCompleted} runtime={deterministicRuntime()} />);
    await enterGuidedStage();
    await play('Domino 3-6', /play on right end/i);
    await screen.findByText('Fritz got the wider reply.');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await play('Domino 1-4', /play on left end/i);
    fireEvent.click(await screen.findByRole('button', { name: /continue/i }));

    await play('Domino 3-4', /play on right end/i);
    fireEvent.click(await screen.findByRole('button', { name: /new position/i }));
    await play('Domino 2-5', /play on left end/i);
    fireEvent.click(await screen.findByRole('button', { name: /continue/i }));

    await play('Domino 4-1', /play on right end/i);
    await screen.findByText('Two open ends gave Fritz more room.');
    expect(onLessonCompleted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await play('Domino 2-2', /play on left end/i);
    fireEvent.click(await screen.findByRole('button', { name: /continue/i }));
    expect(await screen.findByRole('heading', { name: 'Proof challenge passed' })).toBeInTheDocument();
    await waitFor(() => expect(onLessonCompleted).toHaveBeenCalledTimes(1));
  });
});
