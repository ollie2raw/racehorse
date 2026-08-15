import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type Json = Record<string, unknown>;

export function applyAuthoritySoakEnv(): void {
  for (const filePath of [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../client/.env')]) {
    if (!fs.existsSync(filePath)) continue;
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      if (!key || process.env[key] != null) continue;
      let value = trimmed.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number, expected = [200]): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => ({})) as Json;
  if (!expected.includes(response.status)) {
    throw new Error(`${init.method ?? 'GET'} ${url} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

export async function createEphemeralUser(input: {
  prefix: string;
  supabaseUrl: string;
  serviceKey: string;
  anonKey: string;
  timeoutMs: number;
}): Promise<{ id: string; accessToken: string }> {
  const suffix = randomUUID();
  const email = `${input.prefix}-${suffix}@racehorse-test.invalid`;
  const password = `Rh-${randomUUID()}-Aa9!`;
  const created = await fetchJson<Json>(`${input.supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: input.serviceKey, authorization: `Bearer ${input.serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  }, input.timeoutMs);
  const id = String(created.id ?? '');
  if (!id) throw new Error('Supabase did not return an ephemeral user ID.');
  const signedIn = await fetchJson<Json>(`${input.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: input.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }, input.timeoutMs);
  const accessToken = String(signedIn.access_token ?? '');
  if (!accessToken) throw new Error('Supabase did not return an ephemeral access token.');
  return { id, accessToken };
}

export async function deleteEphemeralUser(input: {
  id: string;
  supabaseUrl: string;
  serviceKey: string;
  timeoutMs: number;
}): Promise<void> {
  const response = await fetch(`${input.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(input.id)}`, {
    method: 'DELETE',
    headers: { apikey: input.serviceKey, authorization: `Bearer ${input.serviceKey}` },
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!response.ok && response.status !== 404) throw new Error(`Failed to remove ephemeral user ${input.id}: ${response.status}`);
}

export function createApi(input: { baseUrl: string; token: string; timeoutMs: number }) {
  return async ({ path: pathname, method, body }: {
    path: string;
    method: 'POST';
    body: Json;
  }): Promise<Json> => fetchJson<Json>(`${input.baseUrl}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${input.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, input.timeoutMs);
}

export function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
}

export async function runInWaves<T>(input: {
  total: number;
  concurrency: number;
  worker: (index: number) => Promise<T>;
  onWave?: (completed: number, total: number) => void;
}): Promise<T[]> {
  const results: T[] = [];
  for (let offset = 0; offset < input.total; offset += input.concurrency) {
    const waveSize = Math.min(input.concurrency, input.total - offset);
    const wave = Array.from({ length: waveSize }, (_, index) => input.worker(offset + index));
    results.push(...await Promise.all(wave));
    input.onWave?.(results.length, input.total);
  }
  return results;
}
