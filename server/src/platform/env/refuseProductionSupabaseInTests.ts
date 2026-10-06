import path from 'node:path';
import { readEnvFile } from '../../envFile';
import { assertNotProductionSupabase } from './productionSupabaseGuard';

// vitest setupFiles (B4): the server suite refuses to run when server/.env or
// the shell points at production, because tests that reach Supabase would
// write there. Reads server/.env without applying it, so test env is unchanged.
const serverEnv = readEnvFile(path.resolve(__dirname, '../../../.env'));
assertNotProductionSupabase('server tests', { env: { ...serverEnv, ...process.env } });
