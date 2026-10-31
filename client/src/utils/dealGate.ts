// client/src/utils/dealGate.ts
//
// A one-bit signal between the staged deal (components/deal/useHandDeal.ts) and Fritz's turn: while cards are still
// flying into the hands, Fritz's opening move waits, so he never plays a tile through the deal.
//
// Pacing only. It changes WHEN a move is shown, never which move or whether one happens, and it cannot stall a turn:
// every wait has a hard cap, and the deal always ends the gate (it ends on every path, see useHandDeal).

let active = false;
let waiters: Array<() => void> = [];

/** No deal should ever keep Fritz waiting longer than this, whatever goes wrong. */
export const DEAL_GATE_MAX_WAIT_MS = 4000;

export function beginDeal(): void {
  active = true;
}

export function endDeal(): void {
  active = false;
  const release = waiters;
  waiters = [];
  for (const wake of release) wake();
}

export function isDealInProgress(): boolean {
  return active;
}

/** Resolves when the deal is over, or after `maxWaitMs`, whichever comes first. Immediately when no deal is running. */
export function whenDealDone(maxWaitMs = DEAL_GATE_MAX_WAIT_MS): Promise<void> {
  if (!active) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wake = () => {
      if (timer !== null) clearTimeout(timer);
      waiters = waiters.filter((w) => w !== wake);
      resolve();
    };
    timer = setTimeout(wake, maxWaitMs);
    waiters.push(wake);
  });
}

/** Test seam. */
export function resetDealGateForTests(): void {
  active = false;
  waiters = [];
}
