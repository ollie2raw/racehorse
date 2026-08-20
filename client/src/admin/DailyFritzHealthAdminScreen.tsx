import { useCallback, useEffect, useState } from 'react';
import { resolveGameServerUrl } from '../lib/gameServerUrl';

const ADMIN_KEY_STORAGE = 'racehorse:daily-fritz-admin-key';

type DayMetrics = {
  runDate: string;
  attemptsStarted: number;
  attemptsCompleted: number;
  completionRate: number;
  verificationFailed: number;
  verificationFailureRate: number;
  requestFailed: number;
  legacyUnverifiedCompletions: number;
  unrankedCompletionRate: number;
  recoveryStarted: number;
  recoveryFailed: number;
  firstMoveCount: number;
};

type HealthResponse = {
  ok: boolean;
  run_date: string;
  compared_to: string;
  status: 'healthy' | 'degraded' | 'critical';
  today: DayMetrics;
  yesterday: DayMetrics;
  deltas: {
    completionRatePctPoints: number;
    verificationFailureRatePctPoints: number;
    requestFailedDelta: number;
    attemptsStartedDelta: number;
  };
  top_failures: Array<{ verifierCode: string | null; total: number }>;
  error?: string;
};

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function statusColor(status: HealthResponse['status']): string {
  if (status === 'healthy') return '#2f9e44';
  if (status === 'degraded') return '#e67700';
  return '#c92a2a';
}

function readStoredAdminKey(): string {
  try {
    return window.sessionStorage.getItem(ADMIN_KEY_STORAGE)?.trim() ?? '';
  } catch {
    return '';
  }
}

function persistAdminKey(key: string): void {
  try {
    window.sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
  } catch {
    /* sessionStorage may be unavailable */
  }
}

function clearStoredAdminKey(): void {
  try {
    window.sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  } catch {
    /* sessionStorage may be unavailable */
  }
}

/** One-time migration: legacy bookmarks may still carry ?admin_key= in the URL. */
function consumeLegacyUrlAdminKey(): string {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('admin_key')?.trim() ?? '';
  if (!fromUrl) return '';
  persistAdminKey(fromUrl);
  params.delete('admin_key');
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', nextUrl);
  return fromUrl;
}

function resolveInitialAdminKey(): string {
  const legacy = consumeLegacyUrlAdminKey();
  return legacy || readStoredAdminKey();
}

