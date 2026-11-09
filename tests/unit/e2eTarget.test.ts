import { describe, expect, it } from 'vitest';
import { resolveE2EBaseURL } from '../../scripts/e2e-target.mjs';

type LookupAddress = { address: string };
type LookupHost = (hostname: string) => Promise<LookupAddress[]>;

const publicLookup: LookupHost = async () => [{ address: '203.0.113.10' }];
const loopbackLookup: LookupHost = async () => [{ address: '127.0.0.1' }];
const mappedLoopbackLookup: LookupHost = async () => [{ address: '::ffff:7f00:1' }];
const failingLookup: LookupHost = async () => {
  throw new Error('ENOTFOUND');
};

async function rejectionMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the guard to throw');
}

// The real-browser suite drives whatever it is pointed at, and its old default was
// `vercel dev` on 127.0.0.1:3000 — a server whose database URLs name production
// Neon. Every room, queue row and catalog cursor that suite writes lands in
// production, so the target has to be named out loud, resolved, and refused when
// it is production or an unconfirmed local address.
describe('e2e target guard', () => {
  it('refuses to guess a target when E2E_BASE_URL is absent', async () => {
    await expect(resolveE2EBaseURL({}, publicLookup)).rejects.toThrow(/E2E_BASE_URL/);
    const message = await rejectionMessage(() => resolveE2EBaseURL({}, publicLookup));
    expect(message).toContain('vercel dev');
    expect(message).toContain('production');
    expect(message).toContain('docs/deployment/hosted-setup.md');
  });

  it('accepts an explicitly named disposable target over HTTPS', async () => {
    expect(await resolveE2EBaseURL({ E2E_BASE_URL: 'https://branch-deployment.example/' }, publicLookup))
      .toBe('https://branch-deployment.example');
    expect(await resolveE2EBaseURL({ E2E_BASE_URL: 'https://echo-git-abc123.vercel.app' }, publicLookup))
      .toBe('https://echo-git-abc123.vercel.app');
  });

  it('requires HTTPS for a remote target', async () => {
    await expect(resolveE2EBaseURL({ E2E_BASE_URL: 'http://branch-deployment.example' }, publicLookup))
      .rejects.toThrow(/HTTPS/);
  });

  it('refuses an unresolvable remote target', async () => {
    await expect(resolveE2EBaseURL({ E2E_BASE_URL: 'https://missing.example' }, failingLookup))
      .rejects.toThrow(/does not resolve/);
  });

  it('refuses a loopback target until the branch behind it is confirmed', async () => {
    await expect(resolveE2EBaseURL({ E2E_BASE_URL: 'http://127.0.0.1:3000' }, loopbackLookup))
      .rejects.toThrow(/E2E_BRANCH_TARGET_CONFIRMED/);
    const message = await rejectionMessage(
      () => resolveE2EBaseURL({ E2E_BASE_URL: 'http://localhost:3000' }, loopbackLookup),
    );
    expect(message).toContain('vercel dev');
    expect(message).toContain('disposable branch');
  });

  it('resolves hostname aliases instead of trusting the literal host', async () => {
    const aliases: Array<[string, LookupHost]> = [
      ['http://127.0.0.1.nip.io:3000', loopbackLookup],
      ['http://[::ffff:127.0.0.1]:3000', mappedLoopbackLookup],
      ['http://localhost.:3000', loopbackLookup],
      ['http://0x7f000001:3000', loopbackLookup],
    ];
    for (const [base, lookup] of aliases) {
      await expect(resolveE2EBaseURL({ E2E_BASE_URL: base }, lookup), base)
        .rejects.toThrow(/E2E_BRANCH_TARGET_CONFIRMED/);
    }
  });

  it('accepts loopback once the caller confirms the branch behind it', async () => {
    expect(await resolveE2EBaseURL({
      E2E_BASE_URL: 'http://127.0.0.1:3000',
      E2E_BRANCH_TARGET_CONFIRMED: '1',
    }, loopbackLookup)).toBe('http://127.0.0.1:3000');
    await expect(resolveE2EBaseURL({
      E2E_BASE_URL: 'http://127.0.0.1:3000',
      E2E_BRANCH_TARGET_CONFIRMED: '0',
    }, loopbackLookup)).rejects.toThrow(/E2E_BRANCH_TARGET_CONFIRMED/);
  });

  it('refuses all documented production aliases even when named', async () => {
    for (const host of [
      'echo-karaoke-mocha.vercel.app',
      'echo-karaoke-ediwow110s-projects.vercel.app',
      'echo-karaoke-git-master-ediwow110s-projects.vercel.app',
    ]) {
      await expect(resolveE2EBaseURL({ E2E_BASE_URL: 'https://' + host }, publicLookup), host)
        .rejects.toThrow(/production/);
    }
    await expect(resolveE2EBaseURL({
      E2E_BASE_URL: 'https://echo-karaoke-mocha.vercel.app',
      E2E_BRANCH_TARGET_CONFIRMED: '1',
    }, publicLookup)).rejects.toThrow(/production/);
  });

  it('refuses a custom production auth origin from BETTER_AUTH_URL', async () => {
    await expect(resolveE2EBaseURL({
      E2E_BASE_URL: 'https://karaoke.example',
      BETTER_AUTH_URL: 'https://karaoke.example',
    }, publicLookup)).rejects.toThrow(/production/);
  });

  it('accepts a preview deployment on the same vercel.app host', async () => {
    expect(await resolveE2EBaseURL({ E2E_BASE_URL: 'https://echo-git-abc123.vercel.app' }, publicLookup))
      .toBe('https://echo-git-abc123.vercel.app');
  });

  it('rejects anything that is not an http(s) origin', async () => {
    for (const value of ['', 'ftp://example', 'not a url', 'file:///tmp/app']) {
      await expect(resolveE2EBaseURL({ E2E_BASE_URL: value }, publicLookup), value)
        .rejects.toThrow(/E2E_BASE_URL/);
    }
  });
});
