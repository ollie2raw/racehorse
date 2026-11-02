/**
 * Fritz's exhaustive searches can be bounded by work instead of wall-clock time. Pins the budget itself and, the point of it,
 * that with a node budget the same seed plays out to the same moves however fast or slow the machine is.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { playSeededMatch } from './fritzSelfPlay.ts';
import {
  createSearchBudget,
  finishSearchBudgetStats,
  getSearchBudgetMode,
  NODES_PER_MS,
  setSearchBudgetMode,
  startSearchBudgetStats,
} from './searchBudget.ts';

afterEach(() => setSearchBudgetMode('time'));

describe('SearchBudget', () => {
  it('defaults to the wall-clock budget', () => {
    expect(getSearchBudgetMode()).toBe('time');
  });

  it('a node budget allows exactly ms * NODES_PER_MS checks, then stays exhausted', () => {
    setSearchBudgetMode('nodes');
    const budget = createSearchBudget(2);
    const limit = 2 * NODES_PER_MS;
    for (let i = 0; i < limit; i++) expect(budget.exhausted()).toBe(false);
    expect(budget.exhausted()).toBe(true);
    expect(budget.exhausted()).toBe(true);
    expect(budget.used).toBe(limit + 2);
  });

  it('a time budget is not exhausted at once', () => {
    setSearchBudgetMode('time');
    expect(createSearchBudget(1000).exhausted()).toBe(false);
  });

  it('records the budgets created while stats are on, and nothing after', () => {
    startSearchBudgetStats();
    createSearchBudget(5).exhausted();
    const records = finishSearchBudgetStats();
    expect(records).toHaveLength(1);
    expect(records[0].budget.used).toBe(1);
    createSearchBudget(5);
    expect(finishSearchBudgetStats()).toEqual([]);
  });
});

describe('Fritz with a node budget', () => {
  it('plays a master-vs-master match move for move the same on every run', { timeout: 120_000 }, () => {
    setSearchBudgetMode('nodes');
    const first = playSeededMatch(7, 'master', 'master');
    const second = playSeededMatch(7, 'master', 'master');
    expect(first.moves.length).toBeGreaterThan(20);
    expect(second).toEqual(first);
  });

  it('and that holds when the machine is made slow in between', { timeout: 120_000 }, () => {
    setSearchBudgetMode('nodes');
    const first = playSeededMatch(11, 'master', 'hard');
    const end = performance.now() + 150;
    while (performance.now() < end) {
      // keep the CPU busy
    }
    expect(playSeededMatch(11, 'master', 'hard')).toEqual(first);
  });
});
