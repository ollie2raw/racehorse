import { checkEnvironment, envValidationMode, type EnvIssue } from './envSchema';
import { childLogger } from './logger';

const log = childLogger('env');

/**
 * Runs once at boot. By default it only REPORTS (one structured log line per problem, then a summary), so a setting that was already wrong
 * before this existed cannot stop a deploy. Set ENV_VALIDATION_MODE=enforce once a boot is clean and a misread setting will refuse to start the
 * server instead of quietly changing behaviour; `off` skips it.
 *
 * Returns the issues so a caller or a test can look at them.
 */
export function runBootEnvCheck(env: Record<string, string | undefined> = process.env): EnvIssue[] {
  const mode = envValidationMode(env);
  if (mode === 'off') return [];

  const production = (env.NODE_ENV ?? 'development') === 'production';
  const issues = checkEnvironment(env, production);

  for (const issue of issues) {
    // Not `level`: pino writes its own numeric level under that key, and a field of the same name would replace it and break log filtering.
    const fields = { setting: issue.name, severity: issue.level };
    if (issue.level === 'error') log.error(fields, `${issue.name} ${issue.message}`);
    else log.warn(fields, `${issue.name} ${issue.message}`);
  }
  const errors = issues.filter((issue) => issue.level === 'error');
  if (issues.length === 0) log.info({ production }, 'environment check: clean');
  else log.warn({ errors: errors.length, warnings: issues.length - errors.length, mode }, 'environment check finished');

  if (mode === 'enforce' && errors.length > 0) {
    throw new Error(`Environment validation failed (ENV_VALIDATION_MODE=enforce): ${errors.map((issue) => issue.name).join(', ')}`);
  }
  return issues;
}
