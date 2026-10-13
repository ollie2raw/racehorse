import { describe, expect, it } from 'vitest';
import {
  DEV_SUPABASE_REF,
  PRODUCTION_SERVER_URL,
  PRODUCTION_SUPABASE_REF,
  PRODUCTION_SUPABASE_URL,
  scanBundleText,
  validateIosReleaseEnv,
} from './iosReleaseGuard.mjs';

/** An unsigned JWT with the given payload — the guard only reads claims. */
function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.c2lnbmF0dXJlLXBsYWNlaG9sZGVy`;
}

const PROD_ANON = jwt({ iss: 'supabase', ref: PRODUCTION_SUPABASE_REF, role: 'anon' });

const goodEnv = {
  VITE_SERVER_URL: PRODUCTION_SERVER_URL,
  VITE_SUPABASE_URL: PRODUCTION_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: PROD_ANON,
  VITE_POSTHOG_KEY: 'phc_abcdefghijklmnopqrstuvwxyz0123',
  VITE_SENTRY_DSN: 'https://abc123@o4511656845312000.ingest.us.sentry.io/1234567',
  VITE_ENABLE_TOURNAMENTS: 'false',
};

describe('validateIosReleaseEnv', () => {
  it('accepts the expected production configuration', () => {
    expect(validateIosReleaseEnv(goodEnv)).toEqual([]);
    expect(validateIosReleaseEnv({ ...goodEnv, VITE_SERVER_URL: `${PRODUCTION_SERVER_URL}/` })).toEqual([]);
  });

  it('rejects a localhost game server', () => {
    const problems = validateIosReleaseEnv({ ...goodEnv, VITE_SERVER_URL: 'http://localhost:3001' });
    expect(problems.join('\n')).toMatch(/VITE_SERVER_URL must be/);
    expect(problems.join('\n')).toMatch(/local address/);
  });

  it('rejects a missing server URL (native would fall back to the WebView origin)', () => {
    const { VITE_SERVER_URL: _omit, ...rest } = goodEnv;
    expect(validateIosReleaseEnv(rest).join('\n')).toMatch(/VITE_SERVER_URL must be/);
  });

  it('rejects the dev Supabase project, by URL and by key', () => {
    const devUrl = validateIosReleaseEnv({ ...goodEnv, VITE_SUPABASE_URL: `https://${DEV_SUPABASE_REF}.supabase.co` });
    expect(devUrl.join('\n')).toMatch(/dev Supabase project/);
    const devKey = validateIosReleaseEnv({ ...goodEnv, VITE_SUPABASE_ANON_KEY: jwt({ ref: DEV_SUPABASE_REF, role: 'anon' }) });
    expect(devKey.join('\n')).toMatch(/belongs to project "nwodvcmlmailtgjblphu"/);
  });

  it('rejects a service-role key anywhere', () => {
    const service = jwt({ ref: PRODUCTION_SUPABASE_REF, role: 'service_role' });
    expect(validateIosReleaseEnv({ ...goodEnv, VITE_SUPABASE_ANON_KEY: service }).join('\n')).toMatch(/anon key/);
    expect(validateIosReleaseEnv({ ...goodEnv, VITE_SOMETHING: service }).join('\n')).toMatch(/service-role key/);
    expect(validateIosReleaseEnv({ ...goodEnv, VITE_SUPABASE_SERVICE_KEY: 'x' }).join('\n')).toMatch(/secrets must never/);
  });

  it('requires an explicit tournaments choice and production analytics/diagnostics', () => {
    const { VITE_ENABLE_TOURNAMENTS: _t, VITE_POSTHOG_KEY: _p, VITE_SENTRY_DSN: _s, ...rest } = goodEnv;
    const problems = validateIosReleaseEnv(rest).join('\n');
    expect(problems).toMatch(/VITE_ENABLE_TOURNAMENTS/);
    expect(problems).toMatch(/VITE_POSTHOG_KEY/);
    expect(problems).toMatch(/VITE_SENTRY_DSN/);
  });

  it('accepts an unset or https PostHog host and rejects anything else', () => {
    expect(validateIosReleaseEnv({ ...goodEnv, VITE_POSTHOG_HOST: '' })).toEqual([]);
    expect(validateIosReleaseEnv({ ...goodEnv, VITE_POSTHOG_HOST: 'https://eu.i.posthog.com' })).toEqual([]);
    expect(validateIosReleaseEnv({ ...goodEnv, VITE_POSTHOG_HOST: 'eu.i.posthog.com' }).join('\n')).toMatch(/VITE_POSTHOG_HOST/);
    expect(validateIosReleaseEnv({ ...goodEnv, VITE_POSTHOG_HOST: '/e' }).join('\n')).toMatch(/VITE_POSTHOG_HOST/);
  });

  it('rejects dev/e2e switches', () => {
    expect(validateIosReleaseEnv({ ...goodEnv, VITE_E2E_ADMIN_BYPASS: '1' }).join('\n')).toMatch(/VITE_E2E_ADMIN_BYPASS/);
  });

  it('rejects the unfinished spectator mode but allows it explicitly off', () => {
    expect(validateIosReleaseEnv({ ...goodEnv, VITE_ENABLE_SPECTATOR_MODE: 'true' }).join('\n')).toMatch(
      /VITE_ENABLE_SPECTATOR_MODE must not be set/,
    );
    expect(validateIosReleaseEnv({ ...goodEnv, VITE_ENABLE_SPECTATOR_MODE: 'false' })).toEqual([]);
  });
});

describe('scanBundleText', () => {
  const prodBundle = { name: 'dist/assets/index.js', text: `const s="${PRODUCTION_SERVER_URL}";const u="${PRODUCTION_SUPABASE_URL}";const k="${PROD_ANON}";` };

  it('passes a production-only bundle', () => {
    expect(scanBundleText([prodBundle])).toEqual([]);
  });

  it('flags dev, localhost and service-role content', () => {
    const service = jwt({ ref: PRODUCTION_SUPABASE_REF, role: 'service_role' });
    const problems = scanBundleText([
      prodBundle,
      { name: 'dist/assets/a.js', text: `fetch("http://localhost:3001/api");x="${DEV_SUPABASE_REF}";k="${service}"` },
    ]).join('\n');
    expect(problems).toMatch(/local URL/);
    expect(problems).toMatch(/dev Supabase/);
    expect(problems).toMatch(/service-role key/);
  });

  it('ignores the inert library defaults but not a configured local server', () => {
    const lib = { name: 'dist/assets/vendor.js', text: 'let i="http://localhost";const Js="http://localhost:9999";' };
    expect(scanBundleText([prodBundle, lib])).toEqual([]);
    const app = { name: 'dist/assets/app.js', text: 'const s="http://localhost:3001";const w="ws://127.0.0.1:3001"' };
    expect(scanBundleText([prodBundle, app]).length).toBe(2);
  });

  it('flags a bundle that never mentions production origins', () => {
    expect(scanBundleText([{ name: 'dist/index.html', text: '<html></html>' }]).length).toBe(2);
  });
});
