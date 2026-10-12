import { describe, expect, it } from 'vitest';
import { explicitAllowedOrigins, isAllowedOrigin } from './corsOrigins';

describe('CORS origin policy', () => {
  it('allows the production site and the iOS app', () => {
    for (const origin of ['https://playracehorse.com', 'https://www.playracehorse.com', 'capacitor://localhost']) {
      expect(isAllowedOrigin(origin), origin).toBe(true);
    }
    expect(explicitAllowedOrigins()).toContain('capacitor://localhost');
  });

  it("allows this team's Vercel production alias and preview deployments", () => {
    for (const origin of [
      'https://racehorsedoms.vercel.app',
      'https://racehorsedoms-4uk4ntoxd-olivers-projects-3706e148.vercel.app',
      'https://racehorsedoms-git-fix-app-store-olivers-projects-3706e148.vercel.app',
      'https://racehorsedominoes-abc123def-olivers-projects-3706e148.vercel.app',
    ]) {
      expect(isAllowedOrigin(origin), origin).toBe(true);
    }
  });

  it('rejects arbitrary *.vercel.app origins (previously a wildcard)', () => {
    for (const origin of [
      'https://evil-example.vercel.app',
      'https://racehorsedoms-4uk4ntoxd-someone-else.vercel.app',
      'https://olivers-projects-3706e148.vercel.app',
      'https://racehorsedoms.vercel.app.evil.com',
      'http://racehorsedoms.vercel.app',
    ]) {
      expect(isAllowedOrigin(origin), origin).toBe(false);
    }
  });

  it('rejects unrelated sites and look-alikes', () => {
    for (const origin of ['https://evil.example.com', 'https://playracehorse.com.evil.com', 'http://playracehorse.com', 'capacitor://evil']) {
      expect(isAllowedOrigin(origin), origin).toBe(false);
    }
  });

  it('keeps local development and env-configured origins', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:4173')).toBe(true);
    const config = { clientDeployUrl: 'https://custom-client.example', configuredOrigins: ['https://qa.example'] };
    expect(isAllowedOrigin('https://custom-client.example', config)).toBe(true);
    expect(isAllowedOrigin('https://qa.example', config)).toBe(true);
    expect(isAllowedOrigin('https://qa.example')).toBe(false);
  });

  it('allows requests with no Origin header (server-to-server, same-origin)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });
});
