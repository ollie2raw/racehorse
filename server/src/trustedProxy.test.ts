/**
 * AU-3 (HARDENING_PLAN §6.3), 2026-09-04 correction. `trustedProxy.ts` decides
 * which upstream addresses are infrastructure — used both for `app.set('trust
 * proxy', ...)` and to gate whether `CF-Connecting-IP` can be believed.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { isTrustedInfraPeer, TRUSTED_PROXY } from './trustedProxy';

describe('isTrustedInfraPeer', () => {
  it.each([
    ['173.245.48.9', true, 'cloudflare v4'],
    ['162.158.1.2', true, 'cloudflare v4'],
    ['2606:4700::1', true, 'cloudflare v6'],
    ['10.199.46.133', true, 'render internal 10.x'],
    ['172.16.5.5', true, 'private 172.16/12'],
    ['127.0.0.1', true, 'loopback'],
    ['::1', true, 'loopback v6'],
    ['::ffff:10.1.2.3', true, 'v4-mapped private'],
    ['8.8.8.8', false, 'public'],
    ['198.51.100.7', false, 'public documentation range'],
    ['2001:4860:4860::8888', false, 'public v6'],
    ['not-an-ip', false, 'garbage'],
    ['', false, 'empty'],
  ])('%s → %s (%s)', (ip, expected) => {
    expect(isTrustedInfraPeer(ip)).toBe(expected);
  });

  it('rejects null/undefined', () => {
    expect(isTrustedInfraPeer(null)).toBe(false);
    expect(isTrustedInfraPeer(undefined)).toBe(false);
  });
});

describe('TRUSTED_PROXY resolves req.ip to the real client (range-based, hop-count-independent)', () => {
  function withApp(fn: (base: string) => Promise<void>) {
    const app = express();
    app.set('trust proxy', TRUSTED_PROXY);
    app.get('/ip', (req, res) => res.json({ ip: req.ip }));
    return new Promise<void>((resolve, reject) => {
      const srv = app.listen(0, async () => {
        try {
          await fn(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`);
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          srv.close();
        }
      });
    });
  }

  it('ignores a client-prepended spoof ahead of the Cloudflare-appended client entry', async () => {
    await withApp(async (base) => {
      const spoofed = await fetch(`${base}/ip`, {
        headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.55, 162.158.1.2, 10.0.0.9' },
      });
      expect((await spoofed.json()).ip).toBe('203.0.113.55');

      const honest = await fetch(`${base}/ip`, {
        headers: { 'x-forwarded-for': '203.0.113.55, 162.158.1.2, 10.0.0.9' },
      });
      expect((await honest.json()).ip).toBe('203.0.113.55');
    });
  });

  it('works for a shorter (single Cloudflare hop) chain too', async () => {
    await withApp(async (base) => {
      const r = await fetch(`${base}/ip`, {
        headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.55, 162.158.1.2' },
      });
      expect((await r.json()).ip).toBe('203.0.113.55');
    });
  });
});
