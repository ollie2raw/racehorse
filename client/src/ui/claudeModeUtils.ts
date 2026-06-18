export function claudeRgb(hex: string): string {
  const normalized = hex.replace('#', '');
  const safe = normalized.padEnd(6, '0').slice(0, 6);
  return `${Number.parseInt(safe.slice(0, 2), 16)}, ${Number.parseInt(safe.slice(2, 4), 16)}, ${Number.parseInt(safe.slice(4, 6), 16)}`;
}
