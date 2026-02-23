import { RingBuffer, type DebugEvent } from './ringBuffer';

const buf = new RingBuffer<DebugEvent>(200);

export function traceSocketEvent(name: string, payload?: unknown) {
  buf.push({ t: Date.now(), name, payload });
}

export function getSocketTrace(): DebugEvent[] {
  return buf.snapshot();
}
