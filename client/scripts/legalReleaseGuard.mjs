import { LEGAL_CONFIG } from '../src/legal/legalConfig.mjs';
import { loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function validateReleaseLegalConfig(config) {
  const errors = [];
  for (const key of Object.keys(LEGAL_CONFIG)) {
    const value = config[key];
    if (typeof value !== 'string' || !value.trim() || /OWNER_PLACEHOLDER_|to be confirmed|\[.*\]/i.test(value)) {
      errors.push(`${key} is unresolved`);
    }
  }
  if (!/^\S+@\S+\.\S+$/.test(config.SUPPORT_EMAIL ?? '')) errors.push('SUPPORT_EMAIL must be a valid email address');
  if (!/^\d+$/.test(config.MINIMUM_AGE ?? '') || Number(config.MINIMUM_AGE) < 1 || Number(config.MINIMUM_AGE) > 120) errors.push('MINIMUM_AGE must be a valid age');
  if (!['derived', 'discarded'].includes(config.POSTHOG_LOCATION)) errors.push('POSTHOG_LOCATION must be derived or discarded');
  if (!Number.isFinite(Date.parse(config.POLICY_EFFECTIVE_DATE ?? ''))) errors.push('POLICY_EFFECTIVE_DATE must be a valid date');
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? 'production';
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_LEGAL_'), ...process.env };
  const config = Object.fromEntries(Object.entries(LEGAL_CONFIG).map(([key, value]) => [key, env[`VITE_LEGAL_${key}`] ?? value]));
  const errors = validateReleaseLegalConfig(config);
  if (errors.length) {
    console.error(`Release legal configuration failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
    process.exitCode = 1;
  } else console.log('Release legal configuration passed.');
}
