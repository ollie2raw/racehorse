import fs from 'node:fs/promises';
import path from 'node:path';
import { test as teardown } from '@playwright/test';
import { deleteEphemeralUser, describeSupabaseError, getSupabaseAdminClient } from './setup/qaUserProvisioning.js';

const idsPath = path.resolve(process.cwd(), '.auth', 'e2e-user-ids.json');

teardown('delete namespaced authenticated E2E users', async () => {
  let raw: string;
  try {
    raw = await fs.readFile(idsPath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  const ids = JSON.parse(raw) as { hostId?: unknown; guestId?: unknown };
  const failures: string[] = [];
  try {
    const admin = getSupabaseAdminClient();
    for (const id of [ids.hostId, ids.guestId]) {
      if (typeof id !== 'string') continue;
      try {
        await deleteEphemeralUser(id, admin);
      } catch (error) {
        failures.push(`${id}: ${describeSupabaseError(error)}`);
      }
    }
  } finally {
    await fs.rm(idsPath, { force: true });
    await fs.rm(path.resolve(process.cwd(), '.auth', 'host.json'), { force: true });
    await fs.rm(path.resolve(process.cwd(), '.auth', 'guest.json'), { force: true });
  }
  if (failures.length > 0) {
    throw new Error(`Unable to delete all ephemeral E2E users:\n${failures.join('\n')}`);
  }
});
