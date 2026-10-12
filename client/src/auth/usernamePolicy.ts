/**
 * Public username policy — client mirror for immediate feedback.
 *
 * Enforcement lives in the database (`supabase/migrations/2026-10-12_username_policy.sql`,
 * `public.username_policy_violation`), applied by a trigger wherever a username is
 * committed. These lists must match that function exactly; `usernamePolicy.test.ts`
 * diffs them against the migration.
 */
export type UsernamePolicyViolation = 'reserved' | 'prohibited' | 'syntax';

export const RESERVED_USERNAMES: readonly string[] = [
  'admin', 'administrator', 'admins', 'mod', 'mods', 'moderator', 'moderators',
  'support', 'help', 'helpdesk', 'staff', 'team', 'official', 'system', 'sysadmin',
  'root', 'owner', 'developer', 'dev', 'security', 'abuse', 'postmaster', 'webmaster',
  'noreply', 'no_reply', 'racehorse', 'racehorse_support', 'racehorse_team',
  'racehorse_official', 'racehorse_admin', 'playracehorse', 'fritz', 'fritz_bot',
  'fritzbot', 'fritz_ai', 'fritzai', 'fritz_official', 'player', 'guest', 'anonymous',
  'unknown', 'null', 'undefined', 'deleted', 'deleted_user',
];

export const RESERVED_USERNAME_PREFIXES: readonly string[] = ['racehorse', 'admin', 'moderator', 'official'];

/** Matched anywhere in the name, also with underscores removed. */
export const PROHIBITED_SLUR_TERMS: readonly string[] = [
  'nigger', 'nigga', 'faggot', 'fagot', 'kike', 'tranny', 'retard', 'wetback', 'chink',
  'gook', 'beaner', 'raghead', 'towelhead', 'hitler', 'rapist', 'pedophile', 'paedophile',
  'molester',
];

/** Matched anywhere in the name as typed. */
export const PROHIBITED_PROFANITY_TERMS: readonly string[] = [
  'fuck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'porn', 'penis', 'vagina', 'pussy',
  'asshole', 'jizz', 'dildo', 'blowjob',
];

const SYNTAX = /^[a-z0-9_]{3,}$/;

/** Null when allowed. Same order and semantics as the SQL function. */
export function usernamePolicyViolation(candidate: string | null | undefined): UsernamePolicyViolation | null {
  const raw = candidate ?? '';
  const name = raw.toLowerCase();
  const squashed = name.replace(/_/g, '');
  if (RESERVED_USERNAMES.includes(name)) return 'reserved';
  if (RESERVED_USERNAME_PREFIXES.some((prefix) => name.startsWith(prefix))) return 'reserved';
  if (PROHIBITED_SLUR_TERMS.some((term) => squashed.includes(term))) return 'prohibited';
  if (PROHIBITED_PROFANITY_TERMS.some((term) => name.includes(term))) return 'prohibited';
  if (!SYNTAX.test(raw)) return 'syntax';
  return null;
}

export function usernamePolicyMessage(violation: UsernamePolicyViolation): string {
  switch (violation) {
    case 'reserved':
      return 'That username is reserved. Try another one.';
    case 'prohibited':
      return 'That username isn’t allowed. Try another one.';
    case 'syntax':
      return 'Username must be at least 3 characters and use lowercase letters, numbers, and underscores only.';
  }
}

/** True for the database's rejection (`username_not_allowed`, SQLSTATE 23514). */
export function isUsernamePolicyDbError(message: string | null | undefined): boolean {
  return /username_not_allowed/i.test(message ?? '');
}
