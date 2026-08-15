const SHARE_CODE_PATTERN = /^[23456789A-HJ-NP-Z]{8}$/;

export function normalizeFritzChallengeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return SHARE_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function readFritzChallengeCodeFromHash(hash: string): string | null {
  const match = hash.match(/^#?\/fritz\/challenge\/([^/?#]+)/i);
  return normalizeFritzChallengeCode(match?.[1]);
}

export function buildFritzChallengeShareUrl(
  code: string,
  location: Pick<Location, 'origin' | 'pathname'>,
): string {
  const normalized = normalizeFritzChallengeCode(code);
  if (!normalized) throw new Error('Invalid Fritz Challenge code.');
  return `${location.origin}${location.pathname}#/fritz/challenge/${normalized}`;
}
