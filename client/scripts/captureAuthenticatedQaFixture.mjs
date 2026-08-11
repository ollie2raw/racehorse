import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, '..');
const fixtureDir = path.resolve(clientRoot, '.auth');
const fixturePath = path.resolve(fixtureDir, 'daily-fritz-qa.json');

const appUrl = (process.env.DAILY_FRITZ_QA_APP_URL || 'http://127.0.0.1:4173').trim().replace(/\/$/, '');
const apiUrl = (process.env.DAILY_FRITZ_QA_API_URL || 'http://127.0.0.1:3001').trim().replace(/\/$/, '');
const browserChannel = process.env.DAILY_FRITZ_QA_BROWSER_CHANNEL?.trim() || 'chrome';
const captureTimeoutMs = Number(process.env.DAILY_FRITZ_QA_CAPTURE_TIMEOUT_MS ?? 10 * 60 * 1000);
const approvedUserId = process.env.DAILY_FRITZ_QA_USER_ID?.trim() || '';
const approvedUsername = process.env.DAILY_FRITZ_QA_USERNAME?.trim().toLowerCase() || '';

function ensureApprovedQaIdentityConfigured() {
  if (!approvedUserId || !approvedUsername) {
    throw new Error(
      'Refusing to capture fixture without DAILY_FRITZ_QA_USER_ID and DAILY_FRITZ_QA_USERNAME.',
    );
  }
}

function ensureFixtureDir() {
  fs.mkdirSync(fixtureDir, { recursive: true });
}

function ensureFixtureIsIgnored() {
  try {
    execFileSync('git', ['check-ignore', '-q', fixturePath], {
      cwd: clientRoot,
      stdio: 'ignore',
    });
  } catch {
    throw new Error(`Refusing to capture fixture because ${fixturePath} is not git-ignored.`);
  }
}

function readAuthTokenState(pageState) {
  const entry =
    pageState.origins
      ?.flatMap((origin) => origin.localStorage ?? [])
      .find((item) => item.name.startsWith('sb-') && item.name.endsWith('-auth-token')) ?? null;
  if (!entry) return null;
  try {
    return JSON.parse(entry.value);
  } catch {
    return null;
  }
}

async function openSignInIfNeeded(page) {
  const signInButton = page.getByRole('button', { name: /sign in/i }).first();
  const visible = await signInButton.isVisible().catch(() => false);
  if (visible) {
    await signInButton.click();
  }
}

async function readSessionSummary(page) {
  return page.evaluate(() => {
    const authEntry = Object.keys(window.localStorage)
      .find((key) => key.startsWith('sb-') && key.endsWith('-auth-token')) ?? null;
    if (!authEntry) {
      return {
        signedIn: false,
        userId: null,
        username: null,
        email: null,
        expiresAt: null,
      };
    }
    const raw = window.localStorage.getItem(authEntry);
    if (!raw) {
      return {
        signedIn: false,
        userId: null,
        username: null,
        email: null,
        expiresAt: null,
      };
    }
    try {
      const parsed = JSON.parse(raw);
      const user = parsed?.user ?? null;
      const meta = user?.user_metadata ?? {};
      const username =
        typeof meta.username === 'string'
          ? meta.username
          : typeof meta.preferred_username === 'string'
            ? meta.preferred_username
            : null;
      return {
        signedIn: Boolean(user?.id && parsed?.access_token),
        userId: typeof user?.id === 'string' ? user.id : null,
        username: typeof username === 'string' ? username : null,
        email: typeof user?.email === 'string' ? user.email : null,
        expiresAt: Number.isFinite(Number(parsed?.expires_at)) ? Number(parsed.expires_at) : null,
      };
    } catch {
      return {
        signedIn: false,
        userId: null,
        username: null,
        email: null,
        expiresAt: null,
      };
    }
  });
}

function isApprovedQaUser(summary) {
  const userId = typeof summary.userId === 'string' ? summary.userId.trim() : '';
  return Boolean(summary?.signedIn) && userId === approvedUserId;
}

