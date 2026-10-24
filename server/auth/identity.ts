import { fetchJwks, type JwksSource } from './jwks.js';
import { resolveBaseUrl } from './origins.js';

export type VerifiedIdentity = { userId: string; isAnonymous: boolean };

// Use the same public-key endpoint in-process, avoiding a nested serverless
// invocation. Keep a stable loader identity for the JWKS cache.
const localJwks = async () => {
  const { auth } = await import('./auth.js');
  return auth.api.getJwks();
};

// An unknown kid normally means a key rotated. It must not become one database
// read per request when a caller sends random values, so forced refreshes are
// rate-limited. A genuinely rotated key is picked up within this window.
const FORCED_REFRESH_COOLDOWN_MS = 30_000;
let lastForcedRefreshAt = 0;

export function jwksUrl(env: Record<string, string | undefined> = process.env): string {
  return resolveBaseUrl(env) + '/api/auth/jwks';
}

function decodePart(part: string): Record<string, unknown> {
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not an object');
    }
    return value as Record<string, unknown>;
  } catch {
    throw new Error('the token is not a JWT');
  }
}

export async function verifyBearerToken(
  token: string,
  source: JwksSource,
  options: { isAnonymous?: boolean } = {},
): Promise<VerifiedIdentity> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('the token is not a JWT');
  }

  const header = decodePart(parts[0]) as { alg?: string; kid?: string };
  const payload = decodePart(parts[1]) as {
    sub?: string;
    isAnonymous?: boolean;
    exp?: number;
  };

  if (header.alg !== 'EdDSA') {
    throw new Error(`the token is signed with an unexpected algorithm: ${header.alg}`);
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('the token carries no subject');
  }
  if (options.isAnonymous !== false && payload.isAnonymous !== true) {
    throw new Error('only an anonymous identity may use this endpoint');
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) {
    throw new Error('the token has expired');
  }

  let key = (await fetchJwks(source)).find((entry) => entry.kid === header.kid);
  if (key === undefined && Date.now() - lastForcedRefreshAt >= FORCED_REFRESH_COOLDOWN_MS) {
    // A rotated key set must not wait out the ten-minute cache.
    lastForcedRefreshAt = Date.now();
    key = (await fetchJwks(source, { force: true })).find((entry) => entry.kid === header.kid);
  }
  if (key === undefined) {
    throw new Error('the token was signed with an unknown key');
  }

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: key.kty, crv: key.crv, x: key.x, y: key.y } as JsonWebKey,
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  const signature = Buffer.from(parts[2], 'base64url');
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
  const valid = await crypto.subtle.verify('Ed25519', publicKey, signature, signed);
  if (!valid) {
    throw new Error('the token signature does not verify');
  }

  return { userId: payload.sub, isAnonymous: payload.isAnonymous === true };
}

export async function requireAnonymousCaller(
  request: Request,
): Promise<{ userId: string; accessToken: string }> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    throw new Error('a signed-in session is required');
  }
  const token = header.slice('bearer '.length).trim();
  const identity = await verifyBearerToken(token, localJwks);
  return { userId: identity.userId, accessToken: token };
}
