import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  calls: [] as string[],
  catalog: null as unknown,
}));

vi.mock('../../server/operations/catalogAccess.js', () => ({
  requireRoomAccess: vi.fn(async () => undefined),
}));
vi.mock('../../server/db/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/db/client.js')>();
  return {
    ...original,
    serviceDatabase: () => ({
      query: async (statement: string) => {
        const name = /public\.([a-z_]+)\(/.exec(statement)?.[1] ?? '';
        state.calls.push(name);
        if (name === 'consume_rate_limit') return [{ result: { allowed: true } }];
        if (name === 'youtube_search_cache_get') return [{ result: null }];
        if (name === 'karaoke_catalog_page') return [{ result: state.catalog }];
        return [{ result: null }];
      },
    }),
  };
});

import { youtubeSearch } from '../../server/operations/youtube';

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';
const caller = { userId: 'test-user', accessToken: 'test-access' };
function request(): Request {
  return new Request('https://example.test/api/youtube-search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomId, query: 'example karaoke' }),
  });
}

describe('quota-safe local songbook search', () => {
  beforeEach(() => {
    state.calls.length = 0;
    state.catalog = { items: [{
      videoId: 'dQw4w9WgXcQ',
      title: 'Example Karaoke',
      channelTitle: 'Music Channel',
      syncedAt: new Date(Date.now() - 3600_000).toISOString(),
    }] };
    vi.stubEnv('YOUTUBE_API_KEY', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns recent catalog results without charging the YouTube daily quota', async () => {
    const response = await youtubeSearch(request(), caller);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      available: true, source: 'songbook', results: [{ videoId: 'dQw4w9WgXcQ' }],
    });
    expect(state.calls).toContain('karaoke_catalog_page');
    expect(state.calls).not.toContain('consume_daily_rate_limit');
  });

  it('does not present a stale catalog record as a YouTube match', async () => {
    state.catalog = { items: [{
      videoId: 'dQw4w9WgXcQ', title: 'Expired',
      syncedAt: '2020-01-01T00:00:00Z',
    }] };
    const response = await youtubeSearch(request(), caller);
    expect(await response.json()).toMatchObject({ available: false, results: [] });
  });
});
