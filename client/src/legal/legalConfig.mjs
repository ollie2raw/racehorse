/**
 * Owner-decided facts behind the Privacy Policy, Terms and Support pages.
 *
 * THIS IS THE ONLY FILE THAT MAY HOLD THEM. The page copy in
 * legalContent.mjs reads every value through `legalText()`, and
 * scripts/legalPlaceholders.test.ts fails if an email address, a company name or a
 * placeholder token is written anywhere else in the legal sources.
 *
 * Every value below starts as an OWNER_PLACEHOLDER_* token. Nothing here has
 * been decided by the owner yet, and none of it is guessed: while a value is a
 * placeholder the pages print a visible "[… — to be confirmed]" label in its
 * place rather than an invented address, age, date or company name.
 *
 * Plain .mjs (with legalConfig.d.mts for types) for the same reason as
 * learn/howToPlay/howToPlayArticleContent.mjs: scripts/prerender.mjs runs under
 * plain Node and renders the same words into the served HTML, so the
 * prerendered page and the hydrated page can never disagree.
 *
 * To resolve one, replace the token with the real value, e.g.
 *   SUPPORT_EMAIL: 'help@example.com',
 *   MINIMUM_AGE: '13',
 *   POLICY_EFFECTIVE_DATE: '1 December 2026',
 *   POSTHOG_LOCATION: 'discarded',
 * and run `npx vitest run scripts/legalPlaceholders.test.ts` — the outstanding list shrinks.
 */

export const OWNER_PLACEHOLDER_PREFIX = 'OWNER_PLACEHOLDER_';

// The same VITE values feed the browser and plain-Node prerender process.
const legalEnv = import.meta.env ?? (typeof process !== 'undefined' ? process.env : {});
const configured = (key) => legalEnv[`VITE_LEGAL_${key}`] ?? `OWNER_PLACEHOLDER_${key}`;

export const LEGAL_CONFIG = {
  /**
   * The legal entity (or individual) that operates Racehorse Dominoes.
   * Used only where the copy has to say who "we" are.
   */
  LEGAL_ENTITY_NAME: configured('LEGAL_ENTITY_NAME'),

  /** Where players write for support and privacy requests. */
  SUPPORT_EMAIL: configured('SUPPORT_EMAIL'),

  /** Minimum age to create an account, as a plain number string (e.g. '13'). */
  MINIMUM_AGE: configured('MINIMUM_AGE'),

  /** Date the current Privacy Policy and Terms take effect, as display text. */
  POLICY_EFFECTIVE_DATE: configured('POLICY_EFFECTIVE_DATE'),

  /**
   * PostHog approximate location (P2-6 in the App Store launch doc).
   *
   *  - 'derived'   PostHog derives approximate location (city / region /
   *                country) from the IP address. This is PostHog's default and
   *                is TRUE TODAY.
   *  - 'discarded' The owner has enabled "Discard client IP data" in the
   *                PostHog project, so no location is derived.
   *
   * Until the owner decides, the placeholder is treated as 'derived' — the
   * policy must describe what actually happens now, not the hoped-for state.
   * Changing this to 'discarded' without changing the PostHog project setting
   * would make the Privacy Policy false.
   */
  POSTHOG_LOCATION: configured('POSTHOG_LOCATION'),
};

/** What each placeholder shows on the page until the owner fills it in. */
export const LEGAL_PLACEHOLDER_LABELS = {
  LEGAL_ENTITY_NAME: '[operator name — to be confirmed]',
  SUPPORT_EMAIL: '[support email — to be confirmed]',
  MINIMUM_AGE: '[minimum age — to be confirmed]',
  POLICY_EFFECTIVE_DATE: '[effective date — to be confirmed]',
  POSTHOG_LOCATION: '[analytics location setting — to be confirmed]',
};

export function isOwnerPlaceholder(value) {
  return typeof value === 'string' && value.startsWith(OWNER_PLACEHOLDER_PREFIX);
}

/** Keys the owner still has to decide, in declaration order. */
export function legalPlaceholdersOutstanding(config = LEGAL_CONFIG) {
  return Object.keys(config).filter((key) => isOwnerPlaceholder(config[key]));
}

/** The value to print: the real one once set, otherwise its visible label. */
export function legalText(key, config = LEGAL_CONFIG) {
  const value = config[key];
  return isOwnerPlaceholder(value) ? LEGAL_PLACEHOLDER_LABELS[key] : value;
}

/** The support address, or null while it is still a placeholder (no mailto link). */
export function supportEmailAddress(config = LEGAL_CONFIG) {
  return isOwnerPlaceholder(config.SUPPORT_EMAIL) ? null : config.SUPPORT_EMAIL;
}

/**
 * Whether PostHog may derive approximate location from IP addresses.
 * True unless the owner has explicitly recorded 'discarded' — see
 * POSTHOG_LOCATION above.
 */
export function posthogDerivesLocation(config = LEGAL_CONFIG) {
  return config.POSTHOG_LOCATION !== 'discarded';
}
