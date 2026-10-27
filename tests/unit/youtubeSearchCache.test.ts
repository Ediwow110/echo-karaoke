import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('../../server/db/client.js', () => ({
  operationCall: (name: string, params: unknown[]) => ({ text: name, params }),
  serviceDatabase: () => ({ query: queryMock }),
}));

vi.mock('../../server/operations/catalogAccess.js', () => ({ requireRoomAccess: vi.fn() }));

import { youtubeSearch } from '../../server/operations/youtube';

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const caller = { userId: 'user-1', accessToken: 'access-token' };

function searchRequest(): Request {
  return new Request('http://localhost/api/youtube-search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomId: ROOM_ID, query: 'afterglow karaoke' }),
  });
}

function cacheWrites(): unknown[][] {
  return (queryMock.mock.calls as [string, unknown[]][])
    .filter(([name]) => name === 'youtube_search_cache_put')
    .map(([, params]) => params);
}

beforeEach(() => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  queryMock.mockReset();
  queryMock.mockImplementation(async (name: string) => {
    if (name === 'youtube_search_cache_get') return [{ result: null }];
    if (name === 'consume_rate_limit') return [{ result: { allowed: true } }];
    if (name === 'peek_daily_rate_limit') return [{ result: { allowed: true } }];
    if (name === 'consume_daily_rate_limit') return [{ result: { allowed: true } }];
    return [{ result: null }];
  });
});

afterEach(() => {
  delete process.env.YOUTUBE_API_KEY;
  vi.unstubAllGlobals();
});

describe('the shared search cache', () => {
  it('does not cache an unrecognized upstream payload as an empty result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    const response = await youtubeSearch(searchRequest(), caller);
    const body = await response.json() as { results: unknown[] };

    expect(response.status).toBe(200);
    expect(body.results).toEqual([]);
    expect(cacheWrites()).toEqual([]);
  });

  it('caches real results for the next room', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [{ id: { videoId: 'dQw4w9WgXcQ' }, snippet: { title: 'Afterglow' } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    const response = await youtubeSearch(searchRequest(), caller);
    const body = await response.json() as { results: unknown[] };

    expect(body.results).toHaveLength(1);
    expect(cacheWrites()).toHaveLength(1);
    expect(cacheWrites()[0]).toEqual(['afterglow karaoke', expect.any(String), 600]);
  });
});
