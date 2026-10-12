/**
 * Fixed reporting vocabulary. Mirrors the CHECK constraints in
 * supabase/migrations/2026-10-12_user_reports_and_blocks.sql and the client's
 * client/src/moderation/moderationTypes.ts. A report never carries text the
 * reporter typed.
 */
export const REPORT_CATEGORIES = ['inappropriate_username', 'harassment', 'cheating', 'other'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_SOURCES = ['profile', 'live_match'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

/** Reports one account may file per rolling 24 hours (beyond that: 429). */
export const MAX_REPORTS_PER_REPORTER_PER_DAY = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUserId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === 'string' && (REPORT_CATEGORIES as readonly string[]).includes(value);
}

export function isReportSource(value: unknown): value is ReportSource {
  return typeof value === 'string' && (REPORT_SOURCES as readonly string[]).includes(value);
}
