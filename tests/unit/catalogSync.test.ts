import { describe, expect, it } from 'vitest';
import { mapPlaylistItems, readNextToken } from '../../server/operations/catalogSync';

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

  it('returns the next page token only when it is a string', () => {
    expect(readNextToken(page)).toBe('TOKEN2');
    expect(readNextToken({ items: [] })).toBeNull();
    expect(readNextToken(null)).toBeNull();
    expect(readNextToken({ nextPageToken: 42 })).toBeNull();
  });
});
