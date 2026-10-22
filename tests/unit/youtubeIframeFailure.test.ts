import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

beforeEach(() => {
  vi.resetModules();
  delete (window as unknown as { YT?: unknown }).YT;
  delete (window as unknown as { onYouTubeIframeAPIReady?: unknown }).onYouTubeIframeAPIReady;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the YouTube player factory failure path', () => {
  it('reports a blocked API and retries when a song asks for the player again', async () => {
    const append = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLScriptElement) {
        queueMicrotask(() => node.onerror?.(new Event('error')));
      }
      return node;
    });
    const onError = vi.fn();
    const module = await import('../../src/features/playback/youtubeIframe');

    const handle = module.youtubePlayerFactory(document.createElement('div'), {
      onEnded: () => undefined,
      onError,
    });

    handle.load('dQw4w9WgXcQ');
    await waitFor(() => expect(onError).toHaveBeenCalledWith(-1));
    const firstAttempts = append.mock.calls.length;

    handle.load('M7lc1UVf-VE');
    await waitFor(() => expect(append.mock.calls.length).toBeGreaterThan(firstAttempts));
    await waitFor(() => expect(onError.mock.calls.length).toBeGreaterThanOrEqual(2));

    handle.destroy();
  });
});
