import { describe, expect, it } from 'vitest';
import { resolveE2EBaseURL } from '../../scripts/e2e-target.mjs';

// The real-browser suite drives whatever it is pointed at, and its old default was
// `vercel dev` on 127.0.0.1:3000 — a server whose database URLs name production
// Neon. Every room, queue row and catalog cursor that suite writes lands in
// production, so the target has to be named out loud and a production origin has
// to be refused rather than warned about.
describe('e2e target guard', () => {
  it('refuses to guess a target when E2E_BASE_URL is absent', () => {
    expect(() => resolveE2EBaseURL({})).toThrow(/E2E_BASE_URL/);
    // The operator hitting this is about to point Playwright at a live server, so
    // name the hazard and the procedure instead of a bare "required".
    const message = catchMessage(() => resolveE2EBaseURL({}));
    expect(message).toContain('vercel dev');
    expect(message).toContain('production');
    expect(message).toContain('docs/deployment/hosted-setup.md');
  });

  it('accepts an explicitly named disposable target', () => {
    expect(resolveE2EBaseURL({ E2E_BASE_URL: 'https://branch-deployment.example/' }))
      .toBe('https://branch-deployment.example');
    expect(resolveE2EBaseURL({ E2E_BASE_URL: 'https://echo-git-abc123.vercel.app' }))
      .toBe('https://echo-git-abc123.vercel.app');
  });

  it('refuses a loopback target until the branch behind it is confirmed', () => {
    // Naming the hazard did not defuse it: the same URL writes real rooms into
    // production whether or not the operator remembered the warning, and nothing
    // in the URL itself says which database is behind the port.
    expect(() => resolveE2EBaseURL({ E2E_BASE_URL: 'http://127.0.0.1:3000' })).toThrow(/E2E_BRANCH_TARGET_CONFIRMED/);
    const message = catchMessage(() => resolveE2EBaseURL({ E2E_BASE_URL: 'http://localhost:3000' }));
    expect(message).toContain('vercel dev');
    expect(message).toContain('disposable branch');
  });

  it('accepts loopback once the caller confirms the branch behind it', () => {
    expect(resolveE2EBaseURL({ E2E_BASE_URL: 'http://127.0.0.1:3000', E2E_BRANCH_TARGET_CONFIRMED: '1' }))
      .toBe('http://127.0.0.1:3000');
    expect(() => resolveE2EBaseURL({ E2E_BASE_URL: 'http://127.0.0.1:3000', E2E_BRANCH_TARGET_CONFIRMED: '0' }))
      .toThrow(/E2E_BRANCH_TARGET_CONFIRMED/);
  });

  it('refuses the documented production origin even when named', () => {
    expect(() => resolveE2EBaseURL({ E2E_BASE_URL: 'https://echo-karaoke-mocha.vercel.app' }))
      .toThrow(/production/);
    expect(() => resolveE2EBaseURL({ E2E_BASE_URL: 'https://echo-karaoke-mocha.vercel.app/room/x' }))
      .toThrow(/production/);
    // The confirmation is about a local port's database, not a licence to drive
    // production, so it must not unlock the origin it already refuses.
    expect(() => resolveE2EBaseURL({
      E2E_BASE_URL: 'https://echo-karaoke-mocha.vercel.app',
      E2E_BRANCH_TARGET_CONFIRMED: '1',
    })).toThrow(/production/);
  });

  it('accepts a preview deployment on the same vercel.app host', () => {
    // Preview deploys get their own subdomain and their own PREVIEW_* database
    // URLs, so the host suffix alone is not evidence of a production target.
    expect(resolveE2EBaseURL({ E2E_BASE_URL: 'https://echo-git-abc123.vercel.app' }))
      .toBe('https://echo-git-abc123.vercel.app');
  });

  it('rejects anything that is not an http(s) origin', () => {
    for (const value of ['', 'ftp://example', 'not a url', 'file:///tmp/app']) {
      expect(() => resolveE2EBaseURL({ E2E_BASE_URL: value }), value).toThrow(/E2E_BASE_URL/);
    }
  });
});

function catchMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the guard to throw');
}
