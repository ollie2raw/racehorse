import { useEffect, useRef } from 'react';

type RenderSample = {
  name: string;
  count: number;
  durationMs: number;
  averageMs: number;
  maxMs: number;
  t: number;
};

type RenderStats = {
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
};

const renderStats = new Map<string, RenderStats>();

function shouldProfileRenders(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return window.localStorage.getItem('RENDER_PROFILE') === '1';
}

function emitRenderSample(name: string, durationMs: number) {
  const current = renderStats.get(name) ?? {
    count: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
  };
  current.count += 1;
  current.totalDurationMs += durationMs;
  current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
  renderStats.set(name, current);

  const sample: RenderSample = {
    name,
    count: current.count,
    durationMs,
    averageMs: current.totalDurationMs / current.count,
    maxMs: current.maxDurationMs,
    t: Date.now(),
  };

  const win = window as typeof window & {
    __racehorseRenderProfile?: RenderSample[];
  };
  const bucket = win.__racehorseRenderProfile ?? [];
  bucket.push(sample);
  if (bucket.length > 200) {
    bucket.splice(0, bucket.length - 200);
  }
  win.__racehorseRenderProfile = bucket;

  if (current.count === 1 || current.count % 25 === 0 || durationMs >= 8) {
    console.log('[render-profile]', sample);
  }
}

export function getRenderProfileSnapshot(): RenderSample[] {
  if (typeof window === 'undefined') return [];
  const win = window as typeof window & {
    __racehorseRenderProfile?: RenderSample[];
  };
  return [...(win.__racehorseRenderProfile ?? [])];
}

export function useRenderProfiler(name: string) {
  const enabled = shouldProfileRenders();
  const startRef = useRef(0);

  if (enabled) {
    startRef.current = performance.now();
  }

  useEffect(() => {
    if (!enabled) return;
    emitRenderSample(name, performance.now() - startRef.current);
  });
}
