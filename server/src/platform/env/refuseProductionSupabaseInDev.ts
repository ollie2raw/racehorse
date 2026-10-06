import '../../loadEnv';
import { assertNotProductionSupabase, isHostedProduction } from './productionSupabaseGuard';

// Imported first by src/index.ts, so a local server refuses production before
// any timer, socket or Supabase call starts. The deployed server skips it.
if (!isHostedProduction(process.env)) {
  assertNotProductionSupabase('server');
}
