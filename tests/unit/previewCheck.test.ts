import { describe, expect, it } from 'vitest';
import { checkPreview } from '../../scripts/check-preview.mjs';

type Route = { status: number; headers: Record<string, string>; body: string };

const HOME_HTML = [
  '<!doctype html><html lang="en"><head><title>ECHO</title>',
  '<script type="module" crossorigin src="/assets/index-abc123.js"></script>',
  '</head><body><div id="root"></div></body></html>',
].join('');

const DEFAULT_CSP = [
  "default-src 'self'",
  'base-uri \'self\'',
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://i.ytimg.com",
  "font-src 'self'",
  "connect-src 'self' https://www.youtube.com",
  'frame-src https://www.youtube.com',
  "media-src 'self' blob: https://www.youtube.com",
].join('; ');

const HOME_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
};

const SPA_ROUTE = 'https://app.example/room/00000000-0000-0000-0000-000000000000/host';
const ASSET = 'https://app.example/assets/index-abc123.js';
const JWKS = 'https://app.example/api/auth/jwks';
const API_PROBE = 'https://app.example/api/__preview_check__';

function fakeFetch(routes: Record<string, Route>) {
  return async (
    input: string | URL,
    init?: { redirect?: 'manual'; headers?: Record<string, string> },
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const route = routes[url];
    if (route === undefined) {
      throw new Error('Unexpected request: ' + url);
    }
    lastRequest = { url, headers: init?.headers ?? {} };
    return new Response(route.body, { status: route.status, headers: route.headers });
  };
}

let lastRequest: { url: string; headers: Record<string, string> } = { url: '', headers: {} };

function goodRoutes(csp = DEFAULT_CSP): Record<string, Route> {
  return {
    'https://app.example/': {
      status: 200,
      headers: { ...HOME_HEADERS, 'content-security-policy': csp },
      body: HOME_HTML,
    },
    [ASSET]: {
      status: 200,
      headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=31536000, immutable' },
      body: 'export const nothing = true;',
    },
    [SPA_ROUTE]: { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: HOME_HTML },
    [JWKS]: {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys: [{ kid: 'key-1', kty: 'OKP' }] }),
    },
    [API_PROBE]: {
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'That operation is not available' } }),
    },
  };
}

