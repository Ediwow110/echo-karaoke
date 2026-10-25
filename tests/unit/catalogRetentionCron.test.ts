import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params: unknown[]) => Promise<unknown[]>>(),
}));

vi.mock('../../server/db/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/db/client.js')>();
  return { ...original, serviceDatabase: () => ({ query: database.query }) };
});

import { catalogRetentionCron } from '../../server/operations/catalogRetention.js';

const SECRET = 'c'.repeat(40);

function request(method = 'GET', authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('Authorization', authorization);
  return new Request('https://example.test/api/cron/catalog-retention', { method, headers });
}

describe('catalog retention scheduled cleanup', () => {
  beforeEach(() => {
    database.query.mockReset();
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('CRON_SECRET', SECRET);
    database.query.mockResolvedValue([{ result: { retiredSongs: 2, retiredCursors: 1 } }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses missing or incorrect bearer tokens without reading the database', async () => {
    expect((await catalogRetentionCron(request())).status).toBe(401);
    expect((await catalogRetentionCron(request('GET', 'Bearer incorrect'))).status).toBe(401);
    expect((await catalogRetentionCron(request('GET', SECRET))).status).toBe(401);
    expect(database.query).not.toHaveBeenCalled();
  });

  it('fails closed outside production or when its secret is not configured', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect((await catalogRetentionCron(request('GET', 'Bearer ' + SECRET))).status).toBe(404);
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('CRON_SECRET', '');
    expect((await catalogRetentionCron(request('GET', 'Bearer ' + SECRET))).status).toBe(503);
    expect(database.query).not.toHaveBeenCalled();
  });

  it('allows only GET and invokes the one retiring RPC without a room session', async () => {
    expect((await catalogRetentionCron(request('POST', 'Bearer ' + SECRET))).status).toBe(405);
    const response = await catalogRetentionCron(request('GET', 'Bearer ' + SECRET));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, retiredSongs: 2, retiredCursors: 1 });
    expect(database.query).toHaveBeenCalledTimes(1);
    expect(database.query.mock.calls[0]?.[0]).toBe('select public.karaoke_catalog_retire_stale() as result');
    expect(database.query.mock.calls[0]?.[1]).toEqual([]);
  });

  it('reports a minimal failure and never exposes database diagnostics', async () => {
    database.query.mockRejectedValue(new Error('sensitive database connection context'));
    const response = await catalogRetentionCron(request('GET', 'Bearer ' + SECRET));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('sensitive');
  });
});
