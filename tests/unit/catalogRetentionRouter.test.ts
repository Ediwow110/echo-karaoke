import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cron: vi.fn(async (_request: Request) => Response.json({ ok: true })),
  operation: vi.fn(async () => Response.json({ other: true })),
  auth: vi.fn(async () => Response.json({ authenticated: true })),
}));

vi.mock('../../server/operations/catalogRetention.js', () => ({
  catalogRetentionCron: mocks.cron,
}));
vi.mock('../../server/operations/index.js', () => ({
  handleOperation: mocks.operation,
}));
vi.mock('../../server/auth/auth.js', () => ({
  auth: { handler: mocks.auth },
}));
vi.mock('../../server/auth/signinLimit.js', () => ({
  enforceSignInLimit: vi.fn(async () => null),
}));

import handler from '../../api/router';

describe('Vercel scheduled catalog retention routing', () => {
  beforeEach(() => {
    mocks.cron.mockClear();
    mocks.operation.mockClear();
    mocks.auth.mockClear();
  });

  it('restores the rewritten cron path and never sends it through session auth', async () => {
    const response = await handler.fetch(new Request(
      'https://example.test/api/router?path=cron/catalog-retention',
      { method: 'GET', headers: { authorization: 'Bearer test-only-token' } },
    ));
    expect(response.status).toBe(200);
    expect(mocks.cron).toHaveBeenCalledTimes(1);
    const forwarded = mocks.cron.mock.calls[0]?.[0] as Request;
    expect(new URL(forwarded.url).pathname).toBe('/api/cron/catalog-retention');
    expect(forwarded.headers.get('authorization')).toBe('Bearer test-only-token');
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.operation).not.toHaveBeenCalled();
  });
});
