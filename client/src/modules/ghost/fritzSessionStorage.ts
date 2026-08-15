const KEY = 'rh_fritz_session';

type FritzSession = {
  localMatchId: string;
  verifiedMatchId?: string;
};

function read(): FritzSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FritzSession;
  } catch {
    return null;
  }
}

function write(session: FritzSession): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // ignore quota / private mode
  }
}

export function readFritzSession(): FritzSession | null {
  return read();
}

export function saveFritzSessionMatchId(localMatchId: string): void {
  write({ ...read(), localMatchId });
}

export function saveFritzSessionVerifiedMatchId(verifiedMatchId: string): void {
  const existing = read();
  if (!existing?.localMatchId) return;
  write({ ...existing, verifiedMatchId });
}

export function clearFritzSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
