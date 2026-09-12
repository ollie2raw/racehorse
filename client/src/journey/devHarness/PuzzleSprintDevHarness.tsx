import { useState } from 'react';
import { PuzzleSprintModal, type PuzzleSprintResult } from '../PuzzleSprintModal';
import type { JourneyPuzzle } from '../journeyPuzzles';

/**
 * DEV-ONLY manual test harness for PuzzleSprintModal — not part of any
 * production route, AppMode, or Journey content. Reached only via
 * `?puzzleSprintDevHarness=1` behind an `import.meta.env.DEV` gate in
 * main.tsx.
 *
 * TEMPORARY: this whole devHarness/ directory and its main.tsx wiring should
 * be deleted once real content adopts PuzzleSprintModal (docs/scoping/
 * journey-overhaul-2026-09-12.md §1, PR 6) — it exists only so the component
 * can be clicked through live before it becomes a template for many nodes.
 */

const FIXTURE_PUZZLES: JourneyPuzzle[] = [
  {
    nodeId: 'harness-sprint-1',
    eyebrow: 'Puzzle Sprint · Harness',
    title: 'Open Ends',
    scenario: 'The board shows open ends of 3 and 5.',
    prompt: 'Which tile reads the board correctly?',
    choices: [],
    correctChoiceId: '',
    explanation: 'The 3-4 keeps both ends live without handing over a scoring lane.',
    rewardLabel: 'Sprint Point',
    boardState: { ends: [3, 5], placedTiles: [{ high: 5, low: 3 }] },
    playerHand: [{ high: 3, low: 4 }, { high: 6, low: 6 }],
    correctTile: { high: 3, low: 4 },
  },
  {
    nodeId: 'harness-sprint-2',
    eyebrow: 'Puzzle Sprint · Harness',
    title: 'Doubles Tempo',
    scenario: 'A double sits on the open end.',
    prompt: 'Play the double now, or hold it?',
    choices: [],
    correctChoiceId: '',
    explanation: 'Locking the double here keeps the tempo in your favor.',
    rewardLabel: 'Sprint Point',
    boardState: { ends: [5, 2], placedTiles: [{ high: 5, low: 2 }] },
    playerHand: [{ high: 5, low: 5 }, { high: 1, low: 2 }],
    correctTile: { high: 5, low: 5 },
  },
  {
    nodeId: 'harness-sprint-3',
    eyebrow: 'Puzzle Sprint · Harness',
    title: 'Counting Down',
    scenario: 'Three tiles remain in the boneyard.',
    prompt: 'Which play denies your opponent the safest exit?',
    choices: [],
    correctChoiceId: '',
    explanation: 'Playing the 0-3 closes the only end Fritz can still match.',
    rewardLabel: 'Sprint Point',
    boardState: { ends: [3, 6], placedTiles: [{ high: 6, low: 3 }] },
    playerHand: [{ high: 0, low: 3 }, { high: 2, low: 2 }],
    correctTile: { high: 0, low: 3 },
  },
];

export function PuzzleSprintDevHarness() {
  const [open, setOpen] = useState(true);
  const [lastResult, setLastResult] = useState<PuzzleSprintResult | null>(null);
  const [lastExit, setLastExit] = useState(false);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#04070c',
        color: 'rgba(255,255,255,0.95)',
        fontFamily: 'sans-serif',
        padding: 24,
      }}
    >
      <h1>PuzzleSprintModal — dev harness</h1>
      <p>Not a real Journey node. For manual QA only; see file header.</p>
      <button
        type="button"
        onClick={() => {
          setLastResult(null);
          setLastExit(false);
          setOpen(true);
        }}
      >
        Relaunch sprint
      </button>
      {lastResult ? (
        <pre>{JSON.stringify(lastResult, null, 2)}</pre>
      ) : null}
      {lastExit ? <p>Player left early (onExit fired).</p> : null}

      <PuzzleSprintModal
        open={open}
        puzzles={FIXTURE_PUZZLES}
        timeLimitSec={40}
        onComplete={(result) => {
          setLastResult(result);
          setOpen(false);
        }}
        onExit={() => {
          setLastExit(true);
          setOpen(false);
        }}
      />
    </div>
  );
}
