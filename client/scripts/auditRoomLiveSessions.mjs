/**
 * Production audit: room_live_sessions writes + cleanup.
 * Usage: node client/scripts/auditRoomLiveSessions.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEnvPath = resolve(__dirname, '../../server/.env');

function loadServerEnv() {
  const raw = readFileSync(serverEnvPath, 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

async function supabaseQuery(env, path) {
  const url = new URL(path, env.SUPABASE_URL);
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function fetchLiveSessions(env, { roomCode, limit = 20 } = {}) {
  let path =
    '/rest/v1/room_live_sessions?select=room_code,match_id,status,source_type,game_state_sequence,updated_at,created_at,participant_user_ids&order=updated_at.desc';
  if (roomCode) {
    path += `&room_code=eq.${encodeURIComponent(roomCode)}`;
  } else {
    path += `&limit=${limit}`;
  }
  return supabaseQuery(env, path);
}

async function fetchMatchLog(env, matchId) {
  const path = `/rest/v1/room_match_logs?select=match_id,room_code,status,archived_at&match_id=eq.${encodeURIComponent(matchId)}&limit=1`;
  const rows = await supabaseQuery(env, path);
  return rows?.[0] ?? null;
}

async function openMultiplayerPrivate(page) {
  const navMultiplayer = page.getByRole('button', { name: 'Multiplayer', exact: true });
  if (await navMultiplayer.count()) await navMultiplayer.click();
  await page.getByRole('tab', { name: 'Private', exact: true }).click();
  await page.getByRole('heading', { name: /Private Match/i }).waitFor({ timeout: 45_000 });
  const connectBtn = page.getByRole('button', { name: /Connect to Server/i });
  if (await connectBtn.count()) {
    await connectBtn.click();
    await page.getByRole('button', { name: /^Create lobby/i }).waitFor({ timeout: 90_000 });
  }
}

async function runPrivateMatch() {
  const browser = await chromium.launch({ headless: true });
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const guestCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  for (const ctx of [hostCtx, guestCtx]) {
    await ctx.addInitScript(() => {
      localStorage.setItem('hasSeenWelcome', '1');
      const id = `qa-live-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(
        'racehorse_guest_identity_v1',
        JSON.stringify({ userId: id, username: `QA${id.slice(-4)}` }),
      );
    });
  }
  const baseUrl = process.env.QA_BASE_URL || 'https://playracehorse.com';
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  await host.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await guest.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await host.waitForTimeout(2500);
  await guest.waitForTimeout(2500);

  await openMultiplayerPrivate(host);
  await host.getByRole('button', { name: 'Create lobby', exact: true }).last().click();
  await host.getByText('Your room code', { exact: false }).waitFor({ timeout: 45_000 });
  const roomCode = (await host.locator('.pml-roomcode-bar-code').first().textContent())?.trim().toUpperCase();
  if (!roomCode) throw new Error('no room code');

  await openMultiplayerPrivate(guest);
  await guest.getByRole('tab', { name: 'Join lobby' }).click();
  await guest.getByPlaceholder('ROOM CODE').fill(roomCode);
  await guest.getByRole('button', { name: /^Join$/i }).click();
  await guest.getByText('Your room code', { exact: false }).waitFor({ timeout: 45_000 });

  await host.getByRole('button', { name: /Start Match/i }).click();
  await host.waitForTimeout(5000);

  await browser.close();
  return roomCode;
}

async function main() {
  const env = loadServerEnv();
  const renderHealth = await fetch('https://racehorse.onrender.com/health').then((r) => r.json());

  const beforeAll = await fetchLiveSessions(env, { limit: 30 });
  const tableExists = Array.isArray(beforeAll);

  const report = {
    renderRelease: renderHealth.release?.slice(0, 7),
    tableQueryable: tableExists,
    rowsBefore: tableExists ? beforeAll.length : null,
    recentBefore: tableExists
      ? beforeAll.map((r) => ({
          room_code: r.room_code,
          status: r.status,
          source_type: r.source_type,
          seq: r.game_state_sequence,
          updated_at: r.updated_at,
        }))
      : null,
  };

  if (!tableExists) {
    console.log(JSON.stringify({ ok: false, error: 'room_live_sessions not queryable', ...report }, null, 2));
    process.exit(1);
  }

  const roomCode = await runPrivateMatch();
  report.productionMatchRoomCode = roomCode;

  // Allow debounced persist (75ms) + network round trip
  await new Promise((r) => setTimeout(r, 3000));

  const matchRow = await fetchLiveSessions(env, { roomCode });
  report.matchRowAfterStart = matchRow?.[0]
    ? {
        room_code: matchRow[0].room_code,
        match_id: matchRow[0].match_id,
        status: matchRow[0].status,
        source_type: matchRow[0].source_type,
        game_state_sequence: matchRow[0].game_state_sequence,
        updated_at: matchRow[0].updated_at,
        participant_count: matchRow[0].participant_user_ids?.length ?? 0,
      }
    : null;

  const terminalRows = beforeAll.filter((r) => r.status === 'game_over' || r.status === 'abandoned');
  report.terminalRowsStillInLiveTable = terminalRows.length;
  report.sampleTerminalRows = terminalRows.slice(0, 5).map((r) => ({
    room_code: r.room_code,
    status: r.status,
    updated_at: r.updated_at,
  }));

  if (matchRow?.[0]?.match_id) {
    report.archivedMatchLog = await fetchMatchLog(env, matchRow[0].match_id);
  }

  const statusBreakdown = {};
  for (const row of beforeAll) {
    statusBreakdown[row.status] = (statusBreakdown[row.status] ?? 0) + 1;
  }
  report.statusBreakdownInRecent30 = statusBreakdown;

  report.ok = Boolean(report.matchRowAfterStart && report.matchRowAfterStart.status === 'playing');
  report.findings = [];
  if (!report.matchRowAfterStart) {
    report.findings.push('No room_live_sessions row found after private match start');
  } else if (report.matchRowAfterStart.status !== 'playing') {
    report.findings.push(`Row exists but status=${report.matchRowAfterStart.status} (expected playing)`);
  }
  if (report.terminalRowsStillInLiveTable > 0) {
    report.findings.push(
      `${report.terminalRowsStillInLiveTable} terminal rows still in room_live_sessions (cleanup may be unwired)`,
    );
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[auditRoomLiveSessions] FAILED', err);
  process.exit(1);
});
