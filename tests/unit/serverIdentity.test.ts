import { describe, expect, it } from 'vitest';
import { jwksUrl, requireAnonymousCaller, verifyBearerToken } from '../../server/auth/identity';

const JWKS_URL = 'http://127.0.0.1:9/jwks';

function jwt(header: object, payload: object, signature = 'fake-signature'): string {
  return [
    Buffer.from(JSON.stringify(header)).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    signature,
  ].join('.');
}

describe('bearer token verification', () => {
  it('rejects a token that is not a well formed JWT', async () => {
    await expect(verifyBearerToken('not-a-token', JWKS_URL)).rejects.toThrow(/token/i);
  });

  it('rejects a token with an unexpected algorithm', async () => {
    const token = jwt({ alg: 'HS256', kid: 'fake' }, { sub: 'user-1', isAnonymous: true });
    await expect(verifyBearerToken(token, JWKS_URL)).rejects.toThrow(/algorithm/i);
  });

  it('rejects a token without a subject', async () => {
    const token = jwt({ alg: 'EdDSA', kid: 'fake' }, { isAnonymous: true });
    await expect(verifyBearerToken(token, JWKS_URL)).rejects.toThrow(/subject/i);
  });

  it('rejects a token that is not an anonymous identity', async () => {
    const token = jwt({ alg: 'EdDSA', kid: 'fake' }, { sub: 'user-1', isAnonymous: false });
    await expect(verifyBearerToken(token, JWKS_URL)).rejects.toThrow(/anonymous/i);
  });

  it('rejects a token whose signature does not verify', async () => {
    const forged = jwt(
      { alg: 'EdDSA', kid: 'fake' },
      { sub: 'user-1', isAnonymous: true, exp: Math.floor(Date.now() / 1000) + 60 },
    );
    await expect(verifyBearerToken(forged, JWKS_URL)).rejects.toThrow();
  });

  it('reads the key set from the configured auth origin, not the request host', () => {
    expect(jwksUrl({ BETTER_AUTH_URL: 'https://echo.example' }))
      .toBe('https://echo.example/api/auth/jwks');
    expect(jwksUrl({ VERCEL_URL: 'echo-preview.vercel.app' }))
      .toBe('https://echo-preview.vercel.app/api/auth/jwks');
  });

  it('requires a bearer authorization header', async () => {
    const request = new Request('http://127.0.0.1:3000/api/rooms');
    await expect(requireAnonymousCaller(request)).rejects.toThrow(/signed-in/i);
  });
});
