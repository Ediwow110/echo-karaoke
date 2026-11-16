import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; params: unknown[] }>,
  attemptAllowed: true,
  attemptFails: false,
  deniedSuccess: null as { subject: string; bucket: string } | null,
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
            if (state.attemptFails) throw new Error('The attempt ledger is unavailable');
            return [{ result: { allowed: state.attemptAllowed } }];
          }
          return [{ result: { allowed: !(state.deniedSuccess !== null && state.deniedSuccess.subject === params[0]
            && state.deniedSuccess.bucket === params[1]) } }];
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
  state.attemptFails = false;
  state.deniedSuccess = null;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('YOUTUBE_API_KEY', 'test-key');
  vi.stubEnv('YOUTUBE_DAILY_API_ATTEMPT_BUDGET', '96');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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

  it('discards the denied attempt debit and falls back when the shared budget is empty', async () => {
    state.attemptAllowed = false;

    const response = await youtubeSearch(searchRequest(), caller);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ available: false, results: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(callsFor('refund_daily_rate_limit')).toEqual([
      ['global', 'youtube-api-attempt-day'],
      ['user:user-1', 'youtube-search-day'],
      ['room:' + ROOM_ID, 'youtube-search-day'],
      ['global', 'youtube-search-day'],
    ]);
  });

  it.each([
    ['user:user-1', 429],
    ['room:' + ROOM_ID, 200],
    ['global', 200],
  ] as const)('does not spend a provider attempt when %s loses its success reservation', async (subject, status) => {
    state.deniedSuccess = { subject, bucket: 'youtube-search-day' };

    if (status === 429) {
      await expect(youtubeSearch(searchRequest(), caller)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    } else {
      const response = await youtubeSearch(searchRequest(), caller);
      expect(await response.json()).toMatchObject({ available: false, results: [] });
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(callsFor('consume_daily_rate_limit')
      .filter((params) => params[1] === 'youtube-api-attempt-day')).toEqual([]);
    expect(callsFor('refund_daily_rate_limit')).toContainEqual([subject, 'youtube-search-day']);
  });

  it('does not spend provider attempts on denied popular requests', async () => {
    state.deniedSuccess = { subject: 'global', bucket: 'youtube-popular-day' };

    for (let request = 0; request < 3; request += 1) {
      await expect(youtubePopular(popularRequest(), caller)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(callsFor('consume_daily_rate_limit')
      .filter((params) => params[1] === 'youtube-api-attempt-day')).toEqual([]);
    expect(callsFor('refund_daily_rate_limit')).toEqual([
      ['global', 'youtube-popular-day'],
      ['global', 'youtube-popular-day'],
      ['global', 'youtube-popular-day'],
    ]);
  });

  it('refunds the popular allowance and discards the denied attempt debit', async () => {
    state.attemptAllowed = false;

    await expect(youtubePopular(popularRequest(), caller)).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(callsFor('refund_daily_rate_limit')).toEqual([
      ['global', 'youtube-api-attempt-day'],
      ['global', 'youtube-popular-day'],
    ]);
  });

  it.each(['search', 'popular'] as const)('refunds %s allowances if the provider ledger fails', async (operation) => {
    state.attemptFails = true;

    const request = operation === 'search'
      ? youtubeSearch(searchRequest(), caller)
      : youtubePopular(popularRequest(), caller);
    await expect(request).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(callsFor('refund_daily_rate_limit')).toEqual(operation === 'search' ? [
      ['user:user-1', 'youtube-search-day'],
      ['room:' + ROOM_ID, 'youtube-search-day'],
      ['global', 'youtube-search-day'],
    ] : [['global', 'youtube-popular-day']]);
  });

  it.each([1, 96, 100])('uses the valid provider-attempt ceiling %i', async (limit) => {
    vi.stubEnv('YOUTUBE_DAILY_API_ATTEMPT_BUDGET', String(limit));
    fetchMock.mockResolvedValue(Response.json({ items: [] }));

    await youtubeSearch(searchRequest(), caller);

    expect(callsFor('consume_daily_rate_limit')).toContainEqual(['global', 'youtube-api-attempt-day', limit]);
  });

  it.each(['0', '-1', '1.5', '101', '1000', 'not-a-number'])('uses the safe default for provider-attempt ceiling %s', async (raw) => {
    vi.stubEnv('YOUTUBE_DAILY_API_ATTEMPT_BUDGET', raw);
    fetchMock.mockResolvedValue(Response.json({ items: [] }));

    await youtubeSearch(searchRequest(), caller);

    expect(callsFor('consume_daily_rate_limit')).toContainEqual(ATTEMPT);
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
