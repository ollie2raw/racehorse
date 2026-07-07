import type { MatchDomainEvent, MatchDomainEventType, MatchEventListener } from '@racehorse/match-protocol';

export class MatchEventBus {
  private readonly listeners = new Map<MatchDomainEventType | '*', Set<MatchEventListener>>();

  subscribe(type: MatchDomainEventType | '*', listener: MatchEventListener): () => void {
    const bucket = this.listeners.get(type) ?? new Set<MatchEventListener>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
    return () => {
      bucket.delete(listener);
      if (bucket.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  emit(event: MatchDomainEvent): void {
    const typed = this.listeners.get(event.type);
    typed?.forEach((listener) => listener(event));
    const all = this.listeners.get('*');
    all?.forEach((listener) => listener(event));
  }

  clear(): void {
    this.listeners.clear();
  }
}