import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import YouTubePlayer, { type PlayerFactory, type PlayerHandle } from '../../src/features/playback/YouTubePlayer';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

function fakeFactory(state = 1) {
  const calls: string[] = [];
  let ended: (() => void) | null = null;
  let created = 0;
  let currentState = state;

  const factory: PlayerFactory = (element, onEnded) => {
    created += 1;
    calls.push('create');
    ended = onEnded;
    element.setAttribute('data-player-host', 'ready');
    const handle: PlayerHandle = {
      load: (videoId) => calls.push('load:' + videoId),
      play: () => calls.push('play'),
      pause: () => calls.push('pause'),
      getCurrentTime: () => 7,
      getState: () => currentState,
      destroy: () => calls.push('destroy'),
    };
    return handle;
  };

  return {
    factory,
    calls,
    created: () => created,
    setState: (value: number) => { currentState = value; },
    fireEnded: () => ended?.(),
  };
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

  it('keeps one player when the room repolls with a new callback', async () => {
    const { factory, calls, created } = fakeFactory();

    const { rerender } = render(
      createElement(YouTubePlayer, { playback, onEnded: () => {}, playerFactory: factory }),
    );

    await waitFor(() => {
      expect(calls).toContain('load:dQw4w9WgXcQ');
    });

    rerender(createElement(YouTubePlayer, { playback, onEnded: () => {}, playerFactory: factory }));
    rerender(createElement(YouTubePlayer, { playback, onEnded: () => {}, playerFactory: factory }));

    expect(created()).toBe(1);
    expect(calls.filter((call) => call === 'destroy').length).toBe(0);
  });

  it('calls the latest callback when a song ends', async () => {
    const { factory, fireEnded } = fakeFactory();
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = render(
      createElement(YouTubePlayer, { playback, onEnded: first, playerFactory: factory }),
    );

    rerender(createElement(YouTubePlayer, { playback, onEnded: second, playerFactory: factory }));

    fireEnded();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it('asks the host to tap when the picture will not start', async () => {
    const { factory, setState } = fakeFactory(5);

    render(createElement(YouTubePlayer, { playback, onEnded: () => {}, playerFactory: factory }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /tap to start audio/i })).toBeInTheDocument();
    }, { timeout: 4000 });

    setState(1);
  });

  it('pauses when the room is paused', async () => {    const { factory, calls } = fakeFactory();

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
describe('player viewing modes', () => {
  it('offers normal, theater and fullscreen controls', () => {
    const { factory } = fakeFactory();

    render(createElement(YouTubePlayer, { playback, onEnded: () => {}, playerFactory: factory }));

    expect(screen.getByRole('button', { name: 'Normal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Theater' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument();
  });

  it('asks the page to switch into theater mode', () => {
    const onModeChange = vi.fn();
    const { factory } = fakeFactory();

    render(createElement(YouTubePlayer, {
      playback, onEnded: () => {}, playerFactory: factory, mode: 'normal', onModeChange,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Theater' }));

    expect(onModeChange).toHaveBeenCalledWith('theater');
  });

  it('asks the page to return to normal mode', () => {
    const onModeChange = vi.fn();
    const { factory } = fakeFactory();

    render(createElement(YouTubePlayer, {
      playback, onEnded: () => {}, playerFactory: factory, mode: 'theater', onModeChange,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Normal' }));

    expect(onModeChange).toHaveBeenCalledWith('normal');
  });

  it('marks the active mode as pressed', () => {
    const { factory } = fakeFactory();

    render(createElement(YouTubePlayer, {
      playback, onEnded: () => {}, playerFactory: factory, mode: 'theater', onModeChange: () => {},
    }));

    expect(screen.getByRole('button', { name: 'Theater' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('takes the stage fullscreen and reports exiting', async () => {
    const { factory } = fakeFactory();

    render(createElement(YouTubePlayer, { playback, onEnded: () => {}, playerFactory: factory }));

    const panel = screen.getByLabelText(/karaoke player/i) as HTMLElement;
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    panel.requestFullscreen = requestFullscreen as unknown as typeof panel.requestFullscreen;

    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));

    await waitFor(() => expect(requestFullscreen).toHaveBeenCalledTimes(1));

    fireEvent(document, new Event('fullscreenchange'));
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: panel });
    fireEvent(document, new Event('fullscreenchange'));

    expect(await screen.findByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument();

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });
});