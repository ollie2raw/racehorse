// Local-only compatibility check. Requires the documented premigration fixture
// and direct PostgREST on 127.0.0.1:55441. No arbitrary URL arguments accepted.
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { assertNotProductionSupabase } = require('../dist/platform/env/productionSupabaseGuard');
assertNotProductionSupabase('forfeit premigration local boot');
const encoded = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const message = `${encoded({ alg: 'HS256', typ: 'JWT' })}.${encoded({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
const key = `${message}.${createHmac('sha256', 'racehorse-forfeit-r1-local-validation-only-secret').update(message).digest('base64url')}`;
const psql = process.env.PSQL_BIN || '/opt/homebrew/opt/postgresql@16/bin/psql';
const databaseName = process.env.FORFEIT_R1_PREMIGRATION_DATABASE_NAME || 'racehorse_forfeit_r1_premigration';
assert.ok(['racehorse_forfeit_r1_premigration', 'racehorse_runtime_prectx'].includes(databaseName));
const dbUrl = 'postgresql://postgres@127.0.0.1:55439/' + databaseName;
const sql = (query) => execFileSync(psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-At', dbUrl, '-c', query], { encoding: 'utf8', timeout: 10000 }).trim();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const beforeGames = sql('select count(*) from ranked_games where rating_after is not null');
  const beforePeriods = sql('select count(*) from rating_periods');
  assert.equal(sql("select count(*) from information_schema.columns where table_schema='public' and table_name='ranked_games' and column_name='rating_context'"), '0');
  // Reproduce only the local Supabase gateway's /rest/v1 prefix rewrite.
  const gateway = http.createServer((req, res) => {
    const target = new URL('http://127.0.0.1:55441');
    target.pathname = (req.url || '/').split('?')[0].replace(/^\/rest\/v1/, '');
    target.search = (req.url || '').includes('?') ? (req.url || '').slice((req.url || '').indexOf('?')) : '';
    const upstream = http.request(target, { method: req.method, headers: req.headers }, (reply) => {
      res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(55443, '127.0.0.1', resolve); });
  const env = { PATH: process.env.PATH, NODE_ENV: 'test', PORT: '55442',
    SUPABASE_URL: 'http://127.0.0.1:55443', SUPABASE_SERVICE_KEY: key,
    TOURNAMENTS_ENABLED: 'false', REVIEW_SWEEP_ENABLED: 'false', ROOM_RETENTION_REAPER_ENABLED: 'false',
    ENABLE_STARTUP_FRITZ_WARMUP: 'false' };
  assertNotProductionSupabase('forfeit boot child', { env, argv: [] });
  const child = spawn(process.execPath, ['dist/index.js'], { cwd: path.resolve(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (b) => { output += b; }); child.stderr.on('data', (b) => { output += b; });
  try {
    let started = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { if ((await fetch('http://127.0.0.1:55442/api/health')).ok) { started = true; break; } } catch {}
      if (child.exitCode !== null) throw new Error(output);
      await wait(200);
    }
    assert.ok(started, output);
    await wait(21000); // observe the real boot catch-up, not just listen()
    assert.equal(child.exitCode, null, output);
    assert.match(output, /rating_context.*does not exist|column.*rating_context/);
    process.env.SUPABASE_URL = 'http://127.0.0.1:55443';
    process.env.SUPABASE_SERVICE_KEY = key;
    const { insertRankedGameIdempotent } = require('../dist/ranking/insertRankedGameIdempotent');
    await assert.rejects(() => insertRankedGameIdempotent({
      playerId: '11111111-1111-4111-8111-111111111111', opponentId: '00000000-0000-0000-0000-000000000001',
      playerScore: 40, opponentScore: 20, gameType: 'multiplayer', ratingBefore: 1500, rdBefore: 200,
      playedAt: new Date().toISOString(), ratingTreatment: 'disconnect_forfeit', completionCause: 'disconnect_timeout',
      opponentRating: 1700, opponentRd: 50, outcome: 'loss', source: { sourceType: 'live_room', sourceMatchId: 'premigration-fail-closed' },
    }), /rating_context/);
    assert.equal(sql('select count(*) from ranked_games where rating_after is not null'), beforeGames);
    assert.equal(sql('select count(*) from rating_periods'), beforePeriods);
    console.log(JSON.stringify({ premigrationBoot: 'PASS', httpHealth: 200, bootCatchUp: 'failed closed: missing rating_context', ratingWrites: 0, disconnectInsert: 'failed closed' }));
  } finally {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited; clearTimeout(killTimer); gateway.closeAllConnections(); await new Promise((resolve) => gateway.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
