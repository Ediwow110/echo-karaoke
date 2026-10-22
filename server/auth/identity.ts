import { fetchJwks } from './jwks';

export type VerifiedIdentity = { userId: string; isAnonymous: boolean };

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
  jwksUrl: string,
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

  const keys = await fetchJwks(jwksUrl);
  const key = keys.find((entry) => entry.kid === header.kid);
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
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    throw new Error('the token has expired');
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
  const origin = new URL(request.url).origin;
  const identity = await verifyBearerToken(token, `${origin}/api/auth/jwks`);
  return { userId: identity.userId, accessToken: token };
}