describe('preview verification', () => {
  it('passes a deployment with headers, CSP, SPA fallback, cached assets, and a working API', async () => {
    const result = await checkPreview('https://app.example', { fetchImpl: fakeFetch(goodRoutes()) });

    expect(result.errors).toEqual([]);
  });

  it('reports a deployment that is missing a security header', async () => {
    const routes = goodRoutes();
    delete routes['https://app.example/'].headers['x-frame-options'];

    const result = await checkPreview('https://app.example', { fetchImpl: fakeFetch(routes) });

    expect(result.errors).toContain('Missing x-frame-options header.');
  });

  it('reports a CSP that drops a required directive', async () => {
    const result = await checkPreview('https://app.example', {
      fetchImpl: fakeFetch(goodRoutes("default-src 'self'; connect-src 'self'")),
    });

    expect(result.errors).toContain('The CSP is missing frame-ancestors \'none\'.');
  });

  it('reports a CSP that does not confine the API to the same origin', async () => {
    const csp = "default-src 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; connect-src *";
    const result = await checkPreview('https://app.example', { fetchImpl: fakeFetch(goodRoutes(csp)) });

    expect(result.errors).toContain('The CSP is missing connect-src \'self\'.');
  });

  it('reports an eval-capable script policy and a zero HSTS lifetime', async () => {
    const routes = goodRoutes();
    routes['https://app.example/'].headers['content-security-policy'] = DEFAULT_CSP.replace(
      "script-src 'self' https://www.youtube.com https://s.ytimg.com",
      "script-src 'self' 'unsafe-eval'",
    );
    routes['https://app.example/'].headers['strict-transport-security'] = 'max-age=0';

    const result = await checkPreview('https://app.example', { fetchImpl: fakeFetch(routes) });

    expect(result.errors).toContain('The CSP script-src is not restrictive.');
    expect(result.errors).toContain('Strict-Transport-Security max-age is too short.');
  });

  it('reports a database connection string in the HTML', async () => {
    const routes = goodRoutes();
    routes['https://app.example/'].body = HOME_HTML.replace(
      '<div id="root"></div>',
      '<div id="root" data-db="postgresql://user:pass@host/db"></div>',
    );

    const result = await checkPreview('https://app.example', { fetchImpl: fakeFetch(routes) });

    expect(result.errors).toContain('A database connection string is present in the served HTML.');
  });

  it('reports a database connection string in the main asset', async () => {
    const routes = goodRoutes();
    routes[ASSET].body = 'const url = "postgresql://user:pass@host/db";';

    const result = await checkPreview('https://app.example', { fetchImpl: fakeFetch(routes) });

    expect(result.errors).toContain('A database connection string is present in the served main asset.');
  });

  it('reports a JWKS endpoint that returns no keys', async () => {
    const routes = goodRoutes();
    routes[JWKS].body = JSON.stringify({ keys: [] });

    const result = await checkPreview('https://app.example', { fetchImpl: fakeFetch(routes) });

    expect(result.errors).toContain('The JWKS endpoint returned no keys.');
  });

  it('reports an API route that the rewrite sends to the app shell', async () => {
    const routes = goodRoutes();
    routes[API_PROBE] = {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: HOME_HTML,
    };

    const result = await checkPreview('https://app.example', { fetchImpl: fakeFetch(routes) });

    expect(result.errors).toContain('The API probe returned 200 instead of 404.');
    expect(result.errors).toContain('The API probe did not answer as JSON.');
  });

  it('reports a deep route that does not fall back to the app HTML', async () => {
    const routes = goodRoutes();
    routes[SPA_ROUTE] = { status: 200, headers: { 'content-type': 'application/json' }, body: '{}' };

    const result = await checkPreview('https://app.example', { fetchImpl: fakeFetch(routes) });

    expect(result.errors).toContain('The SPA route did not return the app HTML.');
  });

  it('reports a hashed asset that is not cached immutably', async () => {
    const routes = goodRoutes();
    routes[ASSET] = {
      status: 200,
      headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=3600' },
      body: 'export const nothing = true;',
    };

    const result = await checkPreview('https://app.example', { fetchImpl: fakeFetch(routes) });

    expect(result.errors).toContain('cache-control does not contain immutable.');
  });

  it('refuses a plain HTTP target that is not a loopback address', async () => {
    const result = await checkPreview('http://app.example', { fetchImpl: fakeFetch({}) });

    expect(result.errors).toContain('Use HTTPS for a deployed preview.');
  });

  it('sends the protection bypass token so a protected preview can be checked', async () => {
    const result = await checkPreview('https://app.example', {
      fetchImpl: fakeFetch(goodRoutes()),
      bypassToken: 'bx-secret-token',
    });

    expect(result.errors).toEqual([]);
    expect(lastRequest.headers['x-vercel-protection-bypass']).toBe('bx-secret-token');
  });

  it('sends no bypass header when no token was given', async () => {
    await checkPreview('https://app.example', { fetchImpl: fakeFetch(goodRoutes()) });

    expect(lastRequest.headers['x-vercel-protection-bypass']).toBeUndefined();
  });

  it('names the sign-in wall when the deployment is behind Vercel Authentication', async () => {
    const routes = goodRoutes();
    routes['https://app.example/'] = {
      status: 302,
      headers: { location: 'https://vercel.com/sso-api?url=https%3A%2F%2Fapp.example%2F' },
      body: '',
    };

    const result = await checkPreview('https://app.example', { fetchImpl: fakeFetch(routes) });

    expect(result.errors).toContain(
      'The deployment is behind Vercel Authentication, so the check cannot read it.',
    );
    expect(result.errors).not.toContain('Missing x-frame-options header.');
  });
});
