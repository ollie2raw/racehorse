import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateAndLoadConfig } from './config';

describe('Server Configuration Module', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads valid configuration in development mode', () => {
    process.env.NODE_ENV = 'development';
    process.env.PORT = '8080';
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_KEY = 'mock-key';

    const cfg = validateAndLoadConfig();
    expect(cfg.isProd).toBe(false);
    expect(cfg.port).toBe(8080);
    expect(cfg.supabaseUrl).toBe('http://localhost:54321');
  });

  it('fails fast in production mode if required variables are missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;

    expect(() => validateAndLoadConfig()).toThrow(/Missing required variables: SUPABASE_URL, SUPABASE_SERVICE_KEY/);
  });

  it('fails fast in production mode if SUPABASE_URL is not a valid absolute URL', () => {
    process.env.NODE_ENV = 'production';
    process.env.SUPABASE_URL = 'invalid-url';
    process.env.SUPABASE_SERVICE_KEY = 'mock-key';

    expect(() => validateAndLoadConfig()).toThrow(/SUPABASE_URL must be a valid absolute URL/);
  });

  it('tournamentSchedulerEnabled defaults to true and is disabled only by an explicit false/0', () => {
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_KEY = 'mock-key';

    delete process.env.TOURNAMENT_SCHEDULER_ENABLED;
    expect(validateAndLoadConfig().tournamentSchedulerEnabled).toBe(true);

    process.env.TOURNAMENT_SCHEDULER_ENABLED = 'false';
    expect(validateAndLoadConfig().tournamentSchedulerEnabled).toBe(false);

    process.env.TOURNAMENT_SCHEDULER_ENABLED = '0';
    expect(validateAndLoadConfig().tournamentSchedulerEnabled).toBe(false);

    process.env.TOURNAMENT_SCHEDULER_ENABLED = 'true';
    expect(validateAndLoadConfig().tournamentSchedulerEnabled).toBe(true);
  });
});
