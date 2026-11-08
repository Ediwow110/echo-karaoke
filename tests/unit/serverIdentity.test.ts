import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jwksUrl, requireAnonymousCaller, verifyBearerToken } from '../../server/auth/identity';
import { resolveBaseUrl } from '../../server/auth/origins';

const { getJwks } = vi.hoisted(() => ({ getJwks: vi.fn() }));
vi.mock('../../server/auth/auth', () => ({ auth: { api: { getJwks } } }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const JWKS_URL = 'http://127.0.0.1:9/jwks';
const DEPLOYMENT = resolveBaseUrl();

function anonymousClaims(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: 'user-1',
    isAnonymous: true,
    iss: DEPLOYMENT,
    aud: DEPLOYMENT,
    ...extra,
  };
}

function jwt(header: object, payload: object, signature = 'fake-signature'): string {
  return [
    Buffer.from(JSON.stringify(header)).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    signature,
  ].join('.');
}

describe('bearer token verification', () => {
  it('verifies signed callers using local public keys without an HTTP self-fetch', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const keys = [{ ...publicKey.export({ format: 'jwk' }), kid: 'local-key' }];
    getJwks.mockResolvedValue({ keys });
    const fetchSpy = vi.fn(() => { throw new Error('HTTP key lookup must not run'); });
    vi.stubGlobal('fetch', fetchSpy);
    const unsigned = jwt(
      { alg: 'EdDSA', kid: 'local-key' },
      anonymousClaims({ exp: Math.floor(Date.now() / 1000) + 60 }),
    ).split('.').slice(0, 2).join('.');
    const signature = sign(null, Buffer.from(unsigned), privateKey);
    const token = `${unsigned}.${signature.toString('base64url')}`;
    const request = new Request('http://untrusted.example/api/host-room-read', {
      headers: { authorization: `Bearer ${token}` },
    });

    await expect(requireAnonymousCaller(request))
      .resolves.toEqual({ userId: 'user-1', accessToken: token });
    expect(getJwks).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    signature[0] ^= 1;
    const tampered = `${unsigned}.${signature.toString('base64url')}`;
    await expect(verifyBearerToken(tampered, async () => ({ keys })))
      .rejects.toThrow('the token signature does not verify');
  });

  it('rejects expired tokens before loading keys', async () => {
    const token = jwt(
      { alg: 'EdDSA', kid: 'expired' },
      anonymousClaims({ exp: Math.floor(Date.now() / 1000) - 1 }),
    );
    await expect(verifyBearerToken(token, JWKS_URL)).rejects.toThrow('the token has expired');
  });

  it('refreshes cached local public keys when a signed token uses a rotated key', async () => {
    const first = generateKeyPairSync('ed25519');
    const second = generateKeyPairSync('ed25519');
    let keys = [{ ...first.publicKey.export({ format: 'jwk' }), kid: 'first' }];
    const source = vi.fn(async () => ({ keys }));
    const signedToken = (kid: string, privateKey: typeof first.privateKey) => {
      const unsigned = jwt(
        { alg: 'EdDSA', kid },
        anonymousClaims({ exp: Math.floor(Date.now() / 1000) + 60 }),
      ).split('.').slice(0, 2).join('.');
      return `${unsigned}.${sign(null, Buffer.from(unsigned), privateKey).toString('base64url')}`;
    };

    await expect(verifyBearerToken(signedToken('first', first.privateKey), source))
      .resolves.toEqual({ userId: 'user-1', isAnonymous: true });
    keys = [{ ...second.publicKey.export({ format: 'jwk' }), kid: 'second' }];
    await expect(verifyBearerToken(signedToken('second', second.privateKey), source))
      .resolves.toEqual({ userId: 'user-1', isAnonymous: true });
    expect(source).toHaveBeenCalledTimes(2);

    await expect(verifyBearerToken(signedToken('unknown', second.privateKey), source))
      .rejects.toThrow('the token was signed with an unknown key');
  });

  it('rejects a token that is not a well formed JWT', async () => {
    await expect(verifyBearerToken('not-a-token', JWKS_URL)).rejects.toThrow(/token/i);
  });

  it('rejects a token with an unexpected algorithm', async () => {
    const token = jwt({ alg: 'HS256', kid: 'fake' }, anonymousClaims());
    await expect(verifyBearerToken(token, JWKS_URL)).rejects.toThrow(/algorithm/i);
  });

  it('rejects a token without a subject', async () => {
    const token = jwt({ alg: 'EdDSA', kid: 'fake' }, anonymousClaims({ sub: undefined }));
    await expect(verifyBearerToken(token, JWKS_URL)).rejects.toThrow(/subject/i);
  });

  it('rejects a token that is not an anonymous identity', async () => {
    const token = jwt({ alg: 'EdDSA', kid: 'fake' }, anonymousClaims({ isAnonymous: false }));
    await expect(verifyBearerToken(token, JWKS_URL)).rejects.toThrow(/anonymous/i);
  });

  it('rejects a token whose signature does not verify', async () => {
    const forged = jwt(
      { alg: 'EdDSA', kid: 'fake' },
      anonymousClaims({ exp: Math.floor(Date.now() / 1000) + 60 }),
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

  // These run last in the file: an unknown kid forces a JWKS refresh, and the
  // cooldown is module state that must not suppress a later legitimate refresh.
  it('rejects a correctly signed token minted for another deployment', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const keys = [{ ...publicKey.export({ format: 'jwk' }), kid: 'local-key' }];
    const unsigned = jwt(
      { alg: 'EdDSA', kid: 'local-key' },
      anonymousClaims({
        exp: Math.floor(Date.now() / 1000) + 60,
        iss: 'https://other.example',
        aud: 'https://other.example',
      }),
    ).split('.').slice(0, 2).join('.');
    const token = `${unsigned}.${sign(null, Buffer.from(unsigned), privateKey).toString('base64url')}`;

    await expect(verifyBearerToken(token, async () => ({ keys })))
      .rejects.toThrow(/issuer|audience|deployment/i);
  });

  it('rejects a token that names no deployment at all', async () => {
    const token = jwt(
      { alg: 'EdDSA', kid: 'fake' },
      { sub: 'user-1', isAnonymous: true, exp: Math.floor(Date.now() / 1000) + 60 },
    );

    await expect(verifyBearerToken(token, async () => ({ keys: [] })))
      .rejects.toThrow(/issuer|audience|deployment/i);
  });
});
