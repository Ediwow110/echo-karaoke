declare const require: (specifier: string) => { readFileSync(path: string, encoding: 'utf8'): string };
declare const process: { cwd(): string };
import { describe, expect, it } from 'vitest';

const html = require('node:fs').readFileSync(process.cwd() + '/index.html', 'utf8');
const app = require('node:fs').readFileSync(process.cwd() + '/src/app/App.tsx', 'utf8');
const main = require('node:fs').readFileSync(process.cwd() + '/src/main.tsx', 'utf8');

describe('application shell', () => {
  it('loads its fonts from the app itself', () => {
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).toContain('rel="preload"');
    expect(html).toContain('as="font"');
    expect(html).toContain('/fonts/');
  });

  it('matches the browser chrome to the dark stage', () => {
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('content="#100D18"');
  });

  it('keeps each screen in its own bundle chunk', () => {
    // lazyRoute wraps React.lazy with a retry for a chunk request that a quick
    // navigation aborted; the gate is that the screens are still dynamic imports
    // and the first paint does not pull them in.
    expect(app).toContain('lazyRoute(() => import(');
    expect(app).toContain('Suspense');
    expect(app).not.toMatch(/^import .*from '\.\/(Host|Guest|JoinRoomPage|Scan)/m);
  });

  it('boots without a client-side environment check', () => {
    expect(main).not.toContain('publicConfig');
    expect(main).not.toContain('@supabase');
  });

  it('keeps the session client out of the first download', () => {
    expect(main).toContain("await import('./lib/auth')");
    expect(main).not.toMatch(/^import .*'\.\/lib\/auth'/m);
    expect(main).not.toMatch(/^import .*'\.\/lib\/supabase'/m);
  });

  it('warms the session bundle while the landing screen is idle', () => {
    expect(main).toContain('requestIdleCallback');
  });
});
