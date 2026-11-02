import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock('./logger', () => ({ childLogger: () => logger, logger }));

const { ENV_SPECS, ENV_SPEC_BY_NAME, checkEnvironment, envValidationMode } = await import('./envSchema');
const { runBootEnvCheck } = await import('./envBootCheck');

const names = (env: Record<string, string>, production = false, level?: 'error' | 'warn') =>
  checkEnvironment(env, production)
    .filter((issue) => !level || issue.level === level)
    .map((issue) => issue.name);

describe('flags are checked against the way the code reads them', () => {
  it('flags TOURNAMENTS_ENABLED=1, which the code reads as OFF', () => {
    const issues = checkEnvironment({ TOURNAMENTS_ENABLED: '1' }, false);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ level: 'error', name: 'TOURNAMENTS_ENABLED' });
    expect(issues[0].message).toContain('OFF');
  });

  it('flags ROOM_RETENTION_REAPER_ENABLED=0, which the code reads as still ON', () => {
    const issues = checkEnvironment({ ROOM_RETENTION_REAPER_ENABLED: '0' }, false);
    expect(issues[0]).toMatchObject({ level: 'error', name: 'ROOM_RETENTION_REAPER_ENABLED' });
    expect(issues[0].message).toContain('ON');
  });

  it('flags a flag that only "1" turns on being given "true", and the reverse', () => {
    expect(names({ REVIEW_COMPLETION_REQUIRE_DURABLE: 'true' })).toEqual(['REVIEW_COMPLETION_REQUIRE_DURABLE']);
    expect(names({ REVIEW_COMPLETION_REQUIRE_DURABLE: '1' })).toEqual([]);
    expect(names({ FRITZ_CUP_ENABLED: 'TRUE' })).toEqual(['FRITZ_CUP_ENABLED']);
    expect(names({ ENABLE_SPECTATOR_MODE: 'yes' })).toEqual(['ENABLE_SPECTATOR_MODE']);
  });

  it('lets a word that means off through for a flag the code reads as off anyway, but not for one it leaves on', () => {
    // TOURNAMENTS_ENABLED=off: the author wanted off, the code reads it as off. No harm.
    expect(names({ TOURNAMENTS_ENABLED: 'off', MP_DEBUG: 'no', REVIEW_COMPLETION_REQUIRE_DURABLE: 'false' })).toEqual([]);
    // ROOM_RETENTION_REAPER_ENABLED=off: the author wanted off, the code leaves it ON. That is the dangerous one.
    expect(names({ ROOM_RETENTION_REAPER_ENABLED: 'off' })).toEqual(['ROOM_RETENTION_REAPER_ENABLED']);
  });

  it('accepts every value the code understands, and ignores an empty one', () => {
    expect(
      names({
        TOURNAMENTS_ENABLED: 'true', FRITZ_CUP_ENABLED: 'false', ROOM_RETENTION_REAPER_ENABLED: 'false', GHOST_DEFERRED_DRAIN_ENABLED: 'true',
        MP_DEBUG: 'TRUE', DEBUG_MP: '0', ENABLE_STARTUP_FRITZ_WARMUP: 'yes', MP_PRIVATE_CERT_MODE: '0', TOURNAMENT_SCHEDULER_ENABLED: '1', E2E_INSPECT: '',
      }),
    ).toEqual([]);
  });
});

