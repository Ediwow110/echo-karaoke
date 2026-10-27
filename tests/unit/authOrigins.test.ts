import { describe, expect, it } from 'vitest';
import { resolveBaseUrl, resolveTrustedOrigins } from '../../server/auth/origins';

describe('auth origins', () => {
  it('prefers an explicit base URL', () => {
    expect(resolveBaseUrl({
      BETTER_AUTH_URL: 'https://echo.example/',
      VERCEL_URL: 'preview-123.vercel.app',
    })).toBe('https://echo.example');
  });

  it('uses the current Vercel deployment when no base URL is set', () => {
    expect(resolveBaseUrl({ VERCEL_URL: 'echo-abc.vercel.app' }))
      .toBe('https://echo-abc.vercel.app');
  });

  it('falls back to the production domain and then to localhost', () => {
    expect(resolveBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'echo-karaoke.vercel.app' }))
      .toBe('https://echo-karaoke.vercel.app');
    expect(resolveBaseUrl({})).toBe('http://127.0.0.1:3000');
  });

  it('uses the stable production domain for a production deployment', () => {
    expect(resolveBaseUrl({
      VERCEL_ENV: 'production',
      VERCEL_URL: 'echo-abc123.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'echo-karaoke.vercel.app',
    })).toBe('https://echo-karaoke.vercel.app');
  });

  it('trusts the base URL, both Vercel hosts, and the configured origins once each', () => {
    const env = {
      BETTER_AUTH_URL: 'https://echo.example',
      VERCEL_URL: 'echo-abc.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'echo-karaoke.vercel.app',
      ALLOWED_ORIGINS: 'https://echo.example, https://echo-preview.vercel.app',
    };

    expect(resolveTrustedOrigins(env)).toEqual([
      'https://echo.example',
      'https://echo-abc.vercel.app',
      'https://echo-karaoke.vercel.app',
      'https://echo-preview.vercel.app',
    ]);
  });

  it('canonicalizes configured origins and refuses wildcard entries', () => {
    const env = {
      ALLOWED_ORIGINS: 'echo.example/join, https://echo.example/, *, https://*.evil.example',
    };

    expect(resolveTrustedOrigins(env)).toEqual([
      'http://127.0.0.1:3000',
      'https://echo.example',
    ]);
  });
});
