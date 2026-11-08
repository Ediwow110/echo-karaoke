import { describe, expect, it } from 'vitest';
import { resolveBaseUrl } from '../../server/auth/origins';

function part(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('JWKS forced refresh', () => {
  it('does not force a database read for every unknown kid', async () => {
    let sourceCalls = 0;
    const source = async () => {
      sourceCalls += 1;
      return { keys: [] };
    };
    const deployment = resolveBaseUrl();
    const token = [
      part({ alg: 'EdDSA', kid: 'not-a-key' }),
      part({
        sub: 'person',
        isAnonymous: true,
        iss: deployment,
        aud: deployment,
        exp: Math.floor(Date.now() / 1000) + 600,
      }),
      'signature',
    ].join('.');

    const { verifyBearerToken } = await import('../../server/auth/identity.js');
    await expect(verifyBearerToken(token, source)).rejects.toThrow('unknown key');
    const afterFirst = sourceCalls;
    await expect(verifyBearerToken(token, source)).rejects.toThrow('unknown key');

    expect(afterFirst).toBe(2);
    expect(sourceCalls).toBe(afterFirst);
  });
});
