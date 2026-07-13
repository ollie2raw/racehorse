const attemptTails = new Map<string, Promise<void>>();

export async function withDailyFritzAttemptLock<T>(
  attemptId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = attemptTails.get(attemptId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  attemptTails.set(attemptId, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (attemptTails.get(attemptId) === tail) {
      attemptTails.delete(attemptId);
    }
  }
}

export function getDailyFritzAttemptLockCountForTests(): number {
  return attemptTails.size;
}
