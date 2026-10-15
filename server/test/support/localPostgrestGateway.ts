import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Loopback-only gateway in front of an OWNED local PostgREST:
 *  - strips the Supabase `/rest/v1` prefix PostgREST does not serve,
 *  - records every request (request-budget assertions),
 *  - injects deterministic faults at the HTTP boundary around REAL database commits:
 *      'before'  – the request never reaches the database (lost before commit),
 *      'after'   – the request is forwarded and COMMITS, then the response is dropped
 *                  (committed, response lost),
 *      'hold'    – forwarded and committed, response withheld until released (a process can be
 *                  killed in exactly this window),
 *      'crash'   – invokes a callback after the commit and before the response (hard-kill hook).
 * It refuses any upstream that is not 127.0.0.1/localhost.
 */
export type GatewayRequest = { method: string; path: string; at: number };
export type GatewayFault = {
  name: string;
  phase: 'before' | 'after' | 'hold' | 'crash';
  match: (req: GatewayRequest, body: string) => boolean;
  /** How many matching requests to affect (default 1). */
  times?: number;
  onFired?: (req: GatewayRequest, body: string) => void | Promise<void>;
};

export type LocalPostgrestGateway = {
  url: string;
  requests: GatewayRequest[];
  faults: GatewayFault[];
  fired: Map<string, number>;
  count(predicate: (req: GatewayRequest) => boolean): number;
  reset(): void;
  releaseHeld(name: string): void;
  close(): Promise<void>;
};

type InterceptResult = { status: number; json: unknown } | null;
export type GatewayIntercept = (
  req: { method: string; url: string; headers: http.IncomingHttpHeaders },
  body: string,
) => InterceptResult | Promise<InterceptResult>;

export async function startLocalPostgrestGateway(options: {
  upstream: string;
  port?: number;
  /** Answers a request locally (e.g. a synthetic `/auth/v1/user` for process-level tests). */
  intercept?: GatewayIntercept;
}): Promise<LocalPostgrestGateway> {
  const upstream = new URL(options.upstream);
  if (!['127.0.0.1', 'localhost'].includes(upstream.hostname)) {
    throw new Error(`refusing non-loopback PostgREST upstream ${upstream.hostname}`);
  }
  const requests: GatewayRequest[] = [];
  const faults: GatewayFault[] = [];
  const fired = new Map<string, number>();
  const held = new Map<string, Array<() => void>>();

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const method = req.method ?? 'GET';
    const intercepted = await options.intercept?.({ method, url: req.url ?? '/', headers: req.headers }, body);
    if (intercepted) {
      res.writeHead(intercepted.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(intercepted.json));
      return;
    }
    const path = (req.url ?? '/').replace(/^\/rest\/v1/, '') || '/';
    const record: GatewayRequest = { method, path, at: Date.now() };
    requests.push(record);

    const fault = faults.find(
      (f) => (fired.get(f.name) ?? 0) < (f.times ?? 1) && f.match(record, body),
    );
    if (fault) fired.set(fault.name, (fired.get(fault.name) ?? 0) + 1);
    if (fault?.phase === 'before') {
      await fault.onFired?.(record, body);
      res.destroy();
      return;
    }

    let status = 502;
    let payload = Buffer.alloc(0);
    const headers: Record<string, string> = {};
    try {
      const forwardHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string' && !['host', 'connection', 'content-length'].includes(key)) {
          forwardHeaders[key] = value;
        }
      }
      const upstreamResponse = await fetch(`${upstream.origin}${path}`, {
        method,
        headers: forwardHeaders,
        body: ['GET', 'HEAD'].includes(method) ? undefined : body,
      });
      status = upstreamResponse.status;
      payload = Buffer.from(await upstreamResponse.arrayBuffer());
      upstreamResponse.headers.forEach((value, key) => {
        if (!['content-length', 'transfer-encoding', 'connection', 'content-encoding'].includes(key)) {
          headers[key] = value;
        }
      });
    } catch {
      res.statusCode = 502;
      res.end();
      return;
    }

    if (fault?.phase === 'after') {
      await fault.onFired?.(record, body);
      res.destroy(); // committed; the caller never hears about it
      return;
    }
    if (fault?.phase === 'hold' || fault?.phase === 'crash') {
      await fault.onFired?.(record, body);
      await new Promise<void>((resolve) => {
        const list = held.get(fault.name) ?? [];
        list.push(resolve);
        held.set(fault.name, list);
      });
    }
    res.writeHead(status, headers);
    res.end(payload);
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    faults,
    fired,
    count: (predicate) => requests.filter(predicate).length,
    reset() {
      requests.length = 0;
      faults.length = 0;
      fired.clear();
    },
    releaseHeld(name) {
      for (const release of held.get(name) ?? []) release();
      held.delete(name);
    },
    async close() {
      for (const list of held.values()) for (const release of list) release();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
    },
  };
}
