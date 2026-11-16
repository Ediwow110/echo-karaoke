import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; params: unknown[] }>,
  attemptAllowed: true,
}));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('../../server/db/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/db/client.js')>();
  return {
    ...original,
    serviceDatabase: () => ({
      query: async (sql: string, params: unknown[]) => {
        const op = /select public\.([a-z_]+)\(/.exec(sql)?.[1] ?? '';
        state.calls.push({ op, params });
        if (op === 'room_access_check' || op === 'host_access_check') {
          return [{ result: { status: 'live' } }];
        }
        if (op === 'consume_rate_limit') return [{ result: { allowed: true } }];
        if (op === 'peek_daily_rate_limit') return [{ result: { allowed: true } }];
        if (op === 'consume_daily_rate_limit') {
          if (params[1] === 'youtube-api-attempt-day') {
            return [{ result: { allowed: state.attemptAllowed } }];
          }
          return [{ result: { allowed: true } }];
        }
        if (op === 'refund_daily_rate_limit') return [{ result: { count: 0 } }];
        if (op === 'youtube_search_cache_get') return [{ result: null }];
        if (op === 'youtube_search_cache_put') return [{ result: { ok: true } }];
        if (op === 'karaoke_catalog_page') return [{ result: { items: [] } }];
        return [{ result: null }];
      },
    }),
  };
});

import { youtubePopular, youtubeSearch } from '../../server/operations/youtube';

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const caller = { userId: 'user-1', accessToken: 'access-token' };
const ATTEMPT = ['global', 'youtube-api-attempt-day', 96];

function searchRequest(): Request {
  return new Request('http://localhost/api/youtube-search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-room-guest-token': 'g'.repeat(40),
    },
    body: JSON.stringify({ roomId: ROOM_ID, query: 'hello' }),
  });
}

function popularRequest(): Request {
  return new Request('http://localhost/api/youtube-popular', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-room-guest-token': 'g'.repeat(40),
    },
    body: JSON.stringify({ roomId: ROOM_ID }),
  });
}

function callsFor(name: string): unknown[][] {
  return state.calls
    .filter((call) => call.op === name)
    .map((call) => call.params);
}

beforeEach(() => {
  state.calls.length = 0;
  state.attemptAllowed = true;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  process.env.YOUTUBE_API_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.YOUTUBE_API_KEY;
});

describe('YouTube provider-attempt accounting', () => {
  it('keeps the shared attempt when a search fails', async () => {
    fetchMock.mockRejectedValue(new Error('network'));

    await expect(youtubeSearch(searchRequest(), caller))
      .rejects.toMatchObject({ code: 'SEARCH_UNAVAILABLE' });

    expect(callsFor('consume_daily_rate_limit')).toEqual(expect.arrayContaining([
      ATTEMPT,
      ['user:user-1', 'youtube-search-day', 30],
      ['room:' + ROOM_ID, 'youtube-search-day', 60],
      ['global', 'youtube-search-day', 90],
    ]));
    expect(callsFor('refund_daily_rate_limit')).toEqual([
      ['user:user-1', 'youtube-search-day'],
      ['room:' + ROOM_ID, 'youtube-search-day'],
      ['global', 'youtube-search-day'],
    ]);
    expect(callsFor('refund_daily_rate_limit')
      .some((params) => params[1] === 'youtube-api-attempt-day')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not call YouTube when the shared attempt budget is empty', async () => {
    state.attemptAllowed = false;

    const response = await youtubeSearch(searchRequest(), caller);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ available: false, results: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(callsFor('consume_daily_rate_limit')
      .some((params) => params[1] === 'youtube-search-day')).toBe(false);
  });

  it('refunds success budgets when a 200 has no usable results', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await youtubeSearch(searchRequest(), caller);

    expect(await response.json()).toMatchObject({ available: true, results: [] });
    expect(callsFor('consume_daily_rate_limit')).toContainEqual(ATTEMPT);
    expect(callsFor('refund_daily_rate_limit')).toEqual([
      ['user:user-1', 'youtube-search-day'],
      ['room:' + ROOM_ID, 'youtube-search-day'],
      ['global', 'youtube-search-day'],
    ]);
  });

  it('keeps the shared attempt when a popular request fails', async () => {
    fetchMock.mockRejectedValue(new Error('network'));

    await expect(youtubePopular(popularRequest(), caller))
      .rejects.toMatchObject({ code: 'SEARCH_UNAVAILABLE' });

    expect(callsFor('consume_daily_rate_limit')).toContainEqual(ATTEMPT);
    expect(callsFor('refund_daily_rate_limit')).toEqual([
      ['global', 'youtube-popular-day'],
    ]);
    expect(callsFor('refund_daily_rate_limit')
      .some((params) => params[1] === 'youtube-api-attempt-day')).toBe(false);
  });

  it('refunds the popular success budget when a 200 has no usable results', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await youtubePopular(popularRequest(), caller);

    expect(await response.json()).toMatchObject({ available: true, results: [] });
    expect(callsFor('consume_daily_rate_limit')).toContainEqual(ATTEMPT);
    expect(callsFor('refund_daily_rate_limit')).toEqual([
      ['global', 'youtube-popular-day'],
    ]);
  });
});
