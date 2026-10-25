import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  query: vi.fn<(text: string, params: unknown[]) => Promise<unknown[]>>(),
  timeline: [] as string[],
}));

vi.mock('../../server/db/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db/client.js')>();
  return {
    ...actual,
    serviceDatabase: () => ({ query: db.query }),
  };
});

import { HttpError } from '../../server/operations/errors';
import { requireHostAccess, requireRoomAccess } from '../../server/operations/catalogAccess';
import {
  CATALOG_CHANNELS,
  catalogSync,
  mapPlaylistItems,
  readNextToken,
} from '../../server/operations/catalogSync';

const page = {
  nextPageToken: 'TOKEN2',
  items: [
    {
      snippet: {
        title: 'Halo &amp; Friends - Karaoke',
        channelTitle: 'Musisi Karaoke',
        publishedAt: '2025-01-02T00:00:00Z',
        thumbnails: { medium: { url: 'https://i.ytimg.com/medium.jpg' } },
      },
      contentDetails: { videoId: 'aaaaaaaaaaa' },
    },
    // Private or deleted videos come back without contentDetails.
    { snippet: { title: 'Ghost entry', channelTitle: 'X' } },
    // A malformed id must be dropped rather than written.
    { snippet: { title: 'Bad id' }, contentDetails: { videoId: 'short' } },
    { snippet: { title: '   ' }, contentDetails: { videoId: 'bbbbbbbbbbb' } },
    // Odd payloads must be skipped, never thrown on.
    null,
  ],
};

describe('catalog sync helpers', () => {
  it('maps a playlist page and drops unusable entries', () => {
    expect(mapPlaylistItems(page)).toEqual([
      {
        videoId: 'aaaaaaaaaaa',
        title: 'Halo & Friends - Karaoke',
        channelTitle: 'Musisi Karaoke',
        thumbnailUrl: 'https://i.ytimg.com/medium.jpg',
        publishedAt: '2025-01-02T00:00:00Z',
      },
    ]);
  });

  it('skips non-object playlist items instead of throwing', () => {
    const payload = {
      items: [
        42,
        'text',
        [1, 2],
        { snippet: { title: 'Ok' }, contentDetails: { videoId: 'ccccccccccc' } },
      ],
    };

    expect(() => mapPlaylistItems(payload)).not.toThrow();
    expect(mapPlaylistItems(payload)).toHaveLength(1);
  });

  it('uses the high thumbnail when medium holds a non-string url', () => {
    const rows = mapPlaylistItems({
      items: [
        {
          snippet: {
            title: 'Thumb',
            thumbnails: { medium: { url: 42 }, high: { url: 'https://i.ytimg.com/high.jpg' } },
          },
          contentDetails: { videoId: 'ddddddddddd' },
        },
      ],
    });

    expect(rows[0]?.thumbnailUrl).toBe('https://i.ytimg.com/high.jpg');
  });

  it('returns the next page token only when it is a string', () => {
    expect(readNextToken(page)).toBe('TOKEN2');
    expect(readNextToken({ items: [] })).toBeNull();
    expect(readNextToken(null)).toBeNull();
    expect(readNextToken({ nextPageToken: 42 })).toBeNull();
  });
});

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const CALLER = {
  userId: '22222222-2222-4222-8222-222222222222',
  accessToken: 'access-token',
};
const HOST_TOKEN = 'h'.repeat(32);
const GUEST_TOKEN = 'g'.repeat(32);

type Handler = (params: unknown[]) => unknown;

function operationName(text: string): string {
  const match = /select public\.([a-z_][a-z0-9_]*)\(/.exec(text);
  return match?.[1] ?? text;
}

function useDatabase(handlers: Record<string, Handler>): void {
  db.query.mockImplementation(async (text, params) => {
    const name = operationName(text);
    db.timeline.push(name);
    const handler = handlers[name];
    if (handler === undefined) return [{ result: null }];
    const value = handler(params);
    if (value instanceof Error) throw value;
    return [{ result: value }];
  });
}

async function expectHttpError(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect(error).toMatchObject({ status, code });
}

function syncRequest(headers: Record<string, string> = { 'x-room-host-token': HOST_TOKEN }): Request {
  return new Request('http://localhost/api/catalog-sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ roomId: ROOM_ID }),
  });
}

function row(index: number): unknown {
  return {
    snippet: {
      title: `Song ${index}`,
      channelTitle: 'Channel',
      thumbnails: { medium: { url: `https://img.example/${index}.jpg` } },
    },
    contentDetails: { videoId: `vid${String(index).padStart(8, '0')}` },
  };
}

