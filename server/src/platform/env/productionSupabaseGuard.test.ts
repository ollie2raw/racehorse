import { describe, expect, it } from 'vitest';
import {
  assertNotProductionSupabase,
  findProductionSupabaseVars,
  isHostedProduction,
  supabaseRefFromKey,
  supabaseRefFromUrl,
} from './productionSupabaseGuard';

const PROD = 'fisfadjqllojdzibcdfx';
const DEV = 'nwodvcmlmailtgjblphu';
const jwt = (claims: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

describe('production Supabase guard (B4)', () => {
  it('reads the project ref from URLs and legacy JWT keys', () => {
    expect(supabaseRefFromUrl(`https://${PROD}.supabase.co/`)).toBe(PROD);
    expect(supabaseRefFromUrl(`https://${PROD}.pooler.supabase.com`)).toBe(PROD);
    expect(supabaseRefFromUrl('http://127.0.0.1:54321')).toBeNull();
    expect(supabaseRefFromUrl('not a url')).toBeNull();
    expect(supabaseRefFromKey(jwt({ ref: PROD, role: 'service_role' }))).toBe(PROD);
    expect(supabaseRefFromKey('sb_secret_abc')).toBeNull();
    expect(supabaseRefFromKey('stub')).toBeNull();
  });

  it('names every var pointing at production, URL or key', () => {
    expect(
      findProductionSupabaseVars({
        SUPABASE_URL: `https://${DEV}.supabase.co`,
        SUPABASE_SERVICE_KEY: jwt({ ref: PROD, role: 'service_role' }),
        VITE_SUPABASE_URL: `https://${PROD}.supabase.co`,
      }),
    ).toEqual(['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_KEY']);
  });

  it('refuses production, allows dev, stubs and an empty env', () => {
    expect(() => assertNotProductionSupabase('t', { env: { SUPABASE_URL: `https://${PROD}.supabase.co` }, argv: [] })).toThrow(
      /refusing to run against the PRODUCTION Supabase project \(SUPABASE_URL\)/,
    );
    expect(() =>
      assertNotProductionSupabase('t', {
        env: { SUPABASE_URL: `https://${DEV}.supabase.co`, SUPABASE_SERVICE_KEY: jwt({ ref: DEV }) },
        argv: [],
      }),
    ).not.toThrow();
    expect(() => assertNotProductionSupabase('t', { env: { SUPABASE_URL: 'https://stub.supabase.co' }, argv: [] })).not.toThrow();
    expect(() => assertNotProductionSupabase('t', { env: {}, argv: [] })).not.toThrow();
  });

  it('a deliberate production run opts in by flag or env', () => {
    const env = { SUPABASE_URL: `https://${PROD}.supabase.co` };
    expect(() => assertNotProductionSupabase('t', { env, argv: ['--allow-production'] })).not.toThrow();
    expect(() =>
      assertNotProductionSupabase('t', { env: { ...env, RACEHORSE_ALLOW_PRODUCTION_SUPABASE: '1' }, argv: [] }),
    ).not.toThrow();
    expect(() =>
      assertNotProductionSupabase('t', { env: { ...env, RACEHORSE_ALLOW_PRODUCTION_SUPABASE: '0' }, argv: [] }),
    ).toThrow();
  });

  it('the deployed server is recognised by any one of its markers', () => {
    expect(isHostedProduction({ NODE_ENV: 'production' })).toBe(true);
    expect(isHostedProduction({ RENDER: 'true' })).toBe(true);
    expect(isHostedProduction({ VERCEL: '1' })).toBe(true);
    expect(isHostedProduction({ NODE_ENV: 'development' })).toBe(false);
    expect(isHostedProduction({})).toBe(false);
  });
});