async function verifyApprovedProfileUsername(page, expectedUserId) {
  const result = await page.evaluate(async ({ baseUrl, username }) => {
    const authEntry = Object.keys(window.localStorage)
      .find((key) => key.startsWith('sb-') && key.endsWith('-auth-token')) ?? null;
    if (!authEntry) return { ok: false, status: 0, body: 'missing_auth_entry' };
    const raw = window.localStorage.getItem(authEntry);
    if (!raw) return { ok: false, status: 0, body: 'missing_auth_payload' };
    let token = null;
    try {
      token = JSON.parse(raw)?.access_token ?? null;
    } catch {
      token = null;
    }
    if (!token) return { ok: false, status: 0, body: 'missing_access_token' };
    const response = await fetch(`${baseUrl}/api/profile/${encodeURIComponent(username)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
    });
    const text = await response.text().catch(() => '');
    return {
      ok: response.ok,
      status: response.status,
      body: text.slice(0, 300),
    };
  }, { baseUrl: apiUrl, username: approvedUsername });
  if (!result.ok) {
    throw new Error(`GET /api/profile/${approvedUsername} verification failed (${result.status}).`);
  }
  const parsed = JSON.parse(result.body);
  const profileUserId = typeof parsed?.userId === 'string' ? parsed.userId.trim() : '';
  if (profileUserId !== expectedUserId) {
    throw new Error('Approved profile username does not belong to the signed-in QA user.');
  }
}

async function verifyDailyFritzToday(page) {
  const result = await page.evaluate(async ({ baseUrl }) => {
    const authEntry = Object.keys(window.localStorage)
      .find((key) => key.startsWith('sb-') && key.endsWith('-auth-token')) ?? null;
    if (!authEntry) return { ok: false, status: 0, body: 'missing_auth_entry' };
    const raw = window.localStorage.getItem(authEntry);
    if (!raw) return { ok: false, status: 0, body: 'missing_auth_payload' };
    let token = null;
    try {
      token = JSON.parse(raw)?.access_token ?? null;
    } catch {
      token = null;
    }
    if (!token) return { ok: false, status: 0, body: 'missing_access_token' };
    const response = await fetch(`${baseUrl}/api/daily-fritz/today`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
    });
    const text = await response.text().catch(() => '');
    return {
      ok: response.ok,
      status: response.status,
      body: text.slice(0, 300),
    };
  }, { baseUrl: apiUrl });
  if (!result.ok) {
    throw new Error(`GET /api/daily-fritz/today verification failed (${result.status}).`);
  }
}

async function waitForApprovedSignIn(page) {
  const deadline = Date.now() + captureTimeoutMs;
  while (Date.now() < deadline) {
    const summary = await readSessionSummary(page);
    if (isApprovedQaUser(summary)) {
      await verifyApprovedProfileUsername(page, summary.userId);
      return summary;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error('Timed out waiting for approved QA sign-in.');
}

async function main() {
  ensureApprovedQaIdentityConfigured();
  ensureFixtureDir();
  ensureFixtureIsIgnored();

  const browser = await chromium.launch({
    channel: browserChannel,
    headless: false,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  await context.addInitScript(() => {
    window.localStorage.setItem('hasSeenWelcome', '1');
  });

  const page = await context.newPage();

  try {
    await page.goto(`${appUrl}/daily-fritz`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Daily Fritz' }).waitFor({ state: 'visible', timeout: 20000 });
    await openSignInIfNeeded(page);

    console.log('Browser opened for manual QA sign-in.');
    console.log('Complete sign-in normally in the app. No credentials are read or logged by this script.');

    const summary = await waitForApprovedSignIn(page);
    if (!isApprovedQaUser(summary)) {
      throw new Error('Signed-in account is not the approved Daily Fritz QA user.');
    }

    await verifyDailyFritzToday(page);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Daily Fritz' }).waitFor({ state: 'visible', timeout: 20000 });
    const refreshedSummary = await readSessionSummary(page);
    if (!isApprovedQaUser(refreshedSummary)) {
      throw new Error('Authenticated QA session did not survive refresh.');
    }
    await verifyDailyFritzToday(page);

    const tempPath = `${fixturePath}.tmp`;
    await context.storageState({ path: tempPath });
    const savedState = JSON.parse(fs.readFileSync(tempPath, 'utf8'));
    const savedTokenState = readAuthTokenState(savedState);
    const savedUser = savedTokenState?.user ?? null;

    if (
      !savedUser?.id ||
      savedUser.id !== approvedUserId
    ) {
      fs.rmSync(tempPath, { force: true });
      throw new Error('Refusing to save fixture because the captured session is not the approved QA account.');
    }

    fs.renameSync(tempPath, fixturePath);
    console.log(`Saved authenticated QA fixture to ${fixturePath}.`);
    console.log('Verified: Daily Fritz signed in, /api/daily-fritz/today returned 200, refresh preserved auth.');
  } finally {
    await context.close();
    await browser.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
