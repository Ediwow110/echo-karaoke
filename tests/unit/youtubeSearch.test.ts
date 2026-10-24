import { describe, expect, it } from 'vitest';
// The mappers are plain TypeScript, so the unit suite can exercise them directly.
import {
  buildPopularSearchUrl,
  mapSearchResponse,
  pickPopularCards,
  selectPopularResults,
} from '../../server/operations/youtube';

function payload(items: unknown[]): unknown {
  return { items };
}

describe('youtube search mapping', () => {
  it('maps a normal result', () => {
    const results = mapSearchResponse(payload([
      {
        id: { videoId: 'dQw4w9WgXcQ' },
        snippet: {
          title: 'Never Gonna Give You Up',
          channelTitle: 'Rick Astley',
          thumbnails: { medium: { url: 'https://img.example/medium.jpg' } },
        },
      },
    ]));

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      videoId: 'dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      channelTitle: 'Rick Astley',
      thumbnailUrl: 'https://img.example/medium.jpg',
      durationSeconds: null,
    });
  });

  it('decodes escaped characters in titles', () => {
    const results = mapSearchResponse(payload([
      { id: { videoId: 'abc123XYZ_-' }, snippet: { title: 'Rock &amp; Roll &quot;Live&quot;' } },
    ]));

    expect(results[0].title).toBe('Rock & Roll "Live"');
  });

  it('falls back through thumbnail sizes', () => {
    const results = mapSearchResponse(payload([
      { id: { videoId: 'abc123XYZ_-' }, snippet: { title: 'T', thumbnails: { default: { url: 'small.jpg' } } } },
    ]));

    expect(results[0].thumbnailUrl).toBe('small.jpg');
  });

  it('skips results without a usable id or title', () => {
    const results = mapSearchResponse(payload([
      { id: {}, snippet: { title: 'No id' } },
      { id: { videoId: 'short' }, snippet: { title: 'Bad id' } },
      { id: { videoId: 'abc123XYZ_-' }, snippet: {} },
      { id: { videoId: 'abc123XYZ_-' }, snippet: { title: 'Good' } },
    ]));

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Good');
  });

  it('caps results at ten', () => {
    const items = Array.from({ length: 25 }, (_, index) => ({
      id: { videoId: 'vid' + String(index).padStart(8, '0') },
      snippet: { title: 'Song ' + index },
    }));

    expect(mapSearchResponse(payload(items))).toHaveLength(10);
  });

  it('returns an empty list for malformed payloads', () => {
    expect(mapSearchResponse(null)).toEqual([]);
    expect(mapSearchResponse({})).toEqual([]);
    expect(mapSearchResponse({ items: 'nope' })).toEqual([]);
  });
});

describe('popular karaoke search', () => {
  it('asks YouTube for embeddable karaoke and lyric videos', () => {
    const url = new URL(buildPopularSearchUrl('test-key'));

    expect(url.pathname).toBe('/youtube/v3/search');
    expect(url.searchParams.get('q')).toBe('popular karaoke songs');
    expect(url.searchParams.get('type')).toBe('video');
    expect(url.searchParams.get('videoCategoryId')).toBe('10');
    expect(url.searchParams.get('videoEmbeddable')).toBe('true');
    expect(url.searchParams.get('order')).toBe('relevance');
    expect(url.searchParams.get('maxResults')).toBe('20');
    expect(url.searchParams.get('key')).toBe('test-key');
  });

  it('maps search ids and drops medleys and compilations into a pool', () => {
    const items = [
      { id: { videoId: 'karaoke0001' }, snippet: { title: 'Someone Like You (Karaoke Version)' } },
      { id: { videoId: 'karaoke0002' }, snippet: { title: 'Air Supply Medley (Karaoke Version)' } },
      { id: { videoId: 'karaoke0003' }, snippet: { title: 'Best Karaoke Songs 1 Hour' } },
      { id: { videoId: 'karaoke0004' }, snippet: { title: 'Ballads Nonstop' } },
      ...Array.from({ length: 9 }, (_, index) => ({
        id: { videoId: 'karaoke10' + String(index).padStart(2, '0') },
        snippet: { title: 'Karaoke Song ' + (index + 1) },
      })),
    ];

    const results = selectPopularResults({ items });

    expect(results).toHaveLength(10);
    expect(results[0].videoId).toBe('karaoke0001');
    expect(results.some((song) => /medley|1 hour|nonstop/i.test(song.title))).toBe(false);
  });

  it('returns no cards for a malformed payload', () => {
    expect(selectPopularResults(null)).toEqual([]);
    expect(selectPopularResults({ items: 'nope' })).toEqual([]);
  });
});

describe('per-screen popular picks', () => {
  const pool = Array.from({ length: 12 }, (_, index) => ({
    videoId: 'karaoke2' + String(index).padStart(3, '0'),
    title: 'Karaoke Pick ' + index,
    channelTitle: 'Channel',
    thumbnailUrl: null,
    durationSeconds: null,
  }));

  it('serves eight unique cards from a larger pool', () => {
    const results = pickPopularCards(pool, 8);

    expect(results).toHaveLength(8);
    expect(new Set(results.map((song) => song.videoId)).size).toBe(8);
    for (const song of results) {
      expect(pool).toContain(song);
    }
  });

  it('serves the whole pool when it cannot fill a screen', () => {
    const small = pool.slice(0, 4);
    expect(pickPopularCards(small, 8)).toEqual(small);
  });
});
