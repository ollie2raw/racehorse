/**
 * Outage scenario: run one review completion pass over a real job while an
 * HTTP /ping on this same process is probed from a separate process, and
 * report what /ping and the event loop did.
 *
 *   npx tsx scripts/reviewOutageScenario.ts <job.json> inline [seconds]
 *   npx tsx scripts/reviewOutageScenario.ts <job.json> worker [seconds]
 *
 * <job.json>: one review_completion_jobs row as returned by PostgREST (an
 * object or a one-element array). Local only — reads the file, writes nothing.
 *
 * inline: the pre-fix behaviour — search on the main thread, decision
 *         concurrency 4 (what production ran during the outages).
 * worker: the fix — search in the worker thread, concurrency 1.
 *
 * The pass is asked to stop after [seconds] (default 60); inline can only
 * stop between waves, so it may run past that.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import {
  InMemoryCheckpointStore,
  runReviewCompletionPass,
  type ReviewCompletionJobRecord,
} from '@racehorse/review-engine';
import { ReviewSearchRunner } from '../src/reviewCompletion/reviewSearchRunner';

const [, , jobPath, modeArg, secondsArg] = process.argv;
if (!jobPath || (modeArg !== 'inline' && modeArg !== 'worker')) {
  console.error('usage: tsx scripts/reviewOutageScenario.ts <job.json> inline|worker [seconds]');
  process.exit(2);
}
const mode = modeArg;
const seconds = Number(secondsArg) || 60;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

async function main(): Promise<void> {
  const raw = JSON.parse(readFileSync(jobPath!, 'utf8')) as unknown;
  const row = (Array.isArray(raw) ? raw[0] : raw) as { id: string; job_payload: ReviewCompletionJobRecord };
  const job: ReviewCompletionJobRecord = {
    ...row.job_payload,
    jobId: row.id,
    status: 'pending',
    claimToken: null,
    claimGeneration: 0,
    leaseExpiresAt: null,
    nextAttemptAt: 0,
  };
  const pending = job.decisions.filter((d) => d.lifecycle !== 'SCORED' && d.lifecycle !== 'FORCED').length;

  // Production's store is Supabase over HTTP: every call yields the loop for
  // a network round trip. Simulate ~20ms so the scenario has the same gaps.
  const store = new InMemoryCheckpointStore();
  await store.put(job);
  const networkMs = 20;
  for (const method of ['get', 'claim', 'checkpoint'] as const) {
    const original = store[method].bind(store) as (...args: unknown[]) => Promise<unknown>;
    (store as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, networkMs));
      return original(...args);
    };
  }

  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('pong');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const url = `http://127.0.0.1:${address.port}/ping`;

  // The probe lives in its own process so its clock is not blocked with ours.
  const probe = spawn(process.execPath, ['-e', `
    const url = ${JSON.stringify(url)};
    (async () => {
      for (;;) {
        const t = Date.now();
        try { await fetch(url, { signal: AbortSignal.timeout(30000) }); process.stdout.write((Date.now() - t) + '\\n'); }
        catch { process.stdout.write('timeout\\n'); }
        await new Promise((r) => setTimeout(r, 200));
      }
    })();
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  const latencies: number[] = [];
  const rawProbeLines: string[] = [];
  let timeouts = 0;
  probe.stdout.setEncoding('utf8');
  let buffered = '';
  probe.stdout.on('data', (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      const value = line.trim();
      if (value === 'timeout') timeouts += 1;
      else if (/^\d+$/.test(value)) latencies.push(Number(value));
      else if (value) rawProbeLines.push(value);
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  latencies.length = 0;

  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const runner = mode === 'worker' ? new ReviewSearchRunner() : null;
  const started = Date.now();
  const result = await runReviewCompletionPass({
    store,
    jobId: job.jobId,
    claimToken: `scenario-${mode}`,
    leaseMs: 10 * 60_000,
    concurrency: mode === 'inline' ? 4 : 1,
    nowFn: Date.now,
    shouldAbort: () => Date.now() - started > seconds * 1_000,
    ...(runner ? { evaluatePosition: (snapshot, options) => runner.evaluate(snapshot, options) } : {}),
  });
  const elapsedMs = Date.now() - started;
  // Let the probe's delayed responses land before reading anything.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  loop.disable();
  probe.kill();
  await runner?.close();
  server.close();

  const done = result.job.decisions.filter((d) => d.lifecycle === 'SCORED' || d.lifecycle === 'FORCED').length;
  const sorted = [...latencies].sort((a, b) => a - b);
  console.log(JSON.stringify({
    mode,
    elapsedS: Math.round(elapsedMs / 100) / 10,
    positionsPendingAtStart: pending,
    decisionsDone: `${done}/${result.job.decisions.length}`,
    ping: {
      samples: latencies.length,
      timeouts,
      p50Ms: percentile(sorted, 0.5),
      p99Ms: percentile(sorted, 0.99),
      maxMs: sorted.length ? sorted[sorted.length - 1] : null,
      over200Ms: sorted.filter((ms) => ms > 200).length,
    },
    ...(rawProbeLines.length ? { unparsedProbeOutput: rawProbeLines.slice(0, 5) } : {}),
    eventLoopDelay: {
      p99Ms: Math.round(loop.percentile(99) / 1e6),
      maxMs: Math.round(loop.max / 1e6),
    },
  }, null, 2));
}

void main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
