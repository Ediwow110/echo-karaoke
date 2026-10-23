import { describe, expect, it } from 'vitest';
// The mapper is plain TypeScript, so the unit suite can exercise it directly.
import { mapSearchResponse } from '../../server/operations/youtube';

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
