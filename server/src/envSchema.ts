/**
 * Every environment variable the server reads, how it is read, and a boot-time check that a value will mean what its author intended
 * (roadmap 3.10).
 *
 * The problem this solves is silent misreading. The server reads settings in half a dozen conventions: a flag that is on only for the exact
 * text `true`, one that is off only for the exact text `false`, one that is on only for `1`, one that accepts `1` or `true` in any case, and
 * numbers that fall back to a default when they do not parse. So `TOURNAMENTS_ENABLED=1` is quietly OFF, `ROOM_RETENTION_REAPER_ENABLED=0`
 * is quietly still ON, and `LIMIT_GAME_ACTION_MAX=24O` becomes the default without a word. Each entry below records its own convention so
 * the checker can say so before it matters.
 *
 * This file is also the list: a test fails if the source reads a variable that is not registered here (a new setting must be documented) or if
 * an entry is no longer read anywhere (a dead entry). It never prints a value, only the name and what is wrong.
 */

export type EnvKind =
  /** On only when the value is exactly "true". */
  | { kind: 'flagTrue' }
  /** Off only when the value is exactly "false"; anything else, including 0, off and no, leaves it ON. */
  | { kind: 'flagUnlessFalse' }
  /** On only when the value is exactly "1". */
  | { kind: 'flagOne' }
  /** On for "1" or "true" in any case (config.ts getEnvBool); everything else is off. */
  | { kind: 'flagBool' }
  /** On for "true", "1" or "yes" in any case (scheduled/dailyWarmup isTruthyEnvFlag). */
  | { kind: 'flagTruthy' }
  /** A whole number. `clamp` is where the code itself clamps it, so a value outside is quietly changed. */
  | { kind: 'int'; min?: number; max?: number; clamp?: [number, number] }
  | { kind: 'url' }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'string' }
  | { kind: 'secret' };

export type EnvSpec = EnvKind & {
  name: string;
  doc: string;
  /** Where it matters: `runtime` is operational, `dev` and `test` are for development and CI and are suspicious in production. */
  scope: 'runtime' | 'dev' | 'test' | 'platform';
};

const runtime = (name: string, doc: string, kind: EnvKind): EnvSpec => ({ name, doc, scope: 'runtime', ...kind });
const dev = (name: string, doc: string, kind: EnvKind): EnvSpec => ({ name, doc, scope: 'dev', ...kind });
const test = (name: string, doc: string, kind: EnvKind): EnvSpec => ({ name, doc, scope: 'test', ...kind });
const platform = (name: string, doc: string, kind: EnvKind): EnvSpec => ({ name, doc, scope: 'platform', ...kind });

const limit = (name: string, doc: string): EnvSpec => runtime(name, doc, { kind: 'int', min: 1 });

