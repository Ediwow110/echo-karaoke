import { describe, expect, it } from 'vitest';
import { parseYouTubeVideoId } from '../../src/features/queue/youtubeVideo';

const ID = 'dQw4w9WgXcQ';

describe('youtube video parsing', () => {
  it('accepts a raw eleven character id', () => {
    expect(parseYouTubeVideoId(ID)).toBe(ID);
  });

  it('accepts watch urls with extra parameters', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=' + ID)).toBe(ID);
    expect(parseYouTubeVideoId('https://youtube.com/watch?v=' + ID + '&t=42s&list=PL123')).toBe(ID);
    expect(parseYouTubeVideoId('https://m.youtube.com/watch?v=' + ID)).toBe(ID);
    expect(parseYouTubeVideoId('http://www.youtube.com/watch?app=desktop&v=' + ID)).toBe(ID);
  });

  it('accepts short and embed and shorts links', () => {
    expect(parseYouTubeVideoId('https://youtu.be/' + ID)).toBe(ID);
    expect(parseYouTubeVideoId('https://youtu.be/' + ID + '?si=abc')).toBe(ID);
    expect(parseYouTubeVideoId('https://www.youtube.com/embed/' + ID)).toBe(ID);
    expect(parseYouTubeVideoId('https://www.youtube.com/shorts/' + ID)).toBe(ID);
    expect(parseYouTubeVideoId('https://www.youtube-nocookie.com/embed/' + ID)).toBe(ID);
  });

  it('trims surrounding whitespace and pasted noise', () => {
    expect(parseYouTubeVideoId('  https://youtu.be/' + ID + '  ')).toBe(ID);
  });

  it('rejects empty and malformed input', () => {
    expect(parseYouTubeVideoId('')).toBeNull();
    expect(parseYouTubeVideoId('   ')).toBeNull();
    expect(parseYouTubeVideoId('not a video')).toBeNull();
    expect(parseYouTubeVideoId('abcdefghij')).toBeNull();
    expect(parseYouTubeVideoId(ID + 'X')).toBeNull();
    expect(parseYouTubeVideoId('dQw4w9WgXc!')).toBeNull();
  });

  it('rejects other hosts and unsafe schemes', () => {
    expect(parseYouTubeVideoId('https://vimeo.com/' + ID)).toBeNull();
    expect(parseYouTubeVideoId('https://evil.test/watch?v=' + ID)).toBeNull();
    expect(parseYouTubeVideoId('javascript:alert(1)//' + ID)).toBeNull();
    expect(parseYouTubeVideoId('https://youtube.com.evil.test/watch?v=' + ID)).toBeNull();
  });

  it('rejects watch urls without an id or with extra path segments', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch')).toBeNull();
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseYouTubeVideoId('https://youtu.be/' + ID + '/extra')).toBeNull();
    expect(parseYouTubeVideoId('https://www.youtube.com/watch/extra?v=' + ID)).toBeNull();
  });
});
