import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readScript(name: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), 'scripts', name), 'utf8');
}

describe('authority lifecycle harness guardrails', () => {
  it('keeps Challenge soak on both verified participants and full set driver', () => {
    const source = readScript('fritzChallengeAuthoritySoak.ts');
    expect(source).toContain('driveFritzChallengeAttempt');
    expect(source).toContain('creatorResult');
    expect(source).toContain('recipientResult');
    expect(source).toContain('p95Ms');
    expect(source).toContain('FRITZ_CHALLENGE_SOAK_CONCURRENCY');
    expect(source).toContain('runInWaves');
    expect(source).toContain('/join');
  });

  it('keeps Daily Puzzle soak on all five slots and duplicate command checks', () => {
    const source = readScript('dailyPuzzleAuthoritySoak.ts');
    expect(source).toContain('slots.length !== 5');
    expect(source).toContain('driveDailyPuzzleFiveSlotAttempt');
    expect(source).toContain('replayedCompletion.replayed !== true');
    expect(source).toContain('p99Ms');
    expect(source).toContain('DAILY_PUZZLE_SOAK_CONCURRENCY');
    expect(source).toContain('runInWaves');
  });

  it('keeps process chaos on an actual stop, restart, and durable hydration assertion', () => {
    const source = readScript('multiplayerProcessRestartChaos.ts');
    expect(source).toContain("child.kill('SIGTERM')");
    expect(source.match(/startServer\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('assertHydratedAfterRestart');
    expect(source).toContain("recovery: 'durable_hydration'");
  });
});