export const ENV_SPECS: readonly EnvSpec[] = [
  // ── Core ──
  runtime('NODE_ENV', 'production turns on the strict boot checks and the production-safe error messages.', { kind: 'enum', values: ['development', 'test', 'production'] }),
  platform('PORT', 'The port the HTTP and socket server listens on (Render sets it).', { kind: 'int', min: 1, max: 65_535 }),
  runtime('SUPABASE_URL', 'The Supabase project URL. Required in production.', { kind: 'url' }),
  runtime('SUPABASE_SERVICE_KEY', 'The Supabase service-role key. Required in production.', { kind: 'secret' }),
  runtime('SUPABASE_POOLER_URL', 'Optional pooled database connection URL.', { kind: 'url' }),
  runtime('SENTRY_DSN', 'Where errors are reported. Without it production errors are invisible.', { kind: 'url' }),
  platform('RENDER_GIT_COMMIT', 'The deployed commit (Render sets it).', { kind: 'string' }),
  platform('RENDER_INSTANCE_ID', 'This instance (Render sets it); part of the tournament lease owner id.', { kind: 'string' }),
  platform('HOSTNAME', 'The host name; part of the tournament lease owner id.', { kind: 'string' }),
  runtime('CORS_ALLOWED_ORIGINS', 'Comma-separated origins allowed to call the API from a browser.', { kind: 'string' }),
  runtime('CLIENT_URL', 'The deployed web app URL, so CORS matches it.', { kind: 'url' }),
  runtime('SERVER_URL', 'This server\'s own public URL.', { kind: 'url' }),

  // ── Secrets ──
  runtime('ADMIN_SECRET', 'Gates the admin endpoints. Without it they deny everyone.', { kind: 'secret' }),
  runtime('DAILY_PUZZLE_CRON_SECRET', 'Gates the cron endpoints.', { kind: 'secret' }),
  runtime('POST_GAME_REVIEW_COHORT_USER_IDS', 'Comma-separated user ids in the staged post-game review cohort.', { kind: 'string' }),
  runtime('SUPABASE_ANON_KEY', 'Only inspected, to refuse a production Supabase project in tooling and tests.', { kind: 'secret' }),
  runtime('VITE_SUPABASE_URL', 'Only inspected, to refuse a production Supabase project in tooling and tests.', { kind: 'url' }),
  runtime('VITE_SUPABASE_ANON_KEY', 'Only inspected, to refuse a production Supabase project in tooling and tests.', { kind: 'secret' }),
  runtime('GUEST_RECONNECT_SIGNING_KEY', 'Signs guest reconnect capabilities; falls back to the service key.', { kind: 'secret' }),

  // ── Feature flags (each reads its value in its own way; see EnvKind) ──
  runtime('TOURNAMENT_SCHEDULER_ENABLED', 'Runs the tournament scheduler tick on this process. Default on.', { kind: 'flagBool' }),
  runtime('TOURNAMENTS_ENABLED', 'Turns tournaments on.', { kind: 'flagTrue' }),
  runtime('FRITZ_CUP_ENABLED', 'Turns the Fritz Cup on.', { kind: 'flagTrue' }),
  runtime('ENABLE_SPECTATOR_MODE', 'Turns spectating on.', { kind: 'flagTrue' }),
  runtime('DAILY_FRITZ_TRANSACTIONAL_COMMANDS', 'Daily Fritz authority: transactional commands.', { kind: 'flagTrue' }),
  runtime('COMMAND_MATCH_ID_REQUIRED', 'Requires a match id on game commands.', { kind: 'flagTrue' }),
  runtime('REVIEW_SWEEP_ENABLED', 'The review sweep job. The kill switch from the 2026-09 outages.', { kind: 'flagTrue' }),
  runtime('LIVE_SESSION_LOG_ENTRIES', 'Incremental live-session log writes. Needs the persist_room_live_session migration.', { kind: 'flagTrue' }),
  runtime('ENABLE_REQUEST_PUZZLE_GENERATION', 'Allows puzzle generation on request.', { kind: 'flagBool' }),
  runtime('ENABLE_STARTUP_FRITZ_WARMUP', 'Warms the Daily Fritz engine on boot.', { kind: 'flagTruthy' }),
  runtime('GHOST_DEFERRED_DRAIN_ENABLED', 'The deferred ghost-completion drain. On unless exactly false.', { kind: 'flagUnlessFalse' }),
  runtime('ROOM_RETENTION_REAPER_ENABLED', 'The room retention reaper. On unless exactly false.', { kind: 'flagUnlessFalse' }),
  runtime('TERMINAL_COMPLETION_RECOVERY_ENABLED', 'Boot recovery of terminal rows. On unless exactly false.', { kind: 'flagUnlessFalse' }),
  runtime('REVIEW_COMPLETION_REQUIRE_DURABLE', 'Requires the durable review store outside production too.', { kind: 'flagOne' }),
  runtime('REVIEW_COMPLETION_STORE', 'The review completion store; "memory" is for tests only.', { kind: 'enum', values: ['memory', 'durable'] }),
  runtime('REQUEST_VALIDATION_MODE', 'Request body validation: shadow (default), enforce or off (roadmap 3.3).', { kind: 'enum', values: ['shadow', 'enforce', 'off'] }),
  runtime('ENV_VALIDATION_MODE', 'This check: warn (default), enforce (refuse to boot on a misread setting) or off.', { kind: 'enum', values: ['warn', 'enforce', 'off'] }),

  // ── Numbers ──
  runtime('ROOM_CLEANUP_GRACE_MS', 'How long an empty room is kept, in ms.', { kind: 'int', min: 0 }),
  runtime('GHOST_DEFERRED_DRAIN_BOOT_DELAY_MS', 'Boot delay of the ghost drain; the code clamps it to 1 s to 30 s.', { kind: 'int', clamp: [1_000, 30_000] }),
  runtime('TERMINAL_COMPLETION_RECOVERY_BOOT_DELAY_MS', 'Boot delay of terminal recovery; the code clamps it to 1 s to 15 s.', { kind: 'int', clamp: [1_000, 15_000] }),
  runtime('TOURNAMENT_ORCHESTRATOR_LEASE_TTL_MS', 'Tournament orchestrator lease; the code clamps it to 30 s to 600 s.', { kind: 'int', clamp: [30_000, 600_000] }),
  runtime('TOURNAMENT_TURN_TIMEOUT_MS', 'Tournament turn clock in ms; outside 5 s to 10 min the code ignores it and uses the default.', { kind: 'int', min: 5_000, max: 600_000 }),
  runtime('TOURNAMENT_MAX_MISSED_TURNS', 'Missed turns before a tournament forfeit; outside 1 to 20 the code ignores it.', { kind: 'int', min: 1, max: 20 }),
  runtime('TOURNAMENT_MATCH_CAP_MS', 'Tournament match time cap in ms; outside 1 min to 6 h the code ignores it.', { kind: 'int', min: 60_000, max: 21_600_000 }),
  runtime('EVENT_LOOP_LAG_WARN_MS', 'Event-loop lag that logs a warning, in ms. Default 500.', { kind: 'int', min: 1 }),
  runtime('EVENT_LOOP_LAG_ALERT_MS', 'Event-loop lag that raises an alert, in ms. Default 2000.', { kind: 'int', min: 1 }),
  runtime('EVENT_LOOP_STALL_MS', 'Event-loop stall that trips the watchdog, in ms. Default 5000.', { kind: 'int', min: 1 }),
  runtime('REVIEW_WORKER_MAX_OLD_GEN_MB', 'Memory ceiling of the review worker, in MB. Default 256.', { kind: 'int', min: 64 }),
  limit('LIMIT_ROOM_CREATE_MAX', 'Socket rate limit per minute: creating a room.'),
  limit('LIMIT_ROOM_JOIN_MAX', 'Socket rate limit per minute: joining a room.'),
  limit('LIMIT_ROOM_SPECTATE_MAX', 'Socket rate limit per minute: spectating a room.'),
  limit('LIMIT_QUEUE_JOIN_MAX', 'Socket rate limit per minute: joining the queue.'),
  limit('LIMIT_FRIEND_INVITE_MAX', 'Socket rate limit per minute: friend invites.'),
  limit('LIMIT_FRIEND_DECLINE_MAX', 'Socket rate limit per minute: declining invites.'),
  limit('LIMIT_ROOM_EMOTE_MAX', 'Socket rate limit per minute: emotes.'),
  limit('LIMIT_GAME_ACTION_MAX', 'Socket rate limit per minute: game actions.'),
  limit('LIMIT_HAND_READY_MAX', 'Socket rate limit per minute: hand ready.'),
  limit('LIMIT_PLAYER_READY_MAX', 'Socket rate limit per minute: player ready.'),
  limit('LIMIT_DEFAULT_MAX', 'Socket rate limit per minute for any other event.'),
  limit('LIMIT_FAILED_ROOM_LOOKUPS_MAX', 'Failed room lookups allowed per window before a block.'),
  runtime('LIMIT_FAILED_ROOM_LOOKUPS_WINDOW', 'Window for the failed-room-lookup limit, in ms.', { kind: 'int', min: 1_000 }),

  // ── Debug and development: suspicious in production ──
  dev('DEBUG_MP', 'Verbose multiplayer logging.', { kind: 'flagBool' }),
  dev('MP_DEBUG', 'Verbose multiplayer logging.', { kind: 'flagBool' }),
  dev('MP_DRAW_AUDIT', 'Audits draw decisions.', { kind: 'flagBool' }),
  dev('MATCHMAKING_DEBUG', 'Verbose matchmaking logging.', { kind: 'flagBool' }),
  dev('MATCHMAKING_DEV_MODE', 'Simulated opponents in matchmaking: 1 on, 0 off; unset means on outside production.', { kind: 'enum', values: ['0', '1'] }),
  dev('MP_PRIVATE_CERT_MODE', 'Certification mode for private rooms.', { kind: 'flagOne' }),
  dev('SOFT_GAME_INVARIANTS', 'Downgrades game-invariant failures from errors.', { kind: 'flagTrue' }),
  dev('DAILY_FRITZ_MEMORY_STORE', 'Keeps Daily Fritz state in memory (never honoured in production).', { kind: 'flagOne' }),
  dev('DAILY_FRITZ_TEST_FIXTURES_ENABLED', 'Allows Daily Fritz test fixture dates (never honoured in production).', { kind: 'flagTrue' }),
  dev('DEBUG_SETUP_STRIKE', 'Forces a puzzle-generation retry for tests.', { kind: 'flagOne' }),
  dev('E2E_AUTH_SHIM', 'Explicit opt-in for the e2e identity shim; refused on hosted runtimes and when any production Supabase project is configured.', { kind: 'flagBool' }),
  dev('RACEHORSE_ALLOW_PRODUCTION_SUPABASE', 'Lets throwaway-user tooling touch the production project. Never meaningful on the server itself.', { kind: 'flagBool' }),
  dev('E2E_INSPECT', 'Exposes the end-to-end inspection route (never in production).', { kind: 'flagOne' }),
  dev('E2E_DAILY_FRITZ_USER_ID', 'The user id the e2e shim signs in as.', { kind: 'string' }),

  // ── Test tooling ──
  test('PSQL_BIN', 'Path to psql for the real-Postgres tests.', { kind: 'string' }),
  test('TERMINAL_R1_POSTGREST_URL', 'PostgREST URL for the terminal-completion tests.', { kind: 'url' }),
  test('TERMINAL_R1_TEST_DATABASE_URL', 'Database URL for the terminal-completion tests.', { kind: 'url' }),
];

