import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  params: [] as unknown[],
  result: undefined as unknown,
  error: null as Error | null,
  names: [] as string[],
  allowed: true,
}));

vi.mock('../../server/db/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db/client.js')>();
  return {
    ...actual,
    serviceDatabase: () => ({
      query: async (text: string, params: unknown[]) => {
        state.names.push(text);
        if (text.includes('consume_rate_limit')) {
          return [{ result: { allowed: state.allowed } }];
        }
        state.params = params;
        if (state.error !== null) throw state.error;
        return [{ result: state.result }];
      },
    }),
  };
});

vi.mock('../../server/operations/catalogAccess.js', () => ({
  requireRoomAccess: vi.fn(async () => undefined),
}));

import { catalogPage } from '../../server/operations/catalogBrowse';

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';
const caller = { userId: 'test-user', accessToken: 'test-access' };

async function call(body: Record<string, unknown>): Promise<Response> {
  return catalogPage(new Request('https://example.test/api/catalog-page', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomId, ...body }),
  }), caller);
}

beforeEach(() => {
  state.params = [];
  state.result = { total: 0, items: [] };
  state.error = null;
  state.names = [];
  state.allowed = true;
});

describe('catalog page request bounds', () => {
  it('caps repeated catalog scans per member', async () => {
    state.allowed = false;

    await expect(call({ query: 'halo' })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(state.names.some((text) => text.includes('karaoke_catalog_page'))).toBe(false);
  });

  it('charges the member before the scan', async () => {
    await call({ query: 'halo' });

    const charge = state.names.findIndex((text) => text.includes('consume_rate_limit'));
    const scan = state.names.findIndex((text) => text.includes('karaoke_catalog_page'));
    expect(charge).toBeGreaterThanOrEqual(0);
    expect(charge).toBeLessThan(scan);
  });
  it('never forwards an offset the integer column cannot hold', async () => {
    // Number.isInteger accepts 1e15, and Postgres rejects it as an integer
    // out of range: a guest paging wildly produced a 500 instead of a page.
    const response = await call({ query: '', channel: '', offset: 1e15, limit: 30 });

    expect(response.status).toBe(200);
    const [, , offset] = state.params as [string, string, number, number];
    expect(Number.isInteger(offset)).toBe(true);
    expect(offset).toBeLessThanOrEqual(5000);
    expect(offset).toBeGreaterThanOrEqual(0);
  });

  it('keeps a limit inside the range the query can serve', async () => {
    await call({ limit: 1e9 });
    expect((state.params as [string, string, number, number])[3]).toBeLessThanOrEqual(50);

    await call({ limit: 0 });
    expect((state.params as [string, string, number, number])[3]).toBeGreaterThanOrEqual(1);
  });

  it('passes through a normal page unchanged', async () => {
    await call({ query: 'halo', channel: '@vinylktv', offset: 30, limit: 20 });
    expect(state.params).toEqual(['halo', '@vinylktv', 30, 20]);
  });

  it('reports the real reason when the function returns nothing', async () => {
    // The throw sat inside its own try, so mapDatabaseError replaced the
    // specific message with the generic one and the detail was unreachable.
    state.result = null;
    await expect(call({})).rejects.toThrow('The songbook returned no result');
  });
});
