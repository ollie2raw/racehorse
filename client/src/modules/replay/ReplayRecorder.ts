import type { MoveEntry } from '../../game/moveLogger.ts';

export type ReplayMoveInput = Omit<MoveEntry, 'moveNumber' | 'handNumber'>;

/**
 * Canonical move timeline for analysis and review.
 * Owns move numbering; UI subscribes for read models.
 */
export class ReplayRecorder {
  private moveLog: MoveEntry[];
  private nextMoveNumber: number;
  private readonly listeners = new Set<() => void>();

  constructor(initialLog: MoveEntry[] = []) {
    this.moveLog = initialLog;
    this.nextMoveNumber =
      initialLog.reduce((max, entry) => Math.max(max, entry.moveNumber), 0) + 1;
  }

  getMoveLog(): readonly MoveEntry[] {
    return this.moveLog;
  }

  getNextMoveNumber(): number {
    return this.nextMoveNumber;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  recordMove(entry: ReplayMoveInput, handNumber: number): void {
    const moveNumber = this.nextMoveNumber++;
    this.moveLog = [...this.moveLog, { ...entry, moveNumber, handNumber }];
    this.listeners.forEach((listener) => listener());
  }

  replaceLog(moveLog: MoveEntry[]): void {
    this.moveLog = moveLog;
    this.nextMoveNumber =
      moveLog.reduce((max, entry) => Math.max(max, entry.moveNumber), 0) + 1;
    this.listeners.forEach((listener) => listener());
  }
}