export const ENV_SPEC_BY_NAME: ReadonlyMap<string, EnvSpec> = new Map(ENV_SPECS.map((spec) => [spec.name, spec]));

/** Settings that exist only for development or tests; being set in production is almost always a mistake. */
const DEV_ONLY_IN_PRODUCTION = new Set(ENV_SPECS.filter((spec) => spec.scope === 'dev' || spec.scope === 'test').map((spec) => spec.name));

/** Prefixes of this app's own settings, so a name that starts with one but is not registered is flagged as a likely typo. */
const OWN_PREFIXES = ['LIMIT_', 'TOURNAMENT', 'TERMINAL_', 'REVIEW_', 'MP_', 'DAILY_FRITZ_', 'DAILY_PUZZLE_', 'GHOST_', 'ROOM_', 'ENABLE_', 'MATCHMAKING_', 'FRITZ_', 'REQUEST_VALIDATION', 'ENV_VALIDATION', 'GUEST_', 'LIVE_SESSION'];

export type EnvIssue = {
  /** `error`: the value will be misread or is unusable. `warn`: legal, but worth a look. */
  level: 'error' | 'warn';
  name: string;
  message: string;
};

type Env = Record<string, string | undefined>;

const present = (value: string | undefined): value is string => value !== undefined && value.trim() !== '';

