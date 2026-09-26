import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { MobileApiResponse, MobileFixtureDocument, MobileFixtureOverlay, MobileFixtureStateId } from './schema';

function readFixture<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as T;
}

const baseJson = readFixture<Omit<MobileFixtureDocument, 'stateId' | 'route' | 'expected'>>('./base.v1.json');
const overlays = [
  './states/home-not-played.v1.json',
  './states/home-completed.v1.json',
  './states/solo-empty.v1.json',
  './states/solo-populated.v1.json',
  './states/solo-journey-locked.v1.json',
].map((path) => readFixture<MobileFixtureOverlay>(path));

function responseKey(response: MobileApiResponse): string {
  return `${response.method} ${response.path}`;
}

export function loadMobileFixture(stateId: MobileFixtureStateId): MobileFixtureDocument {
  const overlay = overlays.find((candidate) => candidate.stateId === stateId);
  if (!overlay) throw new Error(`Unknown mobile fixture: ${stateId}`);
  if (baseJson.schemaVersion !== 1 || overlay.schemaVersion !== 1) {
    throw new Error(`Unsupported mobile fixture schema for ${stateId}`);
  }
  if (!overlay.route.startsWith('/') || !Array.isArray(overlay.expected?.visibleText) ||
    !Number.isFinite(Date.parse(baseJson.clock)) || baseJson.auth?.bearer !== 'e2e-daily-fritz' ||
    !baseJson.auth.userId || !baseJson.profile?.username ||
    !Number.isFinite(baseJson.profile.rating) || !Array.isArray(baseJson.profile.friends)) {
    throw new Error(`Invalid mobile fixture document for ${stateId}`);
  }
  for (const localStorage of [baseJson.localStorage, overlay.localStorage ?? {}]) {
    if (Object.values(localStorage).some((value) => typeof value !== 'string')) {
      throw new Error(`Invalid localStorage seed in ${stateId}`);
    }
  }
  const responses = new Map<string, MobileApiResponse>();
  for (const response of [...baseJson.apiResponses, ...overlay.apiResponses] as MobileApiResponse[]) {
    if (!response.path.startsWith('/api/') || ![200, 201, 204, 400, 401, 403, 404, 409, 500].includes(response.status)) {
      throw new Error(`Invalid API response in ${stateId}: ${responseKey(response)}`);
    }
    responses.set(responseKey(response), response);
  }
  return {
    schemaVersion: 1,
    stateId,
    route: overlay.route,
    clock: baseJson.clock,
    timezone: 'America/Los_Angeles',
    auth: { userId: baseJson.auth.userId, bearer: 'e2e-daily-fritz' },
    profile: baseJson.profile,
    apiResponses: [...responses.values()],
    localStorage: { ...baseJson.localStorage, ...overlay.localStorage },
    socketScript: overlay.socketScript,
    expected: overlay.expected,
  };
}

export async function installMobileFixture(page: Page, stateId: MobileFixtureStateId) {
  const fixture = loadMobileFixture(stateId);
  const unexpectedApiCalls: string[] = [];
  const seenApiCalls: string[] = [];
  const responses = new Map(fixture.apiResponses.map((response) => [responseKey(response), response]));

  // Must precede navigation; the real components and hooks own all rendering.
  await page.clock.setFixedTime(new Date(fixture.clock));
  await page.addInitScript((seed) => {
    for (const [key, value] of Object.entries(seed.localStorage)) window.localStorage.setItem(key, value);
    window.localStorage.setItem('racehorse_e2e_user_id', seed.userId);
    window.localStorage.setItem('racehorse_e2e_bearer', seed.bearer);
    window.localStorage.setItem('racehorse_mobile_visual_identity_v1', JSON.stringify({ userId: seed.userId, ...seed.profile }));
  }, { localStorage: fixture.localStorage, userId: fixture.auth.userId, bearer: fixture.auth.bearer, profile: fixture.profile });

  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname}${url.search}`;
    const response = responses.get(key);
    seenApiCalls.push(key);
    if (!response) {
      unexpectedApiCalls.push(key);
      await route.fulfill({ status: 599, contentType: 'application/json', body: JSON.stringify({ error: `Unmatched mobile fixture API: ${key}` }) });
      return;
    }
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });

  return {
    fixture,
    seenApiCalls,
    assertNoUnexpectedApiCalls() {
      expect(unexpectedApiCalls, `Unmatched API calls in ${stateId}`).toEqual([]);
    },
    assertApiUsed(path: string) {
      expect(seenApiCalls, `Expected real loader call for ${path}`).toContain(`GET ${path}`);
    },
  };
}
