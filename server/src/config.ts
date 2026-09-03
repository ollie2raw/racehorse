import './loadEnv'; // Ensure env is loaded first

export interface Config {
  isProd: boolean;
  nodeEnv: string;
  port: number;
  supabaseUrl: string;
  supabasePoolerUrl: string | null;
  supabaseServiceKey: string;
  sentryDsn: string | null;
  renderGitCommit: string | null;
  packageVersion: string;
  corsAllowedOrigins: string;
  clientUrl: string | null;
  serverUrl: string | null;
  /**
   * Boot-time singleton gate for the scheduled-tournament scheduler tick +
   * no-show reconciler (D-7 / HARDENING_PLAN.md §1.4.6). Default true. Set
   * false on web dynos once a dedicated scheduler worker is split out, so the
   * tick runs on exactly one process.
   */
  tournamentSchedulerEnabled: boolean;
  matchmakingDebug: boolean;
  matchmakingDevMode: string | null;
  mpDrawAudit: boolean;
  mpDebug: boolean;
  debugMp: boolean;
  roomCleanupGraceMs: number;
  dailyPuzzleCronSecret: string | null;
  enableRequestPuzzleGeneration: boolean;
  
  // Socket rate limiting overrides
  limitRoomCreateMax: number;
  limitRoomJoinMax: number;
  limitRoomSpectateMax: number;
  limitQueueJoinMax: number;
  limitFriendInviteMax: number;
  limitFriendDeclineMax: number;
  limitRoomChatMax: number;
  limitRoomEmoteMax: number;
  limitGameActionMax: number;
  limitHandReadyMax: number;
  limitPlayerReadyMax: number;
  limitDefaultMax: number;
  limitFailedRoomLookupsMax: number;
  limitFailedRoomLookupsWindow: number;
}

const getEnv = (key: string): string | null => {
  const val = process.env[key];
  return val ? val.trim() : null;
};

const getEnvInt = (key: string, defaultValue: number): number => {
  const val = process.env[key];
  if (!val) return defaultValue;
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
};

const getEnvBool = (key: string, defaultValue: boolean): boolean => {
  const val = process.env[key];
  if (!val) return defaultValue;
  const normalized = val.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
};

export function validateAndLoadConfig(): Config {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseServiceKey = getEnv('SUPABASE_SERVICE_KEY');
  const nodeEnv = getEnv('NODE_ENV') ?? 'development';
  const isProd = nodeEnv === 'production';

  // Fails fast in production with descriptive errors
  if (isProd) {
    const missing: string[] = [];
    if (!supabaseUrl) missing.push('SUPABASE_URL');
    if (!supabaseServiceKey) missing.push('SUPABASE_SERVICE_KEY');
    
    if (missing.length > 0) {
      throw new Error(`Production Configuration Validation Failed: Missing required variables: ${missing.join(', ')}`);
    }

    // Basic URL validation for SUPABASE_URL
    try {
      new URL(supabaseUrl!);
    } catch {
      throw new Error(`Production Configuration Validation Failed: SUPABASE_URL must be a valid absolute URL, got "${supabaseUrl}"`);
    }
  }

  return {
    isProd,
    nodeEnv,
    port: getEnvInt('PORT', 3001),
    supabaseUrl: supabaseUrl ?? '',
    supabasePoolerUrl: getEnv('SUPABASE_POOLER_URL'),
    supabaseServiceKey: supabaseServiceKey ?? '',
    sentryDsn: getEnv('SENTRY_DSN'),
    renderGitCommit: getEnv('RENDER_GIT_COMMIT'),
    packageVersion: getEnv('npm_package_version') ?? 'dev',
    corsAllowedOrigins: getEnv('CORS_ALLOWED_ORIGINS') ?? '',
    clientUrl: getEnv('CLIENT_URL'),
    serverUrl: getEnv('SERVER_URL'),
    tournamentSchedulerEnabled: getEnvBool('TOURNAMENT_SCHEDULER_ENABLED', true),
    matchmakingDebug: getEnvBool('MATCHMAKING_DEBUG', false),
    matchmakingDevMode: getEnv('MATCHMAKING_DEV_MODE'),
    mpDrawAudit: getEnvBool('MP_DRAW_AUDIT', false),
    mpDebug: getEnvBool('MP_DEBUG', false) || getEnvBool('DEBUG_MP', false),
    debugMp: getEnvBool('DEBUG_MP', false),
    roomCleanupGraceMs: getEnvInt('ROOM_CLEANUP_GRACE_MS', 0),
    dailyPuzzleCronSecret: getEnv('DAILY_PUZZLE_CRON_SECRET'),
    enableRequestPuzzleGeneration: getEnvBool('ENABLE_REQUEST_PUZZLE_GENERATION', false),

    // Socket rate limiting
    limitRoomCreateMax: getEnvInt('LIMIT_ROOM_CREATE_MAX', 10),
    limitRoomJoinMax: getEnvInt('LIMIT_ROOM_JOIN_MAX', 30),
    limitRoomSpectateMax: getEnvInt('LIMIT_ROOM_SPECTATE_MAX', 30),
    limitQueueJoinMax: getEnvInt('LIMIT_QUEUE_JOIN_MAX', 10),
    limitFriendInviteMax: getEnvInt('LIMIT_FRIEND_INVITE_MAX', 20),
    limitFriendDeclineMax: getEnvInt('LIMIT_FRIEND_DECLINE_MAX', 60),
    limitRoomChatMax: getEnvInt('LIMIT_ROOM_CHAT_MAX', 30),
    limitRoomEmoteMax: getEnvInt('LIMIT_ROOM_EMOTE_MAX', 60),
    limitGameActionMax: getEnvInt('LIMIT_GAME_ACTION_MAX', 240),
    limitHandReadyMax: getEnvInt('LIMIT_HAND_READY_MAX', 120),
    limitPlayerReadyMax: getEnvInt('LIMIT_PLAYER_READY_MAX', 120),
    limitDefaultMax: getEnvInt('LIMIT_DEFAULT_MAX', 600),
    limitFailedRoomLookupsMax: getEnvInt('LIMIT_FAILED_ROOM_LOOKUPS_MAX', 5),
    limitFailedRoomLookupsWindow: getEnvInt('LIMIT_FAILED_ROOM_LOOKUPS_WINDOW', 60_000),
  };
}

export const config = validateAndLoadConfig();
