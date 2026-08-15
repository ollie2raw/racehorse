import fs from 'node:fs/promises';
import path from 'node:path';
import { test as setup } from '@playwright/test';
import {
  createEphemeralUser,
  getStorageKey,
  signInEphemeralUser,
  type EphemeralUser,
} from './setup/qaUserProvisioning.js';

const authDir = path.resolve(process.cwd(), '.auth');
const idsPath = path.join(authDir, 'e2e-user-ids.json');

async function createStorageState(
  browser: import('@playwright/test').Browser,
  user: EphemeralUser,
  fileName: string,
): Promise<void> {
  const { url, session } = await signInEphemeralUser(user);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.evaluate(
      ({ storageKey, authSession }) => {
        window.localStorage.setItem(storageKey, JSON.stringify(authSession));
      },
      {
        storageKey: getStorageKey(url),
        authSession: session,
      },
    );
    await context.storageState({ path: path.join(authDir, fileName) });
  } finally {
    await context.close();
  }
}

setup('provision namespaced authenticated E2E users', async ({ browser }) => {
  await fs.mkdir(authDir, { recursive: true });
  const host = await createEphemeralUser();
  let guest: EphemeralUser | null = null;
  try {
    guest = await createEphemeralUser();
    await createStorageState(browser, host, 'host.json');
    await createStorageState(browser, guest, 'guest.json');
    await fs.writeFile(
      idsPath,
      JSON.stringify({ hostId: host.id, guestId: guest.id }, null, 2),
      'utf8',
    );
  } catch (error) {
    if (guest) await deleteUserQuietly(guest.id);
    await deleteUserQuietly(host.id);
    throw error;
  }
});

async function deleteUserQuietly(id: string): Promise<void> {
  try {
    const { deleteEphemeralUser } = await import('./setup/qaUserProvisioning.js');
    await deleteEphemeralUser(id);
  } catch {
    // Preserve the original setup failure; teardown reports cleanup failures separately.
  }
}
