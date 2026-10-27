import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  calls: [] as string[],
  catalog: null as unknown,
  catalogError: null as { code?: string; message: string } | null,
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
        if (name === 'karaoke_catalog_page') {
          if (state.catalogError !== null) throw state.catalogError;
          return [{ result: state.catalog }];
        }
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
    state.catalogError = null;
    state.catalog = { items: [{
      videoId: 'dQw4w9WgXcQ',
      title: 'Example Karaoke',
      channelTitle: 'Music Channel',
      syncedAt: new Date(Date.now() - 3600_000).toISOString(),
    }] };
    vi.stubEnv('YOUTUBE_API_KEY', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('does not report a denied catalog grant as an empty songbook', async () => {
    // SQLSTATE 42501 is exactly how the missing echo_service grants presented
    // themselves. Swallowing it turns a broken deployment into "no matches".
    state.catalogError = { code: '42501', message: 'permission denied for function karaoke_catalog_page' };
    // The operation surfaces a 500-status failure, which the router answers as
    // INTERNAL_ERROR — instead of a 200 that claims the songbook is empty.
    await expect(youtubeSearch(request(), caller)).rejects.toMatchObject({ status: 500 });
  });

  it('names the room limit, not a YouTube outage, when the songbook answers instead', async () => {
    // The fallback is right; the reason was not. A room that had spent its
    // daily searches was told YouTube was unavailable -- a cause nothing
    // established, and one the room would believe until tomorrow.
    vi.stubEnv('YOUTUBE_API_KEY', 'test-key');

    const response = await youtubeSearch(request(), caller);
    const body = await response.json() as { available: boolean; source?: string; message?: string };

    expect(body.source).toBe('songbook');
    expect(body.message).toContain('search limit for today');
    expect(body.message ?? '').not.toContain('YouTube search is unavailable');
  });

  it('still answers unavailable when the catalog function has not been migrated yet', async () => {
    // SQLSTATE 42883 is the one state that is genuinely a staged rollout.
    state.catalogError = { code: '42883', message: 'function public.karaoke_catalog_page(...) does not exist' };
    const response = await youtubeSearch(request(), caller);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ available: false, results: [] });
  });

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
