import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_SUPABASE_REFS } from './productionSupabaseGuard';

const root = path.resolve(__dirname, '../../../..');
describe('actual persistence QA entry points refuse production before traffic', () => {
  it('guards the reachability seed even with inherited manual opt-ins', () => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', "globalThis.fetch = () => { throw new Error('NETWORK_REACHED'); }; await import('./client/scripts/seedReachabilityQaData.mjs');", '--', '--allow-production'], {
      cwd: root,
      env: { ...process.env, SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REFS[0]}.supabase.co`, SUPABASE_SERVICE_KEY: 'dummy', DAILY_FRITZ_QA_USER_ID: 'dummy', RACEHORSE_ALLOW_PRODUCTION_SUPABASE: '1' },
      encoding: 'utf8',
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('PRODUCTION');
    expect(run.stderr).not.toContain('NETWORK_REACHED');
  });

  it('blocks actual remote browser requests and sockets while allowing local/dev destinations', () => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { guardPersistenceQaBrowser } from './client/scripts/persistenceQaSafety.mjs';
      let handler, socketHandler;
      await guardPersistenceQaBrowser({ route: async (_pattern, fn) => { handler = fn; }, routeWebSocket: async (_pattern, fn) => { socketHandler = fn; } }, { SUPABASE_URL: 'https://dev.supabase.co' });
      const outcomes = [];
      for (const url of ['https://${PRODUCTION_SUPABASE_REFS[0]}.supabase.co/rest/v1/daily_fritz_attempts', 'https://racehorse.onrender.com/api/daily-fritz/start', 'http://127.0.0.1:3001/api/daily-fritz/start', 'https://dev.supabase.co/auth/v1/token']) {
        await handler({ request: () => ({ url: () => url, resourceType: () => 'fetch' }), abort: async () => outcomes.push('blocked'), continue: async () => outcomes.push('allowed') });
      }
      for (const url of ['wss://racehorse.onrender.com/socket.io', 'ws://127.0.0.1:3001/socket.io']) {
        socketHandler({ url: () => url, close: () => outcomes.push('blocked'), connectToServer: () => outcomes.push('allowed') });
      }
      console.log(JSON.stringify(outcomes));
    `], { cwd: root, env: { ...process.env, RACEHORSE_ALLOW_PRODUCTION_SUPABASE: '1' }, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout.trim())).toEqual(['blocked', 'blocked', 'allowed', 'allowed', 'blocked', 'allowed']);
  });
});
