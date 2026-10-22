import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Header = { key: string; value: string };
type VercelConfig = {
  buildCommand?: string;
  outputDirectory?: string;
  rewrites?: { source: string; destination: string }[];
  headers?: { source: string; headers: Header[] }[];
};

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as VercelConfig;
const globalHeaders = config.headers?.find((entry) => entry.source === '/(.*)')?.headers ?? [];
const header = (key: string): string =>
  globalHeaders.find((entry) => entry.key === key)?.value ?? '';

describe('Vercel deployment configuration', () => {
  it('runs the deploy guard and builds the static output', () => {
    expect(config.buildCommand).toContain('npm run verify:deploy');
    expect(config.buildCommand).toContain('npm run build');
    expect(config.outputDirectory).toBe('dist');
  });

  it('rewrites SPA routes but leaves static files alone', () => {
    const source = config.rewrites?.[0]?.source ?? '';
    const route = new RegExp('^' + source + '$');
    expect(route.test('/room/abc/host')).toBe(true);
    expect(route.test('/join/CODE')).toBe(true);
    expect(route.test('/assets/index.js')).toBe(false);
    expect(route.test('/fonts/inter-latin.woff2')).toBe(false);
    expect(route.test('/favicon.svg')).toBe(false);
  });

  it('sends the API routes to the function and the rest to the app', () => {
    const source = config.rewrites?.[0]?.source ?? '';
    const route = new RegExp('^' + source + '$');
    expect(route.test('/api/create-room')).toBe(false);
    expect(route.test('/api/auth/token')).toBe(false);
    expect(route.test('/room/abc/host')).toBe(true);
  });

  it('sets a restrictive CSP for the same-origin API and YouTube', () => {
    const csp = header('Content-Security-Policy');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('script-src');
    expect(csp).toContain('frame-src');
    expect(csp).toContain('https://www.youtube.com');
    expect(csp).toContain("connect-src 'self' https://www.youtube.com");
    expect(csp).not.toContain('supabase');
    expect(csp).not.toContain('default-src *');
  });

  it('allows the feedback script that Vercel injects into the served HTML', () => {
    // Vercel appends this script to every page it serves, and the script opens
    // a feedback frame. Without both allowances the browser reports a policy
    // violation on every page load.
    const csp = header('Content-Security-Policy');
    expect(csp).toMatch(/script-src[^;]*https:\/\/vercel\.live/);
    expect(csp).toMatch(/frame-src[^;]*https:\/\/vercel\.live/);
  });

  it('sets baseline security headers and asset caching', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Referrer-Policy')).toBe('no-referrer');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Permissions-Policy')).toContain('camera=(self)');
    expect(header('Strict-Transport-Security')).toContain('max-age=');
    const assets = config.headers?.find((entry) => entry.source === '/assets/(.*)')?.headers ?? [];
    expect(assets.find((entry) => entry.key === 'Cache-Control')?.value).toContain('immutable');
  });
});
