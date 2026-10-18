import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import YouTubePlayer, { type PlayerFactory, type PlayerHandle } from '../../src/features/playback/YouTubePlayer';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

function fakeFactory() {
  const calls: string[] = [];
  let ended: (() => void) | null = null;

  const factory: PlayerFactory = (element, onEnded) => {
    ended = onEnded;
    element.setAttribute('data-player-host', 'ready');
    const handle: PlayerHandle = {
      load: (videoId) => calls.push('load:' + videoId),
      play: () => calls.push('play'),
      pause: () => calls.push('pause'),
      getCurrentTime: () => 7,
    };
    return handle;
  };

  return { factory, calls, fireEnded: () => ended?.() };
}

const playback = {
  currentSongId: 's1',
  currentVideoId: 'dQw4w9WgXcQ',
  positionSeconds: 0,
  isPlaying: true,
  updatedAt: null,
};

describe('host player', () => {
  it('loads the current video and starts it', async () => {
    const { factory, calls } = fakeFactory();

    render(createElement(YouTubePlayer, { playback, onEnded: () => {}, playerFactory: factory }));

    await waitFor(() => {
      expect(calls).toContain('load:dQw4w9WgXcQ');
      expect(calls).toContain('play');
    });
  });

  it('pauses when the room is paused', async () => {
    const { factory, calls } = fakeFactory();

    render(createElement(YouTubePlayer, {
      playback: { ...playback, isPlaying: false },
      onEnded: () => {},
      playerFactory: factory,
    }));

    await waitFor(() => {
      expect(calls).toContain('pause');
    });
  });

  it('asks for a tap when there is no song', () => {
    const { factory } = fakeFactory();

    render(createElement(YouTubePlayer, {
      playback: { ...playback, currentSongId: null, currentVideoId: null, isPlaying: false },
      onEnded: () => {},
      playerFactory: factory,
    }));

    expect(screen.getByText(/add a song to start the night/i)).toBeInTheDocument();
  });

  it('reports the end of a song once', async () => {
    const onEnded = vi.fn();
    const { factory, fireEnded } = fakeFactory();

    render(createElement(YouTubePlayer, { playback, onEnded, playerFactory: factory }));

    await waitFor(() => expect(screen.getByLabelText(/karaoke player/i)).toBeInTheDocument());
    fireEnded();

    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('reports progress to the caller', async () => {
    const onProgress = vi.fn();
    const { factory } = fakeFactory();

    render(createElement(YouTubePlayer, {
      playback,
      onEnded: () => {},
      onProgress,
      playerFactory: factory,
    }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onProgress).not.toHaveBeenCalled();
  });
});