/** Words that mean "off". For a flag the code reads as OFF for anything it does not recognise, one of these is harmless: the author wanted OFF and gets OFF. */
const MEANS_OFF = new Set(['off', 'no', 'false', '0', 'disabled', 'disable']);

function checkValue(spec: EnvSpec, raw: string): string | null {
  const value = raw.trim();
  const readsAsOff = spec.kind === 'flagTrue' || spec.kind === 'flagOne' || spec.kind === 'flagBool' || spec.kind === 'flagTruthy';
  if (readsAsOff && MEANS_OFF.has(value.toLowerCase())) return null;
  switch (spec.kind) {
    case 'flagTrue':
      return value === 'true' || value === 'false' ? null : 'only the exact text "true" turns this on, so this value leaves it OFF. Use true or false.';
    case 'flagUnlessFalse':
      return value === 'true' || value === 'false' ? null : 'only the exact text "false" turns this off, so this value leaves it ON. Use true or false.';
    case 'flagOne':
      return value === '1' || value === '0' ? null : 'only the exact text "1" turns this on, so this value leaves it OFF. Use 1 or 0.';
    case 'flagBool':
      return ['1', 'true', '0', 'false'].includes(value.toLowerCase()) ? null : 'only 1 or true turn this on, so this value leaves it OFF. Use true or false.';
    case 'flagTruthy':
      return ['true', '1', 'yes', 'false', '0', 'no'].includes(value.toLowerCase()) ? null : 'only true, 1 or yes turn this on, so this value leaves it OFF. Use true or false.';
    case 'int': {
      if (!/^-?\d+$/.test(value)) return 'is not a whole number, so the default is used instead.';
      const n = Number(value);
      if (spec.min !== undefined && n < spec.min) return `is below the minimum of ${spec.min}.`;
      if (spec.max !== undefined && n > spec.max) return `is above the maximum of ${spec.max}.`;
      return null;
    }
    case 'url':
      try {
        new URL(value);
        return null;
      } catch {
        return 'is not a valid absolute URL.';
      }
    case 'enum':
      return spec.values.includes(value) ? null : `is not one of ${spec.values.join(', ')}.`;
    default:
      return null;
  }
}

