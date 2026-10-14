import { describe, expect, it } from 'vitest';
import { assertAutomatedPersistenceTarget } from './automatedPersistenceGuard';
import { PRODUCTION_SUPABASE_REFS } from './productionSupabaseGuard';

describe('automated persistence targets', () => {
  it('refuses production even when a manual production opt-in is inherited', () => {
    expect(() => assertAutomatedPersistenceTarget('QA', { env: { SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REFS[0]}.supabase.co`, RACEHORSE_ALLOW_PRODUCTION_SUPABASE: '1' } })).toThrow(/PRODUCTION/);
  });
  it('refuses arbitrary deployed app/API origins even with dev database credentials', () => {
    for (const url of ['https://racehorse.onrender.com', 'https://racehorsedoms.vercel.app', 'https://localhost.evil.test', 'file:///tmp/test']) {
      expect(() => assertAutomatedPersistenceTarget('QA', { env: { SUPABASE_URL: 'https://dev.supabase.co' }, urls: [url] })).toThrow(/loopback/);
    }
  });
  it('allows local apps/APIs backed by dev Supabase', () => {
    expect(() => assertAutomatedPersistenceTarget('QA', { env: { SUPABASE_URL: 'https://dev.supabase.co' }, urls: ['http://127.0.0.1:3001', 'http://localhost:5173', 'http://[::1]:3001'] })).not.toThrow();
  });
});
