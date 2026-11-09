import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import SongArtwork from '../../src/ui/SongArtwork';
import '@testing-library/jest-dom/vitest';

afterEach(cleanup);

function imageSource(src: string | null | undefined): string | null {
  const { container } = render(<SongArtwork src={src} alt="cover" />);
  return container.querySelector('img')?.getAttribute('src') ?? null;
}

describe('song artwork', () => {
  it('renders the YouTube thumbnail hosts the API returns', () => {
    for (const src of [
      'https://i.ytimg.com/vi/abc/hqdefault.jpg',
      'https://img.youtube.com/vi/abc/hqdefault.jpg',
      'https://yt3.ytimg.com/vi/abc/hqdefault.jpg',
    ]) {
      expect(imageSource(src), src).toBe(src);
    }
  });

  it('keeps same-origin relative artwork', () => {
    expect(imageSource('/images/cover.jpg')).toBe('/images/cover.jpg');
  });

  it('falls back to the placeholder for any other origin or scheme', () => {
    // The CSP already blocks these loads; refusing them here keeps a poisoned
    // API value from turning into a browser request at all.
    for (const src of [
      'https://tracker.example/pixel.gif',
      'http://i.ytimg.com/vi/abc/hqdefault.jpg',
      '//tracker.example/pixel.gif',
      '/\\tracker.example/pixel.gif',
      'javascript:alert(1)',
      'data:image/svg+xml,<svg/>',
      'i.ytimg.com/vi/abc/hqdefault.jpg',
    ]) {
      expect(imageSource(src), src).toBeNull();
    }
  });

  it('keeps the placeholder when no source is present', () => {
    for (const src of [null, undefined, '']) {
      expect(imageSource(src), String(src)).toBeNull();
    }
  });
});
