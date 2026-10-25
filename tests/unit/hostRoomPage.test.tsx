import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import HostRoomPage from '../../src/app/HostRoomPage';
import HostDiscoverPage from '../../src/app/HostDiscoverPage';
import HostQueuePage from '../../src/app/HostQueuePage';
import HostSettingsPage from '../../src/app/HostSettingsPage';
import HostStagePage from '../../src/app/HostStagePage';
import HostPartyPage from '../../src/app/HostPartyPage';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

const playerClock = vi.hoisted(() => ({ currentTime: 0, duration: 0 }));

vi.mock('../../src/features/playback/youtubeIframe', () => ({
  youtubePlayerFactory: () => ({
    load: () => undefined,
    play: () => undefined,
    pause: () => undefined,
    seekTo: () => undefined,
    getCurrentTime: () => playerClock.currentTime,
    getDuration: () => playerClock.duration,
    setVolume: () => undefined,
    getVolume: () => 100,
    getState: () => -1,
    destroy: () => undefined,
  }),
}));

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';

beforeEach(() => {
  playerClock.currentTime = 0;
  playerClock.duration = 0;
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    media: '',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })));
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const liveRoom = {
  roomId,
  status: 'live',
  room: {
    id: roomId,
    code: 'ABCDEFGHJKMNPQRS',
    name: 'After Hours',
    status: 'live',
    guestControlLocked: false,
    guestPlaybackLocked: true,
    createdAt: '2026-10-18T00:00:00Z',
  },
  roster: [
    { memberId: 'm1', displayName: 'Ana', role: 'host', online: true },
    { memberId: 'm2', displayName: 'Jamie', role: 'guest', online: true },
  ],
  queue: [
    {
      songId: 's1',
      videoId: 'dQw4w9WgXcQ',
      title: 'Afterglow',
      channelTitle: 'Luna Vale',
      thumbnailUrl: null,
      durationSeconds: 222,
      status: 'playing',
      position: 1,
      memberId: 'm1',
      addedBy: 'Ana',
      voteCount: 0,
    },
    {
      songId: 's2',
      videoId: 'abc123XYZ_-',
      title: 'Midnight City',
      channelTitle: 'M83',
      thumbnailUrl: null,
      durationSeconds: 243,
      status: 'queued',
      position: 2,
      memberId: 'm2',
      addedBy: 'Jamie',
      voteCount: 0,
    },
  ],
  playback: {
    currentSongId: 's1',
    currentVideoId: 'dQw4w9WgXcQ',
    positionSeconds: 0,
    isPlaying: false,
    updatedAt: '2026-10-18T00:00:00Z',
  },
  events: [],
};

function makeApi(room = liveRoom): { api: EdgeApi; calls: Array<{ name: string; body: unknown; options?: { keepalive?: boolean } }> } {
  const calls: Array<{ name: string; body: unknown; options?: { keepalive?: boolean } }> = [];
  const api: EdgeApi = {
    invoke: (async (name: string, body: unknown, _tokens: unknown, options?: { keepalive?: boolean }) => {
      calls.push({ name, body, options });
      if (name === 'host-room-read' || name === 'guest-room-read' || name === 'touch-member') {
        return room;
      }
      if (name === 'youtube-popular' || name === 'youtube-search') {
        return { available: false, results: [], message: 'Search is not configured.' };
      }
      if (name === 'playback-command') {
        return { roomId, status: 'live', playback: room.playback };
      }
      if (name === 'host-command') {
        return { roomId, status: 'live', guestControlLocked: false, guestPlaybackLocked: false };
      }
      return { ok: true };
    }) as unknown as EdgeApi['invoke'],
  };
  return { api, calls };
}

function renderHost(api: EdgeApi, path = '/room/' + roomId + '/host') {
  localStorage.setItem('karaoke.host.' + roomId, 'host-pass-value');
  localStorage.setItem('karaoke.guest.' + roomId, 'guest-pass-value');
  return render(
    createElement(RoomApiProvider, {
      api,
      children: createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/', element: createElement('p', null, 'Back at the start') }),
          createElement(
            Route,
            { path: '/room/:roomId/host', element: createElement(HostRoomPage) },
            createElement(Route, { index: true, element: createElement(HostDiscoverPage) }),
            createElement(Route, { path: 'queue', element: createElement(HostQueuePage) }),
            createElement(Route, { path: 'settings', element: createElement(HostSettingsPage) }),
            createElement(Route, { path: 'stage', element: createElement(HostStagePage) }),
            createElement(Route, { path: 'party', element: createElement(HostPartyPage) }),
          ),
        ),
      ),
    }),
  );
}