describe('numbers, URLs and enums', () => {
  it('flags a number that would quietly become the default', () => {
    expect(names({ LIMIT_GAME_ACTION_MAX: '24O' })).toEqual(['LIMIT_GAME_ACTION_MAX']);
    expect(names({ LIMIT_GAME_ACTION_MAX: '240' })).toEqual([]);
    expect(names({ LIMIT_GAME_ACTION_MAX: '10.5' })).toEqual(['LIMIT_GAME_ACTION_MAX']);
  });

  it('flags out-of-range values: a limit of 0, a port too large', () => {
    expect(names({ LIMIT_ROOM_JOIN_MAX: '0' })).toEqual(['LIMIT_ROOM_JOIN_MAX']);
    expect(names({ PORT: '70000' })).toEqual(['PORT']);
    expect(names({ PORT: '3001' })).toEqual([]);
    expect(names({ ROOM_CLEANUP_GRACE_MS: '0' })).toEqual([]);
  });

  it('warns, not errors, when the code will clamp a value', () => {
    const issues = checkEnvironment({ TOURNAMENT_ORCHESTRATOR_LEASE_TTL_MS: '5000' }, false);
    expect(issues).toEqual([expect.objectContaining({ level: 'warn', name: 'TOURNAMENT_ORCHESTRATOR_LEASE_TTL_MS' })]);
    expect(names({ TOURNAMENT_ORCHESTRATOR_LEASE_TTL_MS: '120000' })).toEqual([]);
  });

  it('checks URLs and enums', () => {
    expect(names({ SUPABASE_URL: 'not a url' })).toEqual(['SUPABASE_URL']);
    expect(names({ SUPABASE_URL: 'https://abc.supabase.co' })).toEqual([]);
    expect(names({ NODE_ENV: 'staging' })).toEqual(['NODE_ENV']);
    expect(names({ NODE_ENV: 'production' })).toEqual([]);
    expect(names({ REQUEST_VALIDATION_MODE: 'strict' })).toEqual(['REQUEST_VALIDATION_MODE']);
  });
});

describe('a misspelt setting', () => {
  it('is flagged when it looks like one of ours but is not registered', () => {
    expect(names({ LIMIT_GAME_ACTION_MAXX: '10', TOURNAMENT_SCHEDULER_ENABELD: 'true' }, false, 'warn')).toEqual([
      'LIMIT_GAME_ACTION_MAXX',
      'TOURNAMENT_SCHEDULER_ENABELD',
    ]);
  });

  it('leaves the platform\'s own variables alone', () => {
    expect(names({ PATH: '/usr/bin', RENDER_SERVICE_ID: 'srv-1', RENDER_EXTERNAL_URL: 'https://x', npm_package_version: '1.0.0', HOME: '/root' })).toEqual([]);
  });
});

describe('production', () => {
  const GOOD = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_KEY: 'k', SENTRY_DSN: 'https://k@o.ingest.sentry.io/1', ADMIN_SECRET: 's', CLIENT_URL: 'https://playracehorse.com' };

  it('requires the Supabase settings', () => {
    expect(names({}, true, 'error').sort()).toEqual(['SUPABASE_SERVICE_KEY', 'SUPABASE_URL']);
    expect(names({}, false, 'error')).toEqual([]);
  });

  it('is clean when everything recommended is set', () => {
    expect(checkEnvironment(GOOD, true)).toEqual([]);
  });

  it('warns about what is missing but not fatal: errors, the admin secret, an allowed origin', () => {
    const issues = checkEnvironment({ SUPABASE_URL: GOOD.SUPABASE_URL, SUPABASE_SERVICE_KEY: 'k' }, true);
    expect(issues.every((issue) => issue.level === 'warn')).toBe(true);
    expect(issues.map((issue) => issue.name).sort()).toEqual(['ADMIN_SECRET', 'CORS_ALLOWED_ORIGINS', 'SENTRY_DSN']);
  });

  it('accepts CORS_ALLOWED_ORIGINS in place of CLIENT_URL', () => {
    const { CLIENT_URL: _unused, ...rest } = GOOD;
    expect(checkEnvironment({ ...rest, CORS_ALLOWED_ORIGINS: 'https://playracehorse.com' }, true)).toEqual([]);
  });

  it('warns when a development or test setting is switched on, and not when it is deliberately off', () => {
    expect(names({ ...GOOD, E2E_INSPECT: '1', SOFT_GAME_INVARIANTS: 'true', DAILY_FRITZ_MEMORY_STORE: '1' }, true)).toEqual(
      expect.arrayContaining(['E2E_INSPECT', 'SOFT_GAME_INVARIANTS', 'DAILY_FRITZ_MEMORY_STORE']),
    );
    expect(checkEnvironment({ ...GOOD, E2E_INSPECT: '0', MP_DEBUG: 'false', DEBUG_MP: 'off' }, true)).toEqual([]);
  });
});