function upstream(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

type FetchOptions = {
  rows?: unknown[];
  nextPageToken?: boolean;
};

function stubFetch(options: FetchOptions = {}): { urls: URL[] } {
  const urls: URL[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof URL
      ? input
      : new URL(typeof input === 'string' ? input : input.url);
    urls.push(url);
    db.timeline.push('fetch');
    if (url.pathname.endsWith('/channels')) {
      const handle = url.searchParams.get('forHandle') ?? '@channel';
      return upstream({
        items: [{ contentDetails: { relatedPlaylists: { uploads: `UU${handle.slice(1)}` } } }],
      });
    }
    const body: Record<string, unknown> = { items: options.rows ?? [] };
    if (options.nextPageToken === true) {
      body.nextPageToken = `page-${urls.length}`;
    }
    return upstream(body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { urls };
}

function baseHandlers(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    host_access_check: () => ({ status: 'live' }),
    karaoke_catalog_cursors: () => [],
    consume_daily_rate_limit: () => ({ allowed: true }),
    karaoke_catalog_cursor_save: () => ({}),
    karaoke_catalog_upsert: () => ({}),
    ...overrides,
  };
}

function cursors(activeHandle: string, now: string): unknown[] {
  return CATALOG_CHANNELS.map((handle) => ({
    channelId: handle,
    uploadsPlaylistId: `UU${handle.slice(1)}`,
    nextPageToken: null,
    exhaustedAt: null,
    lastSyncedAt: handle === activeHandle ? null : now,
  }));
}

beforeEach(() => {
  db.timeline.length = 0;
  db.query.mockReset();
  vi.stubEnv('YOUTUBE_API_KEY', 'test-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('catalog access guards', () => {
  it('turns a database UNAUTHORIZED into a 401 for both guards', async () => {
    useDatabase({
      room_access_check: () => new Error('UNAUTHORIZED'),
      host_access_check: () => new Error('UNAUTHORIZED'),
    });

    await expectHttpError(
      requireRoomAccess(syncRequest({ 'x-room-guest-token': GUEST_TOKEN }), CALLER, ROOM_ID),
      401,
      'UNAUTHORIZED',
    );
    await expectHttpError(requireHostAccess(CALLER, ROOM_ID, HOST_TOKEN), 401, 'UNAUTHORIZED');
  });

  it('turns an ended room into a 409 for both guards', async () => {
    useDatabase({
      room_access_check: () => ({ status: 'ended' }),
      host_access_check: () => ({ status: 'ended' }),
    });

    await expectHttpError(
      requireRoomAccess(syncRequest({ 'x-room-guest-token': GUEST_TOKEN }), CALLER, ROOM_ID),
      409,
      'ROOM_ENDED',
    );
    await expectHttpError(requireHostAccess(CALLER, ROOM_ID, HOST_TOKEN), 409, 'ROOM_ENDED');
  });

  it('lets a live room through both guards', async () => {
    useDatabase({
      room_access_check: () => ({ status: 'live' }),
      host_access_check: () => ({ status: 'live' }),
    });

    await expect(
      requireRoomAccess(syncRequest({ 'x-room-guest-token': GUEST_TOKEN }), CALLER, ROOM_ID),
    ).resolves.toBe(GUEST_TOKEN);
    await expect(requireHostAccess(CALLER, ROOM_ID, HOST_TOKEN)).resolves.toBeUndefined();
  });
});

describe('catalog sync orchestration', () => {
  it('rejects a request without the host token before any quota spend', async () => {
    useDatabase(baseHandlers());
    const fetchCalls = stubFetch();

    await expectHttpError(catalogSync(syncRequest({}), CALLER), 403, 'FORBIDDEN');

    expect(db.timeline).not.toContain('consume_daily_rate_limit');
    expect(fetchCalls.urls).toHaveLength(0);
  });

  it('fails closed when the host access check rejects', async () => {
    useDatabase(baseHandlers({ host_access_check: () => new Error('UNAUTHORIZED') }));
    const fetchCalls = stubFetch();

    await expectHttpError(catalogSync(syncRequest(), CALLER), 401, 'UNAUTHORIZED');

    expect(db.timeline).toEqual(['host_access_check']);
    expect(fetchCalls.urls).toHaveLength(0);
  });

  it('spends a quota unit before every upstream fetch', async () => {
    useDatabase(baseHandlers());
    const fetchCalls = stubFetch({ rows: [row(1)], nextPageToken: true });

    const response = await catalogSync(syncRequest(), CALLER);

    expect(response.status).toBe(200);
    expect(fetchCalls.urls.length).toBeGreaterThan(0);
    let consumed = 0;
    for (const event of db.timeline) {
      if (event === 'consume_daily_rate_limit') consumed += 1;
      if (event === 'fetch') expect(consumed).toBeGreaterThan(0);
    }
    // One spent unit per upstream call: no fetch may ride on an earlier unit.
    expect(consumed).toBe(fetchCalls.urls.length);
    expect(db.timeline.indexOf('fetch')).toBeGreaterThan(db.timeline.indexOf('consume_daily_rate_limit'));
  });

  it('requests at most three playlist pages per channel', async () => {
    useDatabase(baseHandlers());
    const fetchCalls = stubFetch({ rows: [row(1)], nextPageToken: true });

    await catalogSync(syncRequest(), CALLER);

    const perPlaylist = new Map<string, number>();
    for (const url of fetchCalls.urls) {
      if (!url.pathname.endsWith('/playlistItems')) continue;
      const playlistId = url.searchParams.get('playlistId') ?? '';
      perPlaylist.set(playlistId, (perPlaylist.get(playlistId) ?? 0) + 1);
    }
    expect(perPlaylist.size).toBe(CATALOG_CHANNELS.length);
    for (const count of perPlaylist.values()) expect(count).toBe(3);
  });

  it('stops at once when the daily quota is exhausted', async () => {
    useDatabase(baseHandlers({
      karaoke_catalog_cursors: () => cursors('@musisikaraoke', new Date().toISOString()),
      consume_daily_rate_limit: () => ({ allowed: false }),
    }));
    const fetchCalls = stubFetch({ rows: [row(1)] });

    const response = await catalogSync(syncRequest(), CALLER);
    const body = await response.json() as Record<string, unknown>;

    expect(fetchCalls.urls).toHaveLength(0);
    expect(body).toEqual({
      available: true,
      added: 0,
      skipped: 0,
      message: 'Songbook refresh paused for today',
    });
  });

  it('reports how many rows the run added', async () => {
    useDatabase(baseHandlers({
      karaoke_catalog_cursors: () => cursors('@singking', new Date().toISOString()),
    }));
    stubFetch({ rows: [row(1), row(2)] });

    const response = await catalogSync(syncRequest(), CALLER);
    const body = await response.json() as { available: boolean; added: number; skipped: number };

    expect(body).toMatchObject({ available: true, added: 2, skipped: 4 });
  });
});
