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
  baseUrl: 'http://local.test',
  getAccessToken: async () => 'access-token',
};

describe('edge api client', () => {
  it('calls the same-origin operation endpoint with the bearer token', async () => {
    const { calls, impl } = fakeFetch({ status: 200, body: { ok: true } });
    const api = createEdgeApi({ ...base, fetchImpl: impl });

    await api.invoke('join-room', { code: 'ABCDEFGHJKMNPQRS', displayName: 'Ana' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://local.test/api/join-room');
    expect(calls[0].init.method).toBe('POST');
    const headers = headersOf(calls[0]);
    expect(headers.Authorization).toBe('Bearer access-token');
    expect(headers.apikey).toBeUndefined();
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

  it('logs the operation, status and duration in development, and nothing else', async () => {
    const { impl } = fakeFetch({ status: 200, body: { ok: true } });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const api = createEdgeApi({ ...base, fetchImpl: impl });

    await api.invoke('queue-command', { roomId: 'room-marker-123' }, { hostToken: 'host-secret-value' });

    expect(debug).toHaveBeenCalledTimes(1);
    const line = debug.mock.calls[0].join(' ');
    expect(line).toContain('queue-command');
    expect(line).toContain('200');
    expect(line).toMatch(/\d+ms/);
    expect(line).not.toContain('host-secret-value');
    expect(line).not.toContain('room-marker-123');
    debug.mockRestore();
  });

  it('marks a network failure in the development log without naming the request', async () => {
    const impl = (async () => { throw new Error('boom'); }) as unknown as typeof fetch;
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const api = createEdgeApi({ ...base, fetchImpl: impl });

    await expect(api.invoke('join-room', { code: 'ABCDEFGHJKMNPQRS' })).rejects.toBeInstanceOf(RoomApiError);

    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug.mock.calls[0].join(' ')).toContain('network');
    debug.mockRestore();
  });

  it('refuses to hand back a success that carries no body', async () => {
    const impl = (async () => new Response('', { status: 200 })) as unknown as typeof fetch;
    const api = createEdgeApi({ ...base, fetchImpl: impl });

    // Every operation answers with an object. A null payload would be stored as
    // the room state, and a guest would be told the host had ended the room.
    await expect(
      api.invoke('guest-room-read', { roomId: 'r' }, { guestToken: 'guest-secret' }),
    ).rejects.toMatchObject({ code: 'EMPTY_RESPONSE', status: 200 });
  });

  it('reports an unreadable response body as a network failure', async () => {
    const impl = (async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new TypeError('network error while reading the body');
      },
    })) as unknown as typeof fetch;
    const api = createEdgeApi({ ...base, fetchImpl: impl });

    await expect(
      api.invoke('guest-room-read', { roomId: 'r' }, { guestToken: 'guest-secret' }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
