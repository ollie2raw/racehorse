const TOURNAMENT_ATTACH_ERROR_COPY: Record<string, string> = {
  match_not_ready: 'Your match is not ready yet. Refresh the bracket and try again.',
  tournament_not_assigned: 'This match is no longer assigned to you.',
  room_unavailable: 'The match room is not available yet. Try again in a moment.',
  invalid_room: 'Could not open the match room. Try again.',
  match_completed: 'This match is already complete.',
  socket_not_connected: 'Not connected to the game server. Reconnecting…',
  socket_disconnected: 'Connection lost. Reconnecting…',
};

export function formatTournamentAttachError(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return 'Could not join tournament match.';
  if (trimmed.includes('timed out')) return 'Join timed out. Try again.';
  return TOURNAMENT_ATTACH_ERROR_COPY[trimmed] ?? trimmed;
}