/**
 * Looks at an environment and reports problems. Pure: it never reads `process.env` itself and never includes a value in a message.
 * `production` switches on the strict checks (required settings, development settings left on).
 */
export function checkEnvironment(env: Env, production: boolean): EnvIssue[] {
  const issues: EnvIssue[] = [];

  for (const spec of ENV_SPECS) {
    const raw = env[spec.name];
    if (!present(raw)) continue;
    const problem = checkValue(spec, raw);
    if (problem) issues.push({ level: 'error', name: spec.name, message: problem });
    else if (spec.kind === 'int' && spec.clamp) {
      const n = Number(raw.trim());
      if (n < spec.clamp[0] || n > spec.clamp[1]) {
        issues.push({ level: 'warn', name: spec.name, message: `is outside ${spec.clamp[0]} to ${spec.clamp[1]}, where the code quietly changes it.` });
      }
    }
  }

  // A name that looks like one of ours but is not registered: almost always a typo, so the setting silently does nothing.
  for (const name of Object.keys(env)) {
    if (ENV_SPEC_BY_NAME.has(name) || !present(env[name])) continue;
    if (OWN_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      issues.push({ level: 'warn', name, message: 'is not a setting this server reads (a typo?), so it has no effect.' });
    }
  }

  if (production) {
    for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']) {
      if (!present(env[name])) issues.push({ level: 'error', name, message: 'is required in production and is not set.' });
    }
    if (!present(env.SENTRY_DSN)) issues.push({ level: 'warn', name: 'SENTRY_DSN', message: 'is not set, so production errors are not reported anywhere.' });
    if (!present(env.ADMIN_SECRET)) issues.push({ level: 'warn', name: 'ADMIN_SECRET', message: 'is not set, so the admin endpoints deny everyone.' });
    if (!present(env.CORS_ALLOWED_ORIGINS) && !present(env.CLIENT_URL)) {
      issues.push({ level: 'warn', name: 'CORS_ALLOWED_ORIGINS', message: 'and CLIENT_URL are both unset, so no deployed web app origin is allowed.' });
    }
    for (const name of DEV_ONLY_IN_PRODUCTION) {
      const value = env[name];
      // A flag deliberately set to false is not the problem; one that is switched on, or a path or id that is set, is.
      if (present(value) && !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase())) {
        issues.push({ level: 'warn', name, message: 'is a development or test setting and is set in production.' });
      }
    }
  }

  return issues;
}

export type EnvValidationMode = 'off' | 'warn' | 'enforce';

export function envValidationMode(env: Env = process.env): EnvValidationMode {
  const value = env.ENV_VALIDATION_MODE;
  return value === 'off' || value === 'enforce' ? value : 'warn';
}
