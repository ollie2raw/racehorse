export function parseSpectatorModeFlag(value: unknown): boolean {
  return value === 'true';
}

export function isSpectatorModeEnabled(value: unknown = process.env.ENABLE_SPECTATOR_MODE): boolean {
  return parseSpectatorModeFlag(value);
}
