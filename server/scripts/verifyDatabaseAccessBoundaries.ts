import { randomUUID } from 'node:crypto';
import '../src/loadEnv';

type Json = Record<string, unknown>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = required('SUPABASE_SERVICE_KEY');
const anonKey = required('VITE_SUPABASE_ANON_KEY');
const timeoutMs = 20_000;

async function request(pathname: string, init: RequestInit): Promise<Response> {
  return fetch(`${supabaseUrl}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function json(response: Response): Promise<Json> {
  return response.json().catch(() => ({})) as Promise<Json>;
}

async function expectDenied(label: string, response: Response): Promise<void> {
  if (response.ok) throw new Error(`${label} unexpectedly succeeded with ${response.status}.`);
  const body = await json(response);
  const code = String(body.code ?? '');
  if (response.status !== 401 && response.status !== 403 && code !== '42501') {
    throw new Error(`${label} failed for the wrong reason (${response.status}): ${JSON.stringify(body)}`);
  }
  process.stdout.write(`${JSON.stringify({ check: label, status: response.status, code, denied: true })}\n`);
}

function restHeaders(token: string, prefer?: string): Record<string, string> {
  return {
    apikey: anonKey,
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...(prefer ? { prefer } : {}),
  };
}

function serviceHeaders(prefer?: string): Record<string, string> {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
    ...(prefer ? { prefer } : {}),
  };
}

async function main(): Promise<void> {
  const suffix = randomUUID();
  const email = `db-boundary-${suffix}@racehorse-test.invalid`;
  const password = `Rh-${randomUUID()}-Aa9!`;
  let userId = '';
  let pendingId = '';

  try {
    const createdResponse = await request('/auth/v1/admin/users', {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!createdResponse.ok) throw new Error(`User creation failed: ${createdResponse.status}`);
    userId = String((await json(createdResponse)).id ?? '');
    if (!userId) throw new Error('Created user ID was missing.');

    const tokenResponse = await request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!tokenResponse.ok) throw new Error(`Sign-in failed: ${tokenResponse.status}`);
    const accessToken = String((await json(tokenResponse)).access_token ?? '');
    if (!accessToken) throw new Error('Access token was missing.');

    const username = `db_boundary_${suffix.replace(/-/g, '').slice(0, 12)}`;
    const usernameResponse = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: restHeaders(accessToken, 'return=representation'),
      body: JSON.stringify({ username }),
    });
    if (!usernameResponse.ok) {
      throw new Error(`Legitimate username update failed: ${usernameResponse.status} ${JSON.stringify(await json(usernameResponse))}`);
    }
    process.stdout.write(`${JSON.stringify({ check: 'authenticated_username_update', status: usernameResponse.status, allowed: true })}\n`);

    await expectDenied(
      'authenticated_profile_rating_update',
      await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: restHeaders(accessToken, 'return=representation'),
        body: JSON.stringify({ glicko_rating: 9999 }),
      }),
    );

    const rankedGame = {
      player_id: userId,
      opponent_id: randomUUID(),
      player_score: 30,
      opponent_score: 0,
      game_type: 'fritz',
      rating_before: 1500,
      rd_before: 350,
    };
    await expectDenied(
      'authenticated_ranked_game_insert',
      await request('/rest/v1/ranked_games', {
        method: 'POST',
        headers: restHeaders(accessToken),
        body: JSON.stringify(rankedGame),
      }),
    );

    await expectDenied(
      'authenticated_rating_period_insert',
      await request('/rest/v1/rating_periods', {
        method: 'POST',
        headers: restHeaders(accessToken),
        body: JSON.stringify({
          player_id: userId,
          user_id: userId,
          rating_before: 1500,
          rating_after: 9999,
          rd_before: 350,
          rd_after: 30,
        }),
      }),
    );

    await expectDenied(
      'authenticated_bot_match_pending_insert',
      await request('/rest/v1/bot_match_pending', {
        method: 'POST',
        headers: restHeaders(accessToken),
        body: JSON.stringify({ user_id: userId, fritz_tier: 'elite', room_code: `BAD-${suffix}` }),
      }),
    );

    await expectDenied(
      'authenticated_glicko_commit_rpc',
      await request('/rest/v1/rpc/commit_glicko_game_update', {
        method: 'POST',
        headers: restHeaders(accessToken),
        body: JSON.stringify({
          p_profile_id: userId,
          p_glicko_rating: 9999,
          p_glicko_rd: 30,
          p_glicko_vol: 0.06,
          p_glicko_last_period: new Date().toISOString(),
          p_provisional: false,
          p_peak_rating: 9999,
          p_ranked_games_played: 100,
          p_game_id: randomUUID(),
          p_delta: 8499,
          p_rating_before: 1500,
          p_rd_before: 350,
          p_vol_before: 0.06,
        }),
      }),
    );

    const serviceGameResponse = await request('/rest/v1/ranked_games', {
      method: 'POST',
      headers: serviceHeaders('return=representation'),
      body: JSON.stringify(rankedGame),
    });
    if (!serviceGameResponse.ok) {
      throw new Error(`Service ranked-game write failed: ${serviceGameResponse.status} ${JSON.stringify(await json(serviceGameResponse))}`);
    }
    const serviceGames = await serviceGameResponse.json() as Array<{ id?: string }>;
    const gameId = String(serviceGames[0]?.id ?? '');
    if (!gameId) throw new Error('Service ranked-game write returned no ID.');

    const servicePendingResponse = await request('/rest/v1/bot_match_pending', {
      method: 'POST',
      headers: serviceHeaders('return=representation'),
      body: JSON.stringify({ user_id: userId, fritz_tier: 'standard', room_code: `AUTH-${suffix}` }),
    });
    if (!servicePendingResponse.ok) {
      throw new Error(`Service pending-match write failed: ${servicePendingResponse.status} ${JSON.stringify(await json(servicePendingResponse))}`);
    }
    const servicePendingRows = await servicePendingResponse.json() as Array<{ id?: string }>;
    pendingId = String(servicePendingRows[0]?.id ?? '');
    if (!pendingId) throw new Error('Service pending-match write returned no ID.');

    const serviceRpcResponse = await request('/rest/v1/rpc/commit_glicko_game_update', {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({
        p_profile_id: userId,
        p_glicko_rating: 1510,
        p_glicko_rd: 340,
        p_glicko_vol: 0.06,
        p_glicko_last_period: new Date().toISOString(),
        p_provisional: true,
        p_peak_rating: 1510,
        p_ranked_games_played: 1,
        p_game_id: gameId,
        p_delta: 10,
        p_rating_before: 1500,
        p_rd_before: 350,
        p_vol_before: 0.06,
      }),
    });
    if (!serviceRpcResponse.ok) {
      throw new Error(`Service Glicko RPC failed: ${serviceRpcResponse.status} ${JSON.stringify(await json(serviceRpcResponse))}`);
    }
    process.stdout.write(`${JSON.stringify({ check: 'service_role_authoritative_round_trip', status: serviceRpcResponse.status, allowed: true })}\n`);

    const profileResponse = await request(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=username,glicko_rating`,
      {
        method: 'GET',
        headers: restHeaders(accessToken),
      },
    );
    if (!profileResponse.ok) throw new Error(`Profile verification failed: ${profileResponse.status}`);
    const rows = await profileResponse.json() as Array<{ username: string; glicko_rating: number }>;
    if (rows[0]?.username !== username || Number(rows[0]?.glicko_rating) !== 1510) {
      throw new Error(`Profile boundary verification failed: ${JSON.stringify(rows[0] ?? null)}`);
    }
    process.stdout.write(`${JSON.stringify({ check: 'unauthorized_rating_not_applied', passed: true })}\n`);
  } finally {
    if (userId) {
      if (pendingId) {
        const pendingCleanup = await request(`/rest/v1/bot_match_pending?id=eq.${encodeURIComponent(pendingId)}`, {
          method: 'DELETE',
          headers: serviceHeaders(),
        });
        if (!pendingCleanup.ok) throw new Error(`Pending-match cleanup failed: ${pendingCleanup.status}`);
      }
      const cleanup = await request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      });
      if (!cleanup.ok && cleanup.status !== 404) {
        throw new Error(`Ephemeral user cleanup failed: ${cleanup.status}`);
      }
    }
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
