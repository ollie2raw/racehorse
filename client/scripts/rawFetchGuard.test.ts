import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every REST call goes through api/client.ts (apiGet / apiPost / apiDelete): one auth header, a 15 s timeout, one refresh-and-retry
 * on a 401, one error shape, never a throw. A raw fetch() skips all of that. These are the only files allowed to call it, and the
 * reason each one cannot use the shared client. A new raw fetch fails this test: use the client, or add the file here with its reason.
 */
const ALLOWED_RAW_FETCH: Record<string, string> = {
  'api/client.ts': 'the shared client itself',
  'audio/audioEngine.ts': 'loads sound files: static assets, not API calls',
  'practice/noBrainerDataset.ts': 'loads the bundled practice dataset: a static asset',
  'learn/guidedMatch/guidedMatchLessonLoader.ts': 'loads the bundled guided lesson JSON: a static asset (failure is handled there)',
  'devtools/handLifecycleDebug.ts': 'dev-only debug ingest, fire-and-forget, must never touch auth or retry',
  'devtools/dailyFritzDebugIngest.ts': 'dev-only debug ingest, fire-and-forget, must never touch auth or retry',
  'dailyFritz/dailyFritzCheckpointUnload.ts': 'sent while the page is unloading with keepalive: it cannot await an async token read, timeout timers or a refresh',
  'modules/match/api/botMatchApi.ts': 'uses the token captured at match start (not a per-request session read) and keepalive on unload-abandon',
  'multiplayer/terminalRoomArchiveRecovery.ts': 'takes an explicit server URL and token and maps 404, 401 and 403 itself; a 401 must NOT refresh or raise the session-expired event',
  'modules/review/reviewCompletionClient.ts': 'the review outbox owns retries, idempotency and error classification, with an explicit apiBase and token',
  'modules/review/reviewFunnelClient.ts': 'fire-and-forget analytics event; must never block, retry or surface an error',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.[tj]sx?$/.test(entry) && !path.includes('__tests__')) out.push(path);
  }
  return out;
}

// A bare fetch( call: not a method (.fetch), not part of a longer name (refetch, prefetch).
const RAW_FETCH = /(^|[^\w.$])fetch\(/;

function filesWithRawFetch(): string[] {
  // vitest runs from client/ (see the project's CI commands)
  const root = join(process.cwd(), 'src');
  return walk(root)
    .filter((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .some((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && RAW_FETCH.test(line)),
    )
    .map((path) => relative(root, path).split('\\').join('/'))
    .sort();
}

describe('raw fetch() calls', () => {
  it('are made only by the files that have a reason not to use the shared API client', () => {
    expect(filesWithRawFetch()).toEqual(Object.keys(ALLOWED_RAW_FETCH).sort());
  });

  it('every allowed file states its reason', () => {
    for (const [file, reason] of Object.entries(ALLOWED_RAW_FETCH)) {
      expect(reason.length, file).toBeGreaterThan(15);
    }
  });

  it('the matcher sees a bare call and ignores methods and longer names', () => {
    expect(RAW_FETCH.test('const r = await fetch(url);')).toBe(true);
    expect(RAW_FETCH.test('  void fetch(url, {')).toBe(true);
    expect(RAW_FETCH.test('await refetch();')).toBe(false);
    expect(RAW_FETCH.test('prefetchHand(x)')).toBe(false);
    expect(RAW_FETCH.test('await page.fetch(x)')).toBe(false);
    expect(RAW_FETCH.test('window.fetch(x)')).toBe(false);
  });
});
