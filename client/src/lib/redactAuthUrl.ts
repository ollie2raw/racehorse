const SENSITIVE_PARAMS = ['access_token', 'refresh_token', 'provider_token', 'provider_refresh_token', 'token_hash', 'code'];

/**
 * Strips auth credentials from a URL (or path) before it reaches telemetry. Supabase implicit-flow callbacks carry a
 * live access + refresh token in the fragment (`#access_token=…&refresh_token=…`); legacy `#/route` fragments and
 * ordinary query parameters are left alone.
 */
export function redactAuthUrl(value: string): string {
  if (!value || (!value.includes('access_token') && !value.includes('refresh_token') && !value.includes('token_hash') && !/[?&#]code=/.test(value))) {
    return value;
  }
  const hashIndex = value.indexOf('#');
  let beforeHash = hashIndex === -1 ? value : value.slice(0, hashIndex);
  let hash = hashIndex === -1 ? '' : value.slice(hashIndex);

  if (hash && !hash.startsWith('#/') && SENSITIVE_PARAMS.some((p) => hash.includes(`${p}=`))) hash = '';

  const queryIndex = beforeHash.indexOf('?');
  if (queryIndex !== -1) {
    const base = beforeHash.slice(0, queryIndex);
    const params = new URLSearchParams(beforeHash.slice(queryIndex + 1));
    for (const key of SENSITIVE_PARAMS) params.delete(key);
    const rest = params.toString();
    beforeHash = rest ? `${base}?${rest}` : base;
  }
  return `${beforeHash}${hash}`;
}

/** Walks a Sentry event and redacts every URL-bearing field it is known to carry. */
export function redactAuthUrlsInSentryEvent<T extends {
  request?: { url?: string };
  breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
}>(event: T): T {
  if (event.request?.url) event.request.url = redactAuthUrl(event.request.url);
  for (const crumb of event.breadcrumbs ?? []) {
    const data = crumb.data;
    if (!data) continue;
    for (const key of ['url', 'from', 'to']) {
      const v = data[key];
      if (typeof v === 'string') data[key] = redactAuthUrl(v);
    }
  }
  return event;
}

/** PostHog `sanitize_properties`: redact URL-valued properties such as `$current_url` and `$referrer`. */
export function redactAuthUrlsInProperties(properties: Record<string, unknown>): Record<string, unknown> {
  for (const [key, v] of Object.entries(properties)) {
    if (typeof v === 'string' && (key === '$current_url' || key === '$referrer' || key === '$pathname' || key.endsWith('_url'))) {
      properties[key] = redactAuthUrl(v);
    }
  }
  return properties;
}
