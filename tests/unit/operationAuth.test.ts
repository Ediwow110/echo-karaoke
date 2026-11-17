import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  error: new Error('the token was issued for a different deployment'),
}));

vi.mock('../../server/auth/identity.js', () => ({
  requireAnonymousCaller: vi.fn(async () => { throw auth.error; }),
}));

vi.mock('../../server/db/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/db/client.js')>();
  return {
    ...original,
    serviceDatabase: () => ({ query: async () => [{ result: null }] }),
  };
});

import { handleOperation } from '../../server/operations/index';

describe('operation auth failures', () => {
  it('returns 401 when the token was issued for a different deployment', async () => {
    const response = await handleOperation(new Request('http://localhost/api/create-room', {
      method: 'POST',
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    });
  });
});