describe('what a message may contain', () => {
  it('names the setting and the problem, never its value', () => {
    const secret = 'SUPER-SECRET-VALUE-123';
    const issues = checkEnvironment(
      { SUPABASE_URL: secret, LIMIT_GAME_ACTION_MAX: secret, TOURNAMENTS_ENABLED: secret, NODE_ENV: secret, LIMIT_TYPO_X: secret, ADMIN_SECRET: secret },
      false,
    );
    expect(issues.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(issues)).not.toContain('SECRET-VALUE');
  });
});

describe('the registry', () => {
  const SRC = dirname(fileURLToPath(import.meta.url));
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) out.push(path);
    }
    return out;
  };
  /** Names the server source reads, by file. envSchema.ts is the registry itself, so it is not a reader (except for its own mode switch below). */
  const readers = new Map<string, Set<string>>();
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file);
    if (rel === 'envSchema.ts') continue;
    const text = readFileSync(file, 'utf8');
    const found = [
      ...[...text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]),
      ...[...text.matchAll(/process\.env\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\]/g)].map((m) => m[1]),
      ...[...text.matchAll(/getEnv(?:Int|Bool)?\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g)].map((m) => m[1]),
    ];
    for (const name of found) {
      if (!readers.has(name)) readers.set(name, new Set());
      readers.get(name)!.add(rel);
    }
  }

  /**
   * Names read through a helper or a named constant (`process.env[name]`, `env[SOME_ENV]`) do not show up as `process.env.NAME`, so the scan above
   * cannot see them. This one takes every UPPER_SNAKE string literal in any file that reads the environment, and anything not registered has to
   * be said to be something else.
   */
  const NOT_ENV = new Set([
    'AUTHENTICATED_USER_ID_TTL_MS', // a constant in supabaseAuth.ts that is named in a comment
    'FRITZ_POLICY_VERSION', // a game-core constant named in a string
    'TRUSTED_PROXY', // trustedProxy.ts's export, named in a comment
  ]);
  const literalsInEnvFiles = new Map<string, string>();
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file);
    if (rel === 'envSchema.ts') continue;
    const text = readFileSync(file, 'utf8');
    if (!/process\.env|\benv\[|\benv\.|getEnv|ENV\b/.test(text)) continue;
    for (const match of text.matchAll(/['"`]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)['"`]/g)) literalsInEnvFiles.set(match[1], rel);
  }

  it('also finds names read through helpers and constants, so none is left undescribed', () => {
    const unknown = [...literalsInEnvFiles].filter(([name]) => !ENV_SPEC_BY_NAME.has(name) && !NOT_ENV.has(name)).map(([name, file]) => `${name} (${file})`);
    expect(unknown, `Register these in ENV_SPECS, or add them to NOT_ENV if they are not environment variables: ${unknown.join(', ')}`).toEqual([]);
  });

  it('lists every variable the server reads, so a new setting has to be described', () => {
    const unregistered = [...readers.keys()].filter((name) => !ENV_SPEC_BY_NAME.has(name)).sort();
    expect(unregistered, `Add these to ENV_SPECS in envSchema.ts, saying how each is read: ${unregistered.join(', ')}`).toEqual([]);
  });

  it('has no entry that nothing reads any more', () => {
    // ENV_VALIDATION_MODE is read inside envSchema.ts itself (envValidationMode), which the scan above skips.
    const readByRegistryItself = new Set(['ENV_VALIDATION_MODE']);
    const dead = ENV_SPECS.map((spec) => spec.name).filter((name) => !readers.has(name) && !literalsInEnvFiles.has(name) && !readByRegistryItself.has(name));
    expect(dead, `No source file reads these any more; remove them from ENV_SPECS: ${dead.join(', ')}`).toEqual([]);
  });

  it('has no duplicate names and a description for every entry', () => {
    expect(new Set(ENV_SPECS.map((spec) => spec.name)).size).toBe(ENV_SPECS.length);
    expect(ENV_SPECS.filter((spec) => spec.doc.trim().length < 10)).toEqual([]);
  });

  it('is looking at the server source, so a clean result means something', () => {
    expect(readers.size).toBeGreaterThan(40);
    expect(readers.has('SUPABASE_URL')).toBe(true);
  });
});

describe('the example configuration', () => {
  const EXAMPLE = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.example');
  const entries = readFileSync(EXAMPLE, 'utf8')
    .split('\n')
    .map((line) => /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => [match[1], match[2].replace(/^["']|["']$/g, '')] as const);

  it('documents only settings the server reads', () => {
    const unknown = entries.map(([name]) => name).filter((name) => !ENV_SPEC_BY_NAME.has(name));
    expect(unknown, `.env.example lists settings nothing reads: ${unknown.join(', ')}`).toEqual([]);
  });

  it('has no value that would be misread (placeholders like your_sentry_dsn are skipped)', () => {
    const env = Object.fromEntries(entries.filter(([, value]) => !value.startsWith('your_')));
    expect(checkEnvironment(env, false).filter((issue) => issue.level === 'error')).toEqual([]);
  });
});

describe('the boot check', () => {
  beforeEach(() => Object.values(logger).forEach((fn) => fn.mockReset()));

  it('is report-only by default: a misread setting is logged and nothing is thrown', () => {
    const issues = runBootEnvCheck({ TOURNAMENTS_ENABLED: '1', NODE_ENV: 'development' });
    expect(issues).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('"1"');
  });

  it('never uses a field name pino owns: `level` would replace its numeric level in the log line', () => {
    runBootEnvCheck({ TOURNAMENTS_ENABLED: '1', LIMIT_GAME_ACTION_MAX: '24O' });
    for (const call of [...logger.error.mock.calls, ...logger.warn.mock.calls]) {
      expect(Object.keys(call[0] as object)).not.toContain('level');
    }
    expect(logger.error.mock.calls[0][0]).toMatchObject({ setting: 'TOURNAMENTS_ENABLED', severity: 'error' });
  });

  it('says so when the environment is clean', () => {
    expect(runBootEnvCheck({ NODE_ENV: 'development' })).toEqual([]);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('refuses to boot on an error in enforce mode, naming the settings and no values', () => {
    expect(() => runBootEnvCheck({ ENV_VALIDATION_MODE: 'enforce', TOURNAMENTS_ENABLED: 'yes-please', LIMIT_GAME_ACTION_MAX: '0' })).toThrow(
      /Environment validation failed.*TOURNAMENTS_ENABLED.*LIMIT_GAME_ACTION_MAX/,
    );
    try {
      runBootEnvCheck({ ENV_VALIDATION_MODE: 'enforce', TOURNAMENTS_ENABLED: 'yes-please' });
    } catch (error) {
      expect(String(error)).not.toContain('yes-please');
    }
  });

  it('does not refuse to boot on warnings alone, even in enforce mode', () => {
    expect(() => runBootEnvCheck({ ENV_VALIDATION_MODE: 'enforce', NODE_ENV: 'production', SUPABASE_URL: 'https://a.supabase.co', SUPABASE_SERVICE_KEY: 'k' })).not.toThrow();
  });

  it('does nothing when switched off', () => {
    expect(runBootEnvCheck({ ENV_VALIDATION_MODE: 'off', TOURNAMENTS_ENABLED: '1' })).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('defaults to warn, including for an unrecognised value', () => {
    expect(envValidationMode({})).toBe('warn');
    expect(envValidationMode({ ENV_VALIDATION_MODE: 'strictest' })).toBe('warn');
    expect(envValidationMode({ ENV_VALIDATION_MODE: 'enforce' })).toBe('enforce');
  });
});
