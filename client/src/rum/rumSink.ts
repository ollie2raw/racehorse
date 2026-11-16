/**
 * The only part of the speed measurements that lives in the main bundle: a slot the lazily loaded collector (rumCollector.ts) fills, and a
 * call the app makes where it already knows a duration (an acknowledgement's round trip). Until the collector is loaded, or when the
 * visit is not sampled, `rumRecord` does nothing at all.
 */
type Sink = (metric: string, ms: number) => void;

let sink: Sink | null = null;

export function setRumSink(next: Sink | null): void {
  sink = next;
}

export function rumRecord(metric: string, ms: number): void {
  sink?.(metric, ms);
}
