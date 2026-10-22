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
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.youtube.com",
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

function fakeFetch(routes: Record<string, Route>) {
  return async (input: string | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const route = routes[url];
    if (route === undefined) {
      throw new Error('Unexpected request: ' + url);
    }
    return new Response(route.body, { status: route.status, headers: route.headers });
  };
}

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
  };
}

describe('preview verification', () => {
  it('passes a deployment that carries the headers, the CSP, the SPA fallback, and cached assets', async () => {
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
      fetchImpl: fakeFetch(goodRoutes("default-src 'self'; connect-src 'self' https://*.supabase.co")),
    });

    expect(result.errors).toContain('The CSP is missing frame-ancestors \'none\'.');
  });

  it('accepts a custom Supabase domain in connect-src when the deployment names it', async () => {
    const csp = "default-src 'self'; frame-ancestors 'none'; connect-src 'self' https://api.echo.example";
    const result = await checkPreview('https://app.example', {
      fetchImpl: fakeFetch(goodRoutes(csp)),
      supabaseUrl: 'https://api.echo.example',
    });

    expect(result.errors).toEqual([]);
  });

  it('reports a CSP that does not allow the Supabase origin the app uses', async () => {
    const csp = "default-src 'self'; frame-ancestors 'none'; connect-src 'self' https://*.supabase.co";

    const result = await checkPreview('https://app.example', {
      fetchImpl: fakeFetch(goodRoutes(csp)),
      supabaseUrl: 'https://api.echo.example',
    });

    expect(result.errors).toContain(
      'The CSP does not allow the Supabase origin https://api.echo.example in connect-src.',
    );
  });

  it('reports a CSP that allows neither the shared Supabase wildcard nor the named origin', async () => {
    const csp = "default-src 'self'; frame-ancestors 'none'; connect-src 'self'";

    const result = await checkPreview('https://app.example', { fetchImpl: fakeFetch(goodRoutes(csp)) });

    expect(result.errors).toContain(
      'The CSP does not allow a Supabase origin in connect-src.',
    );
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
});