async function fetchDailyFritzHealth(key: string): Promise<HealthResponse> {
  const url = new URL(`${resolveGameServerUrl()}/api/daily-fritz/health`);
  const response = await fetch(url.toString(), {
    headers: { 'x-admin-secret': key },
  });
  const body = await response.json() as HealthResponse;
  if (!response.ok) {
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return body;
}

export default function DailyFritzHealthAdminScreen() {
  const [adminKey, setAdminKey] = useState(resolveInitialAdminKey);
  const [draftKey, setDraftKey] = useState('');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshHealth = useCallback((key: string) => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        setHealth(await fetchDailyFritzHealth(key));
      } catch (err: unknown) {
        setHealth(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!adminKey) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchDailyFritzHealth(adminKey);
        if (!cancelled) setHealth(data);
      } catch (err: unknown) {
        if (!cancelled) {
          setHealth(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminKey]);

  const handleUnlock = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = draftKey.trim();
    if (!trimmed) return;
    persistAdminKey(trimmed);
    setAdminKey(trimmed);
    setDraftKey('');
  };

  const handleSignOut = () => {
    clearStoredAdminKey();
    setAdminKey('');
    setHealth(null);
    setError(null);
    setLoading(false);
  };

  return (
    <div style={{ padding: '24px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#e9ecef', background: '#0b1220', minHeight: '100dvh' }}>
      <h1 style={{ margin: '0 0 8px', fontSize: '20px' }}>Daily Fritz Health</h1>
      <p style={{ margin: '0 0 20px', color: '#9aa5b1' }}>
        Pacific run_date snapshot vs yesterday. Admin key stays in this tab&apos;s sessionStorage — not the URL.
      </p>

      {!adminKey && (
        <form onSubmit={handleUnlock} style={{ marginBottom: '20px', maxWidth: '420px' }}>
          <label htmlFor="admin-key-input" style={{ display: 'block', marginBottom: '8px', color: '#cbd5e1' }}>
            Admin secret
          </label>
          <input
            id="admin-key-input"
            type="password"
            autoComplete="off"
            value={draftKey}
            onChange={(event) => setDraftKey(event.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              marginBottom: '10px',
              borderRadius: '6px',
              border: '1px solid #334155',
              background: '#111827',
              color: '#e9ecef',
            }}
          />
          <button
            type="submit"
            style={{
              padding: '8px 14px',
              borderRadius: '6px',
              border: '1px solid #475569',
              background: '#1e293b',
              color: '#f8fafc',
              cursor: 'pointer',
            }}
          >
            Unlock dashboard
          </button>
        </form>
      )}

      {adminKey && (
        <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => refreshHealth(adminKey)}
            disabled={loading}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #475569',
              background: '#1e293b',
              color: '#f8fafc',
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #475569',
              background: 'transparent',
              color: '#94a3b8',
              cursor: 'pointer',
            }}
          >
            Clear key
          </button>
        </div>
      )}

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
      {health && (
        <>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px' }}>
            <span style={{
              padding: '4px 10px',
              borderRadius: '999px',
              background: statusColor(health.status),
              color: '#fff',
              fontWeight: 700,
              textTransform: 'uppercase',
              fontSize: '12px',
            }}>
              {health.status}
            </span>
            <span>Today: {health.run_date}</span>
            <span>vs {health.compared_to}</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #334155' }}>Metric</th>
                <th style={{ textAlign: 'right', padding: '8px', borderBottom: '1px solid #334155' }}>Today</th>
                <th style={{ textAlign: 'right', padding: '8px', borderBottom: '1px solid #334155' }}>Yesterday</th>
                <th style={{ textAlign: 'right', padding: '8px', borderBottom: '1px solid #334155' }}>Delta</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Attempts started', health.today.attemptsStarted, health.yesterday.attemptsStarted, `${health.deltas.attemptsStartedDelta >= 0 ? '+' : ''}${health.deltas.attemptsStartedDelta}`],
                ['Completions', health.today.attemptsCompleted, health.yesterday.attemptsCompleted, '—'],
                ['Completion rate', pct(health.today.completionRate), pct(health.yesterday.completionRate), `${health.deltas.completionRatePctPoints >= 0 ? '+' : ''}${health.deltas.completionRatePctPoints.toFixed(1)} pp`],
                ['Verification failures', health.today.verificationFailed, health.yesterday.verificationFailed, '—'],
                ['Verification reject rate', pct(health.today.verificationFailureRate), pct(health.yesterday.verificationFailureRate), `${health.deltas.verificationFailureRatePctPoints >= 0 ? '+' : ''}${health.deltas.verificationFailureRatePctPoints.toFixed(1)} pp`],
                ['Request failures', health.today.requestFailed, health.yesterday.requestFailed, `${health.deltas.requestFailedDelta >= 0 ? '+' : ''}${health.deltas.requestFailedDelta}`],
                ['Legacy unverified completions', health.today.legacyUnverifiedCompletions, health.yesterday.legacyUnverifiedCompletions, '—'],
                ['Unranked completion rate', pct(health.today.unrankedCompletionRate), pct(health.yesterday.unrankedCompletionRate), '—'],
                ['Recovery started', health.today.recoveryStarted, health.yesterday.recoveryStarted, '—'],
                ['Recovery failed', health.today.recoveryFailed, health.yesterday.recoveryFailed, '—'],
                ['First moves', health.today.firstMoveCount, health.yesterday.firstMoveCount, '—'],
              ].map(([label, today, yesterday, delta]) => (
                <tr key={label}>
                  <td style={{ padding: '8px', borderBottom: '1px solid #1e293b' }}>{label}</td>
                  <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #1e293b' }}>{today}</td>
                  <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #1e293b' }}>{yesterday}</td>
                  <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #1e293b' }}>{delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2 style={{ fontSize: '16px', marginBottom: '8px' }}>Top failures today</h2>
          {health.top_failures.length === 0 ? (
            <p style={{ color: '#9aa5b1' }}>None recorded.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              {health.top_failures.map((row) => (
                <li key={`${row.verifierCode ?? 'none'}:${row.total}`}>
                  {row.verifierCode ?? 'unknown'} — {row.total}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
