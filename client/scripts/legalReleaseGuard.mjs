import { LEGAL_CONFIG } from '../src/legal/legalConfig.mjs';
import { loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

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

const CHANCE_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10 };

/** The "about a one in N chance" the privacy text promises for speed measurements, as a rate (null if the sentence is gone). */
export function privacyTextSampleRate(legalContentSource) {
  const match = /about (?:a )?one in (\w+) chance/i.exec(legalContentSource);
  const n = match ? CHANCE_WORDS[match[1].toLowerCase()] ?? Number(match[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? 1 / n : null;
}

/** DEFAULT_RUM_SAMPLE_RATE from rumConfig.ts (read as text: this script is plain .mjs and cannot import TypeScript). */
export function defaultSampleRate(rumConfigSource) {
  const match = /DEFAULT_RUM_SAMPLE_RATE\s*=\s*([0-9.]+)/.exec(rumConfigSource);
  return match ? Number(match[1]) : null;
}

/**
 * The speed-measurement sample rate a release build ships must be the one the privacy text states: the built-in default must equal
 * the text, and VITE_RUM_SAMPLE_RATE, if set, must be 0 (measurements off: safe) or the same rate. Anything else (1, 0.5, a typo
 * that would silently switch measurements off) fails the release build.
 */
export function validateRumSampleRate({ raw, defaultRate, textRate }) {
  const errors = [];
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  if (textRate === null) errors.push('the privacy text no longer states a "one in N chance" for speed measurements (client/src/legal/legalContent.mjs): update scripts/legalReleaseGuard.mjs together with it');
  if (defaultRate === null) errors.push('DEFAULT_RUM_SAMPLE_RATE not found in client/src/rum/rumConfig.ts');
  if (textRate !== null && defaultRate !== null && !close(textRate, defaultRate)) errors.push(`DEFAULT_RUM_SAMPLE_RATE (${defaultRate}) does not match the privacy text (one in ${Math.round(1 / textRate)} = ${textRate})`);
  if (raw !== undefined && raw.trim() !== '') {
    const value = Number(raw);
    if (!Number.isFinite(value)) errors.push(`VITE_RUM_SAMPLE_RATE "${raw}" is not a number (it would silently turn measurements off)`);
    else if (value !== 0 && textRate !== null && !close(value, textRate)) errors.push(`VITE_RUM_SAMPLE_RATE ${raw} does not match the privacy text (one in ${Math.round(1 / textRate)} = ${textRate}); use 0 or ${textRate}`);
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? 'production';
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_LEGAL_'), ...process.env };
  const config = Object.fromEntries(Object.entries(LEGAL_CONFIG).map(([key, value]) => [key, env[`VITE_LEGAL_${key}`] ?? value]));
  const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const errors = validateReleaseLegalConfig(config);
  errors.push(...validateRumSampleRate({
    raw: env.VITE_RUM_SAMPLE_RATE ?? loadEnv(mode, process.cwd(), 'VITE_RUM_').VITE_RUM_SAMPLE_RATE,
    defaultRate: defaultSampleRate(readFileSync(path.join(clientRoot, 'src/rum/rumConfig.ts'), 'utf8')),
    textRate: privacyTextSampleRate(readFileSync(path.join(clientRoot, 'src/legal/legalContent.mjs'), 'utf8')),
  }));
  if (errors.length) {
    console.error(`Release legal configuration failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
    process.exitCode = 1;
  } else console.log('Release legal configuration passed.');
}