describe('host room workspace', () => {
  it('shows the room identity, real join code and invite tools', async () => {
    const { api } = makeApi();
    renderHost(api);

    expect(await screen.findByRole('heading', { level: 1, name: 'After Hours' })).toBeInTheDocument();
    expect(screen.getAllByText(/ABCD EFGH JKMN PQRS/).length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: /copy link/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /party view/i })).toBeInTheDocument();
  });

  it('opens the room at the top instead of inheriting the page scroll', async () => {
    const { api } = makeApi();
    renderHost(api);

    expect(await screen.findByRole('heading', { level: 1, name: 'After Hours' })).toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
  });

  it('shows the running order and its songs', async () => {
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/queue');
    expect(await screen.findByRole('heading', { name: /keep the night moving/i })).toBeInTheDocument();
    expect(screen.getByText('Midnight City')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skip current song/i })).toBeInTheDocument();
  });

  it('exposes the two independent guest permissions', async () => {
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/settings');

    expect(await screen.findByRole('switch', { name: /guests can add songs/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /guests can pause or resume/i })).not.toBeChecked();
    expect(screen.getByRole('button', { name: /leave & end room/i })).toBeInTheDocument();
  });

  it('removes a guest and their queue from settings', async () => {
    const { api, calls } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/settings');

    fireEvent.click(await screen.findByRole('button', { name: /remove jamie from the room/i }));
    await waitFor(() => {
      expect(calls).toContainEqual(expect.objectContaining({
        name: 'host-remove-member',
        body: expect.objectContaining({ memberId: 'm2' }),
      }));
    });
  });

  it('can end the room after confirmation', async () => {
    const { api, calls } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/settings');

    fireEvent.click(await screen.findByRole('button', { name: /leave & end room/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^end the room$/i }));

    expect(await screen.findByText('Back at the start')).toBeInTheDocument();
    expect(calls.some((call) => call.name === 'host-command' && (call.body as { action?: string }).action === 'end')).toBe(true);
  });

  it('lets the host leave the screen while keeping the room open', async () => {
    const { api } = makeApi();
    renderHost(api);

    fireEvent.click(await screen.findByRole('button', { name: /back to home/i }));

    expect(await screen.findByText('Back at the start')).toBeInTheDocument();
    expect(localStorage.getItem('karaoke.host.' + roomId)).toBe('host-pass-value');
  });

  it('pauses playback when the host leaves the screen', async () => {
    const playingRoom = {
      ...liveRoom,
      playback: { ...liveRoom.playback, isPlaying: true },
    };
    const { api, calls } = makeApi(playingRoom);
    renderHost(api);

    expect(await screen.findByRole('heading', { level: 1, name: 'After Hours' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back to home/i }));

    expect(await screen.findByText('Back at the start')).toBeInTheDocument();
    await waitFor(() => {
      expect(calls.some(
        (call) => call.name === 'playback-command' && (call.body as { action?: string }).action === 'pause',
      )).toBe(true);
    });
  });

  it('pauses the room on tab close even if the last read looked paused', async () => {
    const { api, calls } = makeApi();
    renderHost(api);

    expect(await screen.findByRole('heading', { level: 1, name: 'After Hours' })).toBeInTheDocument();
    window.dispatchEvent(new Event('pagehide'));

    await waitFor(() => {
      expect(calls.some(
        (call) => call.name === 'playback-command' && (call.body as { action?: string }).action === 'pause',
      )).toBe(true);
    });
    const pauseCall = calls.find(
      (call) => call.name === 'playback-command' && (call.body as { action?: string }).action === 'pause',
    );
    expect(pauseCall?.options?.keepalive).toBe(true);
  });

  it('automatically plays a song added to a stopped queue', async () => {
    // A fresh room stores no currentVideoId key at all, so the guard must not
    // treat a missing key as "a song is already loaded".
    const stoppedRoom = {
      ...liveRoom,
      playback: { currentSongId: null, positionSeconds: 0, isPlaying: false, updatedAt: null },
      queue: [{ ...liveRoom.queue[1], status: 'queued' }],
    };
    const playedCalls: Array<{ name: string; body: unknown }> = [];
    const api: EdgeApi = {
      invoke: (async (name: string, body: unknown, _tokens: unknown) => {
        playedCalls.push({ name, body });
        if (name === 'host-room-read' || name === 'guest-room-read' || name === 'touch-member') {
          return stoppedRoom;
        }
        if (name === 'playback-command' && (body as { action?: string }).action === 'play') {
          return { roomId, status: 'live', playback: { ...stoppedRoom.playback, isPlaying: true } };
        }
        if (name === 'playback-command') {
          return { roomId, status: 'live', playback: stoppedRoom.playback };
        }
        return { ok: true };
      }) as unknown as EdgeApi['invoke'],
    };
    renderHost(api);

    await waitFor(() => {
      expect(playedCalls.some(
        (call) => call.name === 'playback-command' && (call.body as { action?: string }).action === 'play'
      )).toBe(true);
    });
    expect((await screen.findAllByText('After Hours · Party view')).length).toBeGreaterThan(0);
  });

  it('takes a host on the queue page into party view when a queued song starts', async () => {
    const stoppedRoom = {
      ...liveRoom,
      playback: { currentSongId: null, positionSeconds: 0, isPlaying: false, updatedAt: null },
      queue: [{ ...liveRoom.queue[1], status: 'queued' }],
    };
    const playedCalls: Array<{ name: string; body: unknown }> = [];
    const api: EdgeApi = {
      invoke: (async (name: string, body: unknown) => {
        playedCalls.push({ name, body });
        if (name === 'host-room-read' || name === 'guest-room-read' || name === 'touch-member') {
          return stoppedRoom;
        }
        if (name === 'playback-command') {
          return { roomId, status: 'live', playback: { ...stoppedRoom.playback, isPlaying: true } };
        }
        return { ok: true };
      }) as unknown as EdgeApi['invoke'],
    };
    renderHost(api, '/room/' + roomId + '/host/queue');

    await waitFor(() => {
      expect(playedCalls.some(
        (call) => call.name === 'playback-command' && (call.body as { action?: string }).action === 'play'
      )).toBe(true);
    });
    expect((await screen.findAllByText('After Hours · Party view')).length).toBeGreaterThan(0);
  });

  it('finishes the song five seconds before the video ends', async () => {
    const actions: string[] = [];
    const playingRoom = {
      ...liveRoom,
      playback: { ...liveRoom.playback, isPlaying: true, positionSeconds: 217 },
    };
    const api: EdgeApi = {
      invoke: (async (name: string, body: unknown) => {
        if (name === 'playback-command') {
          actions.push((body as { action?: string }).action ?? '');
          return { roomId, status: 'live', playback: playingRoom.playback };
        }
        if (name === 'host-room-read' || name === 'guest-room-read' || name === 'touch-member') {
          return playingRoom;
        }
        return { ok: true };
      }) as unknown as EdgeApi['invoke'],
    };
    playerClock.currentTime = 217;
    playerClock.duration = 222;

    renderHost(api);

    await waitFor(() => {
      expect(actions).toContain('next');
    }, { timeout: 5000 });
  });

  it('names the singer on the host now-playing card', async () => {
    const { api } = makeApi();
    renderHost(api);

    expect((await screen.findAllByText('Added by Ana')).length).toBeGreaterThan(0);
  });

  it('lets the host drag the floating video', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('min-width: 1024px'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })));
    const { api } = makeApi();
    renderHost(api);

    const handle = await screen.findByRole('button', { name: /move the video/i });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400, clientY: 250 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    const layer = document.querySelector('[data-host-player]') as HTMLElement;
    expect(layer.style.left).toBe('300px');
    expect(layer.style.top).toBe('150px');
  });

  it('returns from party view to the stage, not the discovery page', async () => {
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/party');

    fireEvent.click(await screen.findByRole('button', { name: /leave party view/i }));

    expect((await screen.findAllByText('Your private stage')).length).toBeGreaterThan(0);
  });

  it('enters the stage at the video frame', async () => {
    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    try {
      const { api } = makeApi();
      renderHost(api, '/room/' + roomId + '/host/stage');
      expect((await screen.findAllByText('Your private stage')).length).toBeGreaterThan(0);
      expect(scrollSpy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    } finally {
      scrollSpy.mockRestore();
    }
  });

  it('keeps the now-playing band outside the video frame', async () => {
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/stage');

    expect((await screen.findAllByText('Your private stage')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Now on the host screen')).toBeNull();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeInTheDocument();
  });

  it('does not request play when a song is already playing', async () => {
    const playingRoom = { ...liveRoom, playback: { ...liveRoom.playback, isPlaying: true } };
    const { api, calls } = makeApi(playingRoom);
    renderHost(api);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'After Hours' })).toBeInTheDocument();
    });
    expect(calls).not.toContainEqual(
      expect.objectContaining({ name: 'playback-command', body: expect.objectContaining({ action: 'play' }) })
    );
  });
});
