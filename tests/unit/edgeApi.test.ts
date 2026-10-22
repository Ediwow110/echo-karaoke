import { describe, expect, it, vi } from 'vitest';
import { createEdgeApi, RoomApiError } from '../../src/lib/edgeApi';

type Call = { url: string; init: RequestInit };

function fakeFetch(response: { status: number; body: unknown }): { calls: Call[]; impl: typeof fetch } {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

function headersOf(call: Call): Record<string, string> {
  return (call.init.headers ?? {}) as Record<string, string>;
}

const base = {
  url: 'http://local.test',
  anonKey: 'anon-key',
  getAccessToken: async () => 'access-token',
};

describe('edge api client', () => {
  it('calls the function endpoint with session and public key headers', async () => {
    const { calls, impl } = fakeFetch({ status: 200, body: { ok: true } });
    const api = createEdgeApi({ ...base, fetchImpl: impl });

    await api.invoke('join-room', { code: 'ABCDEFGHJKMNPQRS', displayName: 'Ana' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://local.test/functions/v1/join-room');
    expect(calls[0].init.method).toBe('POST');
    const headers = headersOf(calls[0]);
    expect(headers.Authorization).toBe('Bearer access-token');
    expect(headers.apikey).toBe('anon-key');
    expect(headers['x-room-guest-token']).toBeUndefined();
    expect(headers['x-room-host-token']).toBeUndefined();
  });

  it('sends the guest token only when supplied', async () => {
    const { calls, impl } = fakeFetch({ status: 200, body: {} });
    const api = createEdgeApi({ ...base, fetchImpl: impl });

    await api.invoke('guest-room-read', { roomId: 'r' }, { guestToken: 'guest-secret' });

    expect(headersOf(calls[0])['x-room-guest-token']).toBe('guest-secret');
    expect(headersOf(calls[0])['x-room-host-token']).toBeUndefined();
  });

  it('uses the cached token and keepalive for exit requests', async () => {
    const getAccessToken = vi.fn(async () => 'fresh-token');
    const { calls, impl } = fakeFetch({ status: 200, body: {} });
    const api = createEdgeApi({
      ...base,
      getAccessToken,
      getCachedAccessToken: () => 'cached-token',
      fetchImpl: impl,
    });

    await api.invoke('playback-command', { roomId: 'r', action: 'pause' }, { hostToken: 'host-secret' }, { keepalive: true });

    expect(getAccessToken).not.toHaveBeenCalled();
    expect(headersOf(calls[0]).Authorization).toBe('Bearer cached-token');
    expect(calls[0].init.keepalive).toBe(true);
  });

  it('sends the host token only when supplied', async () => {
    const { calls, impl } = fakeFetch({ status: 200, body: {} });
    const api = createEdgeApi({ ...base, fetchImpl: impl });

    await api.invoke('host-command', { roomId: 'r', action: 'lock' }, { hostToken: 'host-secret' });

    expect(headersOf(calls[0])['x-room-host-token']).toBe('host-secret');
    expect(headersOf(calls[0])['x-room-guest-token']).toBeUndefined();
  });

  it('raises a typed error with the server code and status', async () => {
    const { impl } = fakeFetch({
      status: 409,
      body: { error: { code: 'ROOM_ENDED', message: 'This room has ended' } },
    });
    const api = createEdgeApi({ ...base, fetchImpl: impl });

    await expect(api.invoke('join-room', { code: 'x' })).rejects.toMatchObject({
      code: 'ROOM_ENDED',
      status: 409,
    });
    await expect(api.invoke('join-room', { code: 'x' })).rejects.toBeInstanceOf(RoomApiError);
  });

  it('refuses to call without a session', async () => {
    const { impl } = fakeFetch({ status: 200, body: {} });
    const api = createEdgeApi({ ...base, getAccessToken: async () => null, fetchImpl: impl });

    await expect(api.invoke('create-room', { displayName: 'Ana' })).rejects.toMatchObject({
      code: 'NO_SESSION',
    });
  });

  it('reports a network failure as a typed error', async () => {
    const impl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const api = createEdgeApi({ ...base, fetchImpl: impl });

    await expect(api.invoke('create-room', { displayName: 'Ana' })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('never logs tokens', async () => {
    const { impl } = fakeFetch({ status: 200, body: {} });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const api = createEdgeApi({ ...base, fetchImpl: impl });

    await api.invoke('guest-room-read', { roomId: 'r' }, { guestToken: 'guest-secret-value' });

    const calls = [...log.mock.calls, ...info.mock.calls, ...debug.mock.calls];
    expect(JSON.stringify(calls)).not.toContain('guest-secret-value');
    log.mockRestore();
    info.mockRestore();
    debug.mockRestore();
  });
});
