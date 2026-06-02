import type { FritzTier } from './fritzConfig';

const STORAGE_KEY = 'racehorse_bot_fritz_tier';

const VALID_TIERS: FritzTier[] = ['rookie', 'standard', 'elite', 'master'];

export function readStoredPvfFritzTier(): FritzTier | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw && (VALID_TIERS as string[]).includes(raw)) return raw as FritzTier;
  return null;
}

export function writeStoredPvfFritzTier(tier: FritzTier): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, tier);
}

/** Default PVF tier when the user has not chosen one yet. */
export function resolveDefaultPvfFritzTier(): FritzTier {
  return readStoredPvfFritzTier() ?? 'standard';
}
