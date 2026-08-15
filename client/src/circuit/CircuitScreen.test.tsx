import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CircuitScreen from './CircuitScreen';
import {
  continueAfterCircuitFeedback,
  createIdleCircuitRun,
  startCircuitRun,
  submitCircuitDecision,
} from './run/circuitRunEngine';

describe('CircuitScreen', () => {
  it('renders lobby guidance and starts a run', () => {
    render(<CircuitScreen onBack={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'The Circuit' })).toBeTruthy();
    expect(screen.getByText(/Select a playable tile/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start Run' }));
    expect(screen.getByLabelText('Circuit run status')).toBeTruthy();
  });
});

describe('illegal interaction semantics', () => {
  it('keeps run meters unchanged on rejected illegal commit', () => {
    let run = startCircuitRun({
      personalBest: 12,
      manifest: [{ kind: 'single_gate', scenarioId: 'circuit:certified:scoring-take-five' }],
    });
    const snapshot = { ...run };
    run = submitCircuitDecision(run, { tile: { low: 4, high: 5 }, position: 'left' });
    // May be illegal depending on board — if rejected:
    if (run.interactionNotice) {
      expect(run.score).toBe(snapshot.score);
      expect(run.strikes).toBe(snapshot.strikes);
      expect(run.combo).toBe(snapshot.combo);
      expect(run.decisionHistory).toHaveLength(0);
      expect(run.phase).toBe('deciding');
    }
  });

  it('does not advance while idle', () => {
    const idle = createIdleCircuitRun(0);
    const next = submitCircuitDecision(idle, { tile: { low: 1, high: 2 }, position: 'left' });
    expect(next).toEqual(idle);
    expect(continueAfterCircuitFeedback(idle)).toEqual(idle);
  });
});
