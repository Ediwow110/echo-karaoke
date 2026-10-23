import { describe, expect, it } from 'vitest';
import { resolveRoomMemberLimit, resolveSignInLimit } from '../../server/operations/limits';
import { clientIp, isTrustedSignInOrigin, signInSubject } from '../../server/auth/signinLimit';

describe('abuse limits', () => {
  it('uses safe defaults', () => {
    expect(resolveRoomMemberLimit({})).toBe(50);
    expect(resolveSignInLimit({})).toBe(120);
  });

  it('reads valid overrides', () => {
    expect(resolveRoomMemberLimit({ ROOM_MEMBER_LIMIT: '25' })).toBe(25);
    expect(resolveSignInLimit({ ANON_SIGNIN_LIMIT_PER_HOUR: '7' })).toBe(7);
  });

  it('falls back for invalid overrides', () => {
    for (const value of ['0', '1', '501', 'abc', '2.5', '-3']) {
      expect(resolveRoomMemberLimit({ ROOM_MEMBER_LIMIT: value })).toBe(50);
    }
    for (const value of ['0', '1001', 'abc', '1.5', '-3']) {
      expect(resolveSignInLimit({ ANON_SIGNIN_LIMIT_PER_HOUR: value })).toBe(120);
    }
  });

  it('takes the first forwarded address, then the real IP', () => {
    const forwarded = new Request('https://app.example/api/auth/sign-in/anonymous', {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    });
    const real = new Request('https://app.example/', {
      headers: { 'x-real-ip': '198.51.100.7' },
    });
    const missing = new Request('https://app.example/');

    expect(clientIp(forwarded)).toBe('203.0.113.5');
    expect(clientIp(real)).toBe('198.51.100.7');
    expect(clientIp(missing)).toBe('unknown');
  });

  it('accepts the app origins and refuses a cross-site sign-in', () => {
    const env = {
      BETTER_AUTH_URL: 'https://echo.example',
      ALLOWED_ORIGINS: 'https://preview.example',
    };
    const request = (origin?: string): Request => new Request('https://echo.example/api/auth/sign-in/anonymous', {
      method: 'POST',
      headers: origin === undefined ? {} : { origin },
    });

    expect(isTrustedSignInOrigin(request('https://echo.example'), env)).toBe(true);
    expect(isTrustedSignInOrigin(request('https://preview.example'), env)).toBe(true);
    expect(isTrustedSignInOrigin(request('https://evil.example'), env)).toBe(false);
    expect(isTrustedSignInOrigin(request(), env)).toBe(true);
  });

  it('hashes the address without storing it in the subject', () => {
    const subject = signInSubject('203.0.113.5', 'test-secret');
    expect(subject).toMatch(/^signin:[0-9a-f]{64}$/);
    expect(subject).not.toContain('203.0.113.5');
    expect(subject).toBe(signInSubject('203.0.113.5', 'test-secret'));
    expect(subject).not.toBe(signInSubject('203.0.113.6', 'test-secret'));
  });
});
