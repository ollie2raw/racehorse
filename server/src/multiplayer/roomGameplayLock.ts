/**
 * Serializes gameplay mutations per room so concurrent async handlers
 * (e.g. double-clicks, overlapping game:action acks, disconnect grace auto-pass)
 * cannot interleave reads/writes on the in-memory Room state.
 */

const chains = new Map<string, Promise<void>>();

export async function withRoomGameplayLock<T>(
  roomCode: string,
  work: () => Promise<T>,
): Promise<T> {
  const code = roomCode.trim().toUpperCase();
  const previous = chains.get(code) ?? Promise.resolve();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => gate);
  chains.set(code, next);

  await previous;
  try {
    return await work();
  } finally {
    release();
    if (chains.get(code) === next) {
      chains.delete(code);
    }
  }
}

/** Test-only reset between vitest cases. */
export function resetRoomGameplayLocksForTests(): void {
  chains.clear();
}
