// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OPEN_END_DISCIPLINE_LESSON_DEFINITION } from '../lessons/openEndDiscipline/openEndDisciplineLesson.ts';
import { JourneyLessonHost } from './JourneyLessonHost.tsx';
import { buildJourneyLessonCompletionProof } from '../journeyStageCompletion.ts';
import type { JourneyLessonSessionState } from '../journeyLessonController.ts';

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
    const onLessonCompleted = vi.fn(() => ({ kind: 'confirmed' as const }));
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

  async function playOpenEndLessonWithRetries() {
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
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await play('Domino 2-2', /play on left end/i);
    fireEvent.click(await screen.findByRole('button', { name: /continue/i }));
    await screen.findByRole('heading', { name: 'Proof challenge passed' });
  }

  it('hands the completed controller session to the callback, and that session yields an honest proof with its retries', async () => {
    const received: JourneyLessonSessionState[] = [];
    render(<JourneyLessonHost definition={OPEN_END_DISCIPLINE_LESSON_DEFINITION} onExit={vi.fn()} onLessonCompleted={(session) => { received.push(session); return { kind: 'confirmed' }; }} runtime={deterministicRuntime()} />);
    await playOpenEndLessonWithRetries();
    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].status).toBe('completed');
    const proof = buildJourneyLessonCompletionProof(received[0], OPEN_END_DISCIPLINE_LESSON_DEFINITION);
    expect(proof).not.toBeNull();
    expect(proof!.stages.map((stage) => stage.stageId)).toEqual(['independent-practice', 'proof']);
    expect(proof!.retries).toBeGreaterThan(0); // the player missed positions on the way; the proof says so
  });

  it('under Strict Mode a full run still reports completion exactly once', async () => {
    const onLessonCompleted = vi.fn(() => ({ kind: 'confirmed' as const }));
    render(<StrictMode><JourneyLessonHost definition={OPEN_END_DISCIPLINE_LESSON_DEFINITION} onExit={vi.fn()} onLessonCompleted={onLessonCompleted} runtime={deterministicRuntime()} /></StrictMode>);
    await playOpenEndLessonWithRetries();
    await waitFor(() => expect(onLessonCompleted).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onLessonCompleted).toHaveBeenCalledTimes(1);
  });
});
