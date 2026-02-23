export type DebugEvent = {
  t: number;
  name: string;
  payload?: unknown;
};

export class RingBuffer<T> {
  private readonly items: T[] = [];
  constructor(private readonly capacity: number) {}

  push(item: T) {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.shift();
  }

  snapshot(): T[] {
    return this.items.slice();
  }
}
