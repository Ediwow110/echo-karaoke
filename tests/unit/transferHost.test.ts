import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; params: unknown[] }>,
  result: undefined as unknown,
  error: null as Error | null,
}));

vi.mock('../../server/db/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db/client.js')>();
  return {
    ...actual,
    serviceDatabase: () => ({
      query: async (text: string, params: unknown[]) => {
        const name = /public\.([a-z_]+)\(/.exec(text)?.[1] ?? 'unknown';
        state.calls.push({ name, params });
        if (state.error !== null) throw state.error;
        return [{ result: state.result }];
      },
    }),
  };
});

const access = vi.hoisted(() => ({ host: vi.fn(async () => undefined) }));
vi.mock('../../server/operations/catalogAccess.js', () => ({
  requireRoomAccess: vi.fn(async () => undefined),
  requireHostAccess: access.host,
}));

import { claimHost, transferHost } from '../../server/operations/transferHost';

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';
const memberId = '7c1f4d0a-2b6e-4a10-9b3c-5d8e1f2a3b4c';
const caller = { userId: 'test-user', accessToken: 'test-access' };

function request(name: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('https://example.test/api/' + name, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ roomId, ...body }),
  });
}

beforeEach(() => {
  state.calls = [];
  state.error = null;
  state.result = { roomId, role: 'guest' };
  access.host.mockClear();
});

describe('handing a room to a guest', () => {
  it('refuses a caller without a host pass, before touching the database', async () => {
    // Operations throw and the router maps the throw, so the assertion is on the
    // rejection and on the database never having been asked.
    await expect(transferHost(request('transfer-host', { memberId }), caller))
      .rejects.toThrow('Only the host can hand over a room');
    expect(state.calls).toEqual([]);
  });

  it('rejects a member id that is not an id, without calling the database', async () => {
    await expect(transferHost(
      request('transfer-host', { memberId: 'not-a-uuid' }, { 'x-room-host-token': 'h'.repeat(40) }),
      caller,
    )).rejects.toThrow();
    expect(state.calls).toEqual([]);
  });

  it('gives the outgoing host a fresh guest pass so they stay in the room', async () => {
    const response = await transferHost(
      request('transfer-host', { memberId }, { 'x-room-host-token': 'h'.repeat(40) }),
      caller,
    );

    expect(response.status).toBe(200);
    const [, , , , guestToken] = state.calls[0].params as [string, string, string, string, string];
    expect(guestToken.length).toBeGreaterThanOrEqual(32);
    const body = await response.json() as { guestToken: string };
    expect(body.guestToken).toBe(guestToken);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('mints a different guest pass for every transfer', async () => {
    const headers = { 'x-room-host-token': 'h'.repeat(40) };
    await transferHost(request('transfer-host', { memberId }, headers), caller);
    await transferHost(request('transfer-host', { memberId }, headers), caller);

    expect(state.calls[0].params[4]).not.toBe(state.calls[1].params[4]);
  });

  it('surfaces a denied transfer instead of answering an empty success', async () => {
    state.error = new Error('permission denied for function room_transfer_host');

    await expect(transferHost(
      request('transfer-host', { memberId }, { 'x-room-host-token': 'h'.repeat(40) }),
      caller,
    )).rejects.toThrow();
  });
});

describe('claiming a transferred room', () => {
  it('requires the guest pass the member already holds', async () => {
    await expect(claimHost(request('claim-host', {}), caller)).rejects.toThrow();
    expect(state.calls).toEqual([]);
  });

  it('hands the new host pass to the only device that should hold it', async () => {
    state.result = { roomId, memberId, hostToken: 'minted' };
    const response = await claimHost(
      request('claim-host', {}, { 'x-room-guest-token': 'g'.repeat(40) }),
      caller,
    );

    expect(response.status).toBe(200);
    const call = state.calls[0];
    expect(call.name).toBe('room_claim_host');
    expect(call.params[2]).toBe('g'.repeat(40));
    expect(String(call.params[3]).length).toBeGreaterThanOrEqual(32);
    const body = await response.json() as { hostToken: string };
    expect(body.hostToken).toBe(call.params[3]);
  });
});
