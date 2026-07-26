/**
 * Shared API client for all Racehorse REST calls.
 *
 * Provides:
 * - Single auth header construction with try/catch and optional Content-Type
 * - Consistent ApiResult<T> return type (no thrown errors at the wrapper level)
 * - 401 handling: attempt one Supabase session refresh, then return auth error
 * - Typed response parsing with graceful JSON failure
 *
 * Usage:
 *   import { apiGet, apiPost, apiDelete } from '../api/client';
 *   const { data, error } = await apiGet<MyType>('/api/something');
 */

import { supabase } from '../lib/supabase';
import { resolveGameServerUrl } from '../lib/gameServerUrl';

export type ApiResult<T> = {
  data: T | null;
  error: string | null;
  /** Stable application error code returned by the server, when available. */
  errorCode?: string;
  status?: number;
};

/**
 * Build auth headers for a request.
 * Always includes Content-Type: application/json unless skipContentType is true.
 * Silently omits Authorization if session is unavailable.
 */
export async function getAuthHeaders(options?: {
  skipContentType?: boolean;
  requireToken?: boolean;
}): Promise<{ headers: Record<string, string>; hasToken: boolean }> {
  const headers: Record<string, string> = {};
  if (!options?.skipContentType) {
    headers['Content-Type'] = 'application/json';
  }

  if (!supabase) {
    return { headers, hasToken: false };
  }

  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      return { headers, hasToken: true };
    }
  } catch {
    // Session read failed — proceed without auth header
  }

  return { headers, hasToken: false };
}

/**
 * Attempt to refresh the Supabase session. Returns new token or null.
 * Used internally on 401 responses.
 */
async function refreshSession(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.refreshSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Core fetch wrapper. Returns ApiResult<T> — never throws.
 * On 401: attempts one session refresh and retries once.
 */
async function apiFetch<T>(
  url: string,
  init: RequestInit,
  attempt = 1,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include', ...init });
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }

  // 401 — try refresh once
  if (response.status === 401 && attempt === 1) {
    const newToken = await refreshSession();
    if (newToken) {
      const retryInit: RequestInit = {
        ...init,
        headers: {
          ...((init.headers as Record<string, string>) ?? {}),
          Authorization: `Bearer ${newToken}`,
        },
      };
      return apiFetch<T>(url, retryInit, 2);
    }
    return {
      data: null,
      error: 'Session expired. Please sign in again.',
      status: 401,
    };
  }

  if (response.status === 204) {
    return { data: null, error: null, status: 204 };
  }

  if (!response.ok) {
    let errorMessage = `Request failed (${response.status})`;
    let errorCode: string | undefined;
    try {
      const body = await response.json() as unknown;
      if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        if (typeof record.error === 'string') errorMessage = record.error;
        if (typeof record.code === 'string') errorCode = record.code;
      }
    } catch {
      try {
        const text = await response.text();
        if (text) errorMessage = text;
      } catch {
        /* ignore */
      }
    }
    return {
      data: null,
      error: errorMessage,
      ...(errorCode ? { errorCode } : {}),
      status: response.status,
    };
  }

  try {
    const data = (await response.json()) as T;
    return { data, error: null, status: response.status };
  } catch {
    return { data: null, error: 'Invalid response format', status: response.status };
  }
}

/** Resolve the game server base URL — reuse the existing helper */
function serverUrl(): string {
  return resolveGameServerUrl();
}

export async function apiGet<T>(
  path: string,
  options?: { auth?: boolean; signal?: AbortSignal },
): Promise<ApiResult<T>> {
  const { headers } =
    options?.auth !== false
      ? await getAuthHeaders({ skipContentType: true })
      : { headers: {} as Record<string, string> };
  return apiFetch<T>(`${serverUrl()}${path}`, {
    method: 'GET',
    headers,
    signal: options?.signal,
  });
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  options?: { auth?: boolean; keepalive?: boolean; signal?: AbortSignal },
): Promise<ApiResult<T>> {
  const { headers } =
    options?.auth !== false
      ? await getAuthHeaders()
      : { headers: { 'Content-Type': 'application/json' } };
  return apiFetch<T>(`${serverUrl()}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    keepalive: options?.keepalive ?? false,
    signal: options?.signal,
  });
}

export async function apiDelete<T>(
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const { headers } = await getAuthHeaders();
  return apiFetch<T>(`${serverUrl()}${path}`, {
    method: 'DELETE',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
