type DailyFritzMetric = {
  count: number;
  totalMs: number;
  maxMs: number;
};

const DAILY_FRITZ_BOARD_DEBUG_LOGS =
  import.meta.env.DEV === true || import.meta.env.VITE_DEBUG_DAILY_FRITZ === 'true';

function boardTraceTimestamp(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? Number(performance.now().toFixed(2))
    : Date.now();
}

/** Push to the Daily Fritz interaction trace bucket; console only in dev/debug builds. */
export function traceDailyFritzBoardEvent(
  tag: string,
  payload: Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return;
  const entry = { tag, timestamp: boardTraceTimestamp(), ...payload };
  const win = window as typeof window & {
    __dailyFritzInteractionTrace?: Array<Record<string, unknown>>;
  };
  const bucket = (win.__dailyFritzInteractionTrace ??= []);
  bucket.push(entry);
  if (bucket.length > 400) {
    bucket.splice(0, bucket.length - 400);
  }
  if (DAILY_FRITZ_BOARD_DEBUG_LOGS) {
    console.log(tag, entry);
  }
}

/** Opt-in camera tracing via localStorage BOARD_CAMERA_DEBUG=1 (production-safe). */
export function traceCameraDebug(
  tag: string,
  payload: Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem('BOARD_CAMERA_DEBUG') !== '1') return;
  } catch {
    return;
  }
  console.log(tag, { ...payload, timestamp: boardTraceTimestamp() });
}

/** Silent metric accumulation when __dailyFritzProfileActive is set on window. */
export function recordDailyFritzBoardMetric(
  name: 'boardRenderCount' | 'computeLayout',
  value: number,
): void {
  if (typeof window === 'undefined') return;
  const win = window as typeof window & {
    __dailyFritzProfileActive?: boolean;
    __dailyFritzProfile?: {
      boardRenderCount?: number;
      metrics?: Record<string, DailyFritzMetric>;
    };
  };
  if (!win.__dailyFritzProfileActive) return;
  const profile = (win.__dailyFritzProfile ??= {});
  if (name === 'boardRenderCount') {
    profile.boardRenderCount = (profile.boardRenderCount ?? 0) + value;
    return;
  }
  const metrics = (profile.metrics ??= {});
  const current = metrics[name] ?? { count: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += value;
  current.maxMs = Math.max(current.maxMs, value);
  metrics[name] = current;
}

/** Push layout-debug samples to window bucket; console only in dev (matches match/layoutDebug.ts). */
export function recordDailyFritzLayoutDebug(entry: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const win = window as typeof window & {
    __dailyFritzLayoutDebug?: Array<Record<string, unknown>>;
  };
  const bucket = (win.__dailyFritzLayoutDebug ??= []);
  bucket.push(entry);
  if (bucket.length > 300) {
    bucket.splice(0, bucket.length - 300);
  }
  if (import.meta.env.DEV) {
    console.log('[layout-debug]', entry);
  }
}