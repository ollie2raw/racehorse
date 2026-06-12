import {
  DailyFritzApiError,
  DAILY_FRITZ_ABANDONED_PRIMARY_COPY,
  DAILY_FRITZ_ABANDONED_QA_HINT,
  DAILY_FRITZ_ABANDONED_SECONDARY_COPY,
  formatDailyFritzAbandonedHubCopy,
  friendlyDailyFritzInitError,
  isDailyFritzAbandonedAttemptStatus,
  isDailyFritzAttemptLockedAbandoned,
} from './dailyFritzErrors.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[dailyFritzErrors.behaviorTests] ${message}`);
}

function runDailyFritzErrorsBehaviorTests(): void {
  {
    assert(
      isDailyFritzAbandonedAttemptStatus('abandoned'),
      'abandoned attempt status should be recognized',
    );
    assert(!isDailyFritzAbandonedAttemptStatus('started'), 'started is not abandoned');
    assert(!isDailyFritzAbandonedAttemptStatus('completed'), 'completed is not abandoned');
    assert(!isDailyFritzAbandonedAttemptStatus('none'), 'none is not abandoned');
  }

  {
    const err = new DailyFritzApiError("Today's Daily Fritz attempt is already locked.", 409, 'abandoned');
    assert(isDailyFritzAttemptLockedAbandoned(err), '409 abandoned api error should match');
    assert(
      friendlyDailyFritzInitError(err) === DAILY_FRITZ_ABANDONED_PRIMARY_COPY,
      'init error formatter should use abandoned primary copy',
    );
  }

  {
    const err = new DailyFritzApiError("Today's Daily Fritz attempt is already locked.", 409, 'completed');
    assert(!isDailyFritzAttemptLockedAbandoned(err), 'completed lock is not abandoned');
  }

  {
    const copy = formatDailyFritzAbandonedHubCopy({ includeQaHint: true });
    assert(copy.primary === DAILY_FRITZ_ABANDONED_PRIMARY_COPY, 'primary abandoned copy');
    assert(copy.secondary === DAILY_FRITZ_ABANDONED_SECONDARY_COPY, 'secondary abandoned copy');
    assert(copy.qaHint === DAILY_FRITZ_ABANDONED_QA_HINT, 'qa hint when enabled');
  }

  {
    const copy = formatDailyFritzAbandonedHubCopy({ includeQaHint: false });
    assert(copy.qaHint === null, 'qa hint omitted when disabled');
  }

  {
    assert(
      friendlyDailyFritzInitError(new Error('Failed to fetch')) === 'Please try again.',
      'network failures stay generic',
    );
  }
}

runDailyFritzErrorsBehaviorTests();
console.log('[dailyFritzErrors.behaviorTests] all tests passed');
