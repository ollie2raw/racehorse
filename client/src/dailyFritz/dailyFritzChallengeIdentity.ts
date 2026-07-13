export const DAILY_FRITZ_RULES_VERSION = 2;
export const DAILY_FRITZ_SEED_VERSION = 1;
export const DAILY_FRITZ_TIME_ZONE = 'America/Los_Angeles';

export type DailyFritzChallengeIdentity = {
  challengeDate: string;
  challengeId: string;
  rulesVersion: number;
  seedVersion: number;
};

export function getDailyFritzDateKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DAILY_FRITZ_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

export function createDailyFritzChallengeIdentity(challengeDate: string): DailyFritzChallengeIdentity {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(challengeDate)) throw new Error('Invalid Daily Fritz challenge date.');
  return {
    challengeDate,
    challengeId: `daily-fritz:${challengeDate}:r${DAILY_FRITZ_RULES_VERSION}:s${DAILY_FRITZ_SEED_VERSION}`,
    rulesVersion: DAILY_FRITZ_RULES_VERSION,
    seedVersion: DAILY_FRITZ_SEED_VERSION,
  };
}

export function isDailyFritzChallengeCurrent(identity: DailyFritzChallengeIdentity, now: Date): boolean {
  return identity.challengeDate === getDailyFritzDateKey(now)
    && identity.rulesVersion === DAILY_FRITZ_RULES_VERSION
    && identity.seedVersion === DAILY_FRITZ_SEED_VERSION
    && identity.challengeId === createDailyFritzChallengeIdentity(identity.challengeDate).challengeId;
}
