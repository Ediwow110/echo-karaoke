import { describe, expect, it } from 'vitest';
import { createEdgeApi, RoomApiError } from '../../src/lib/edgeApi';
import { CATALOG_SYNC_TIMEOUT_MS } from '../../src/features/catalog/catalogApi';
import { TIME_BUDGET_MS } from '../../server/operations/catalogSync';

const base = { baseUrl: 'http://local.test', getAccessToken: async () => 'access-token' };

// A fetch that never answers on its own and fails only when aborted, so the
// test measures which timeout the client actually applied.
function hangingFetch(): typeof fetch {
  return ((_url: string | URL | Request, init?: RequestInit) => new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal === null || signal === undefined) return;
    if (signal.aborted) { reject(new Error('aborted')); return; }
    signal.addEventListener('abort', () => { reject(new Error('aborted')); }, { once: true });
  })) as unknown as typeof fetch;
}

describe('songbook sync request timeout', () => {
  it('outlives the function budget the sync is allowed to spend', async () => {
    // The sync works for up to TIME_BUDGET_MS and then finishes the page it is
    // on. A client that gives up first reports a refresh that succeeded as
    // "the room service could not be reached", and invites a second press.
    expect(CATALOG_SYNC_TIMEOUT_MS).toBeGreaterThan(TIME_BUDGET_MS * 2);
  });

  it('honours a per-call timeout instead of the shared ten seconds', async () => {
    const api = createEdgeApi({ ...base, fetchImpl: hangingFetch() });
    const started = Date.now();

    const failure = await api.invoke('guest-room-read', { roomId: 'x' }, {}, { timeoutMs: 25 })
      .then(() => null)
      .catch((error: unknown) => error as RoomApiError);

    expect(failure).toBeInstanceOf(RoomApiError);
    expect(failure?.code).toBe('NETWORK_ERROR');
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
