/** In-memory stand-in for the rating_cutover_gate PostgREST table, for fetch-stubbed tests. */
export type FenceRowState = {
  quiesced: boolean;
  quiesced_at: string | null;
  enabled_boot_id: string | null;
  reason: string | null;
  ghost_expand_applied_at: string | null;
};

export function newFenceStore(): { row: FenceRowState; unreadable: boolean } {
  return {
    row: { quiesced: false, quiesced_at: null, enabled_boot_id: null, reason: null, ghost_expand_applied_at: null },
    unreadable: false,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Returns a Response when the request targets the fence table, otherwise null. */
export function handleFenceRequest(
  store: ReturnType<typeof newFenceStore>,
  url: string,
  init?: RequestInit,
): Response | null {
  if (!url.includes('/rest/v1/rating_cutover_gate')) return null;
  if (store.unreadable) return jsonResponse({ message: 'fence unavailable' }, 500);
  const method = init?.method ?? 'GET';
  if (method === 'PATCH') Object.assign(store.row, JSON.parse(String(init?.body)));
  return jsonResponse([{ ...store.row }]);
}
