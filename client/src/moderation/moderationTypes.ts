/**
 * Player reporting categories. Fixed choices only — a report never carries text
 * the reporter typed, so reporting cannot itself become an abuse channel. The
 * server accepts exactly these values (`server/src/moderation/moderationPolicy.ts`)
 * and the database CHECK constraint enforces them again.
 */
export type ReportCategory = 'inappropriate_username' | 'harassment' | 'cheating' | 'other';

export const REPORT_CATEGORIES: ReadonlyArray<{ value: ReportCategory; label: string }> = [
  { value: 'inappropriate_username', label: 'Inappropriate username' },
  { value: 'harassment', label: 'Harassment / abusive behavior' },
  { value: 'cheating', label: 'Cheating' },
  { value: 'other', label: 'Other' },
];

/** Where in the app the report was made. App-generated, never user text. */
export type ReportSource = 'profile' | 'live_match';
