import type { BotMatchState } from '../bot/botEngine.ts';
import {
  getDailyFritzMatchStorageKey,
  hasDailyFritzMatchSnapshot,
  loadPersistedDailyFritzMatchSnapshot,
  persistDailyFritzMatchSnapshot,
  shouldBlockUnsafeDailyFritzResume,
  type DailyFritzStorageLike,
  type PersistedDailyFritzMatchSnapshot,
} from './storage.ts';

class MemoryStorage implements DailyFritzStorageLike {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key) ?? null : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[dailyFritz.storage.behaviorTests] ${message}`);
}

function mkSnapshot(overrides?: Partial<PersistedDailyFritzMatchSnapshot>): PersistedDailyFritzMatchSnapshot {
  return {
    attemptId: 'attempt-1',
    currentHandIndex: 2,
    match: {
      players: {
        you: { hand: [], score: 14 },
        bot: { hand: [], score: 9 },
      },
      board: {
        mainLine: [],
        leftEnd: 0,
        rightEnd: 0,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      boneyard: [],
      deadTiles: [],
      handOpen: true,
      currentPlayer: 'you',
      consecutivePasses: 0,
      handNumber: 3,
      turnIndex: 6,
      handOver: false,
      gameOver: false,
      winnerId: null,
      winningScore: 60,
      lastHandWinner: null,
      lastHandReason: null,
      dealSize: 7,
      opponentPassedOnEnds: [],
      opponentDrawCount: 0,
      opponentKnownMissing: [],
      opponentMissingEvidence: [],
    } as BotMatchState,
    movesUsed: 18,
    moveLog: [],
    ...overrides,
  };
}

function runDailyFritzStorageBehaviorTests(): void {
  {
    const local = new MemoryStorage();
    const key = getDailyFritzMatchStorageKey('attempt-1', 1);
    const snapshot = mkSnapshot({ currentHandIndex: 0 });
    persistDailyFritzMatchSnapshot(local, key, snapshot);
    const loaded = loadPersistedDailyFritzMatchSnapshot({
      storageKey: key,
      attemptId: 'attempt-1',
      currentHandIndex: 0,
      primaryStorage: local,
    });
    assert(loaded?.match?.players.you.score === 14, 'local snapshot should preserve player score');
    assert(loaded?.match?.players.bot.score === 9, 'local snapshot should preserve Fritz score');
  }

  {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    const key = getDailyFritzMatchStorageKey('attempt-1', 2);
    persistDailyFritzMatchSnapshot(session, key, mkSnapshot());
    const loaded = loadPersistedDailyFritzMatchSnapshot({
      storageKey: key,
      attemptId: 'attempt-1',
      currentHandIndex: 2,
      primaryStorage: local,
      fallbackStorage: session,
    });
    assert(loaded !== null, 'session fallback snapshot should load');
    assert(local.getItem(key) !== null, 'session fallback snapshot should migrate to local storage');
    assert(session.getItem(key) === null, 'session fallback snapshot should be cleared after migration');
  }

  {
    const local = new MemoryStorage();
    const key = getDailyFritzMatchStorageKey('attempt-1', 1);
    persistDailyFritzMatchSnapshot(local, key, mkSnapshot({ currentHandIndex: 1 }));
    const loaded = loadPersistedDailyFritzMatchSnapshot({
      storageKey: key,
      attemptId: 'attempt-1',
      currentHandIndex: 0,
      primaryStorage: local,
    });
    assert(loaded === null, 'mismatched hand index must not resume a snapshot');
  }

  {
    const shouldBlock = shouldBlockUnsafeDailyFritzResume({
      hadStartedAttemptBefore: true,
      hasRecoverableSnapshot: false,
      currentHandIndex: 0,
      currentGameNumber: 1,
      setResult: {
        version: 2,
        format: 'best_of_3',
        playerGamesWon: 0,
        fritzGamesWon: 0,
        totalPointDiff: 0,
        games: [],
      },
    });
    assert(shouldBlock, 'game 1 without snapshot must be blocked to avoid fake resume');
  }

  {
    const shouldBlock = shouldBlockUnsafeDailyFritzResume({
      hadStartedAttemptBefore: true,
      hasRecoverableSnapshot: false,
      currentHandIndex: 0,
      currentGameNumber: 2,
      setResult: {
        version: 2,
        format: 'best_of_3',
        playerGamesWon: 1,
        fritzGamesWon: 0,
        totalPointDiff: 30,
        games: [
          {
            gameNumber: 1,
            seed: 'daily-fritz-2026-06-03:game:1',
            playerWon: true,
            playerScore: 60,
            fritzScore: 28,
            pointDiff: 32,
            completedAt: '2026-06-03T00:00:00.000Z',
          },
        ],
      },
    });
    assert(!shouldBlock, 'between-game resume should remain allowed without a live hand snapshot');
  }

  {
    const local = new MemoryStorage();
    const key = getDailyFritzMatchStorageKey('attempt-1', 1);
    persistDailyFritzMatchSnapshot(local, key, mkSnapshot({ currentHandIndex: 0 }));
    const hasSnapshot = hasDailyFritzMatchSnapshot({
      storageKey: key,
      attemptId: 'attempt-1',
      currentHandIndex: 0,
      primaryStorage: local,
    });
    assert(hasSnapshot, 'hasDailyFritzMatchSnapshot should report a valid stored match');
  }
}

runDailyFritzStorageBehaviorTests();
console.log('[dailyFritz.storage.behaviorTests] all tests passed');
