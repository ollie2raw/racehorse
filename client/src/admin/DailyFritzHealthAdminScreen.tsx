import { useEffect, useMemo, useState } from 'react';
import { resolveGameServerUrl } from '../lib/gameServerUrl';

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

export default function DailyFritzHealthAdminScreen() {
  const adminKey = useMemo(
    () => new URLSearchParams(window.location.search).get('admin_key')?.trim() ?? '',
    [],
  );
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!adminKey) {
      setError('Add ?admin_key=YOUR_ADMIN_SECRET to the URL.');
      return;
    }
    setLoading(true);
    const url = new URL(`${resolveGameServerUrl()}/api/daily-fritz/health`);
    url.searchParams.set('admin_key', adminKey);
    void fetch(url.toString())
      .then(async (response) => {
        const body = await response.json() as HealthResponse;
        if (!response.ok) {
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        setHealth(body);
        setError(null);
      })
      .catch((err: unknown) => {
        setHealth(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [adminKey]);

  return (
    <div style={{ padding: '24px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#e9ecef', background: '#0b1220', minHeight: '100dvh' }}>
      <h1 style={{ margin: '0 0 8px', fontSize: '20px' }}>Daily Fritz Health</h1>
      <p style={{ margin: '0 0 20px', color: '#9aa5b1' }}>
        Pacific run_date snapshot vs yesterday. Bookmark with <code>?admin_key=...</code>
      </p>
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
