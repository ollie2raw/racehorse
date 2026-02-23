export type DebugEvent = {
  t: number;
  name: string;
  payload?: unknown;
};

export class RingBuffer<T> {
  private readonly items: T[] = [];
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }
push(item: T) {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.shift();
  }

  snapshot(): T[] {
    return this.items.slice();
  }
}
