import { describe, expect, it } from 'vitest';
import fixture from './fixtures/multiplayerSavedGame.json';
import { rebuildMultiplayerGameFromRecord, type SavedMultiplayerRecord } from './rebuildMultiplayerGameFromRecord.ts';
import { analyzeMoveLog } from '../../analyzer/moveAnalyzer.ts';

/**
 * The review's consequence text names what the opponent did ("<name> scored 10 on the next move"). It used to say Fritz whoever the opponent was.
 * Run on a REAL saved multiplayer game (the fixture), through the real analyzer.
 */
function analyze(opponentLabel?: string) {
  const rebuilt = rebuildMultiplayerGameFromRecord(structuredClone(fixture) as unknown as SavedMultiplayerRecord);
  if (!rebuilt.ok) throw new Error(rebuilt.detail);
  const { finalState } = rebuilt.game;
  return analyzeMoveLog(rebuilt.game.moveLog, false, {
    oracleMode: 'tier',
    tierPlayed: 'elite',
    winningScore: 60,
    reviewSnapshots: rebuilt.game.snapshots,
    finalScores: { you: finalState.players.you.score, opponent: finalState.players.bot.score },
    ...(opponentLabel === undefined ? {} : { opponentLabel }),
  });
}

const chainText = (analysis: ReturnType<typeof analyze>) => JSON.stringify(analysis.consequenceByMoveNumber);

describe('the analysis names the opponent', () => {
  const named = analyze('Rival');
  const unnamed = analyze();

  it('the real game has opponent consequences to name (so the checks below are not vacuous)', () => {
    expect(chainText(unnamed)).toContain('Fritz scored');
  });

  it('with an opponent label, the consequence text uses it and never says Fritz', () => {
    expect(chainText(named)).toContain('Rival scored');
    expect(chainText(named)).not.toContain('Fritz');
  });

  it('with no label (Play vs Fritz), the text is exactly what it was', () => {
    expect(chainText(unnamed)).toBe(chainText(analyze('Fritz')));
  });

  it('a blank label falls back to Fritz rather than printing nothing', () => {
    expect(chainText(analyze('   '))).toBe(chainText(unnamed));
  });

  it('only the wording changes: the grading is identical', () => {
    expect(named.accuracy).toBe(unnamed.accuracy);
    expect(named.grade).toBe(unnamed.grade);
    expect(named.analyzedMoves.map((m) => m.rating)).toEqual(unnamed.analyzedMoves.map((m) => m.rating));
    expect(named.analyzedMoves.map((m) => m.score)).toEqual(unnamed.analyzedMoves.map((m) => m.score));
  });
});
