import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createElement } from 'react';
import GuestRoomPage from '../../src/app/GuestRoomPage';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import { RoomApiError, type EdgeApi } from '../../src/lib/edgeApi';
import { clearRoomTokens } from '../../src/features/rooms/tokenStore';
import '@testing-library/jest-dom/vitest';

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

function liveRoom(locked = false) {
  return {
    roomId,
    status: 'live',
    room: {
      id: roomId,
      code: 'ABCDEFGHJKMNPQRS',
      name: 'After Hours',
      status: 'live',
      guestControlLocked: locked,
      guestPlaybackLocked: true,
      createdAt: '2026-10-18T00:00:00Z',
    },
    viewer: { memberId: 'm2', displayName: 'Sam', role: 'guest' },
    roster: [
      { memberId: 'm1', displayName: 'Ana', role: 'host', online: true },
      { memberId: 'm2', displayName: 'Sam', role: 'guest', online: true },
    ],
    queue: [],
    playback: { currentSongId: null, currentVideoId: null, positionSeconds: 0, isPlaying: false, updatedAt: null },
    events: [],
  };
}

function makeApi(locked = false, catalogItems: unknown[] = []): { api: EdgeApi; calls: string[] } {
  const calls: string[] = [];
  const api: EdgeApi = {
    invoke: (async (name: string) => {
      calls.push(name);
      if (name === 'queue-command') {
        return { songId: 's1', videoId: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', position: 1 };
      }
      if (name === 'youtube-search') {
        return { available: true, results: [{
          videoId: 'dQw4w9WgXcQ',
          title: 'Never Gonna Give You Up',
          channelTitle: 'Rick Astley',
          thumbnailUrl: null,
          durationSeconds: null,
        }] };
      }
      if (name === 'youtube-popular') {
        return { available: false, results: [], message: 'Search is not configured.' };
      }
      if (name === 'playback-command') {
        return { roomId, status: 'live', playback: liveRoom(locked).playback };
      }
      if (name === 'catalog-page') {
        return { total: catalogItems.length, items: catalogItems };
      }
      return liveRoom(locked);
    }) as unknown as EdgeApi['invoke'],
  };
  return { api, calls };
}

function renderGuest(api: EdgeApi, path = '/room/' + roomId) {
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
          createElement(Route, { path: '/room/:roomId', element: createElement(GuestRoomPage) }),
          createElement(Route, { path: '/room/:roomId/search', element: createElement(GuestRoomPage) }),
          createElement(Route, { path: '/room/:roomId/songbook', element: createElement(GuestRoomPage) }),
          createElement(Route, { path: '/join/:roomCode', element: createElement('p', null, 'Join page') }),
        ),
      ),
    }),
  );
}

describe('guest phone remote', () => {
  it('claims a transferred room exactly once and keeps the pass it minted', async () => {
    // A second claim rotates the room's host secret, which would invalidate the
    // pass this browser is already holding — so the promoted guest must claim
    // once, and a later reload with a stored pass must not claim again.
    const calls: string[] = [];
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        calls.push(name);
        if (name === 'claim-host') {
          return { roomId, memberId: 'm2', hostToken: 'c'.repeat(40) };
        }
        return { ...liveRoom(), viewer: { memberId: 'm2', displayName: 'Sam', role: 'host' } };
      }) as unknown as EdgeApi['invoke'],
    };

    renderGuest(api);
    expect(await screen.findByText(/you are the host now/i)).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((n) => n === 'claim-host')).toHaveLength(1));
    expect(localStorage.getItem('karaoke.host.' + roomId)).toContain('cccc');

    cleanup();
    renderGuest(api);
    await screen.findByText(/the room queue/i);
    expect(calls.filter((n) => n === 'claim-host')).toHaveLength(1);
  });

  it('keeps claiming the host pass until the room has one', async () => {
    // The outgoing host's pass is revoked by the transfer itself, so a claim
    // that fails leaves a room nobody can control. The four-second poll never
    // changes this effect's inputs, so without a retry the promoted guest waits
    // for a reload that nothing on screen ever asks for.
    const calls: string[] = [];
    let attempts = 0;
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        calls.push(name);
        if (name === 'claim-host') {
          attempts += 1;
          if (attempts === 1) {
            throw new RoomApiError('NETWORK_ERROR', 0, 'The room service could not be reached');
          }
          return { roomId, memberId: 'm2', hostToken: 'c'.repeat(40) };
        }
        if (name === 'touch-member') return {};
        return { ...liveRoom(), viewer: { memberId: 'm2', displayName: 'Sam', role: 'host' } };
      }) as unknown as EdgeApi['invoke'],
    };

    // tokenStore also caches passes in module memory, which localStorage.clear
    // in afterEach does not reach: a host pass left by an earlier test would
    // make this guest look like a device that already claimed.
    clearRoomTokens(roomId);
    renderGuest(api);

    await waitFor(() => {
      expect(calls.filter((name) => name === 'claim-host').length).toBeGreaterThan(1);
    }, { timeout: 9000 });
    expect(await screen.findByText(/you are the host now/i)).toBeInTheDocument();
    expect(localStorage.getItem('karaoke.host.' + roomId)).toContain('cccc');
  }, 20000);

  it('announces the loading state before room data arrives', async () => {
    const pendingApi: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'touch-member') return {};
        return new Promise(() => undefined);
      }) as unknown as EdgeApi['invoke'],
    };
    renderGuest(pendingApi);

    expect(await screen.findByRole('status')).toHaveTextContent(/loading the room/i);
  });

  it('announces when the host has ended the room', async () => {
    const endedApi: EdgeApi = {
      invoke: (async () => ({ roomId, status: 'ended' })) as unknown as EdgeApi['invoke'],
    };
    renderGuest(endedApi);

    expect(await screen.findByRole('heading', { name: 'This room has ended.' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/host closed the session/i);
  });

  it('waits at the door instead of showing an empty room', async () => {
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'guest-room-read') {
          return {
            roomId, status: 'waiting',
            room: { id: roomId, name: 'Moderated', hostName: 'Rafa' },
            viewer: { memberId: 'm1', displayName: 'Guest', role: 'guest', status: 'pending' },
          };
        }
        return {};
      }) as unknown as EdgeApi['invoke'],
    };
    renderGuest(api);
    expect(await screen.findByText(/rafa needs to let you in/i)).toBeInTheDocument();
    expect(screen.queryByText(/shared playlist/i)).toBeNull();
  });

  it('keeps polling while the guest waits, so the screen opens when the host admits them', async () => {
    // A waiting read must not stop the four-second poll: the host admits from
    // the other screen, and this screen only learns about it by reading again.
    vi.useFakeTimers();
    let reads = 0;
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'touch-member') return {};
        if (name === 'guest-room-read') {
          reads += 1;
          if (reads === 1) {
            return {
              roomId, status: 'waiting',
              room: { id: roomId, name: 'Moderated', hostName: 'Rafa' },
              viewer: { memberId: 'm1', displayName: 'Guest', role: 'guest', status: 'pending' },
            };
          }
          return liveRoom();
        }
        return {};
      }) as unknown as EdgeApi['invoke'],
    };
    const view = renderGuest(api);
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByText(/rafa needs to let you in/i)).toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
      expect(screen.getByRole('heading', { level: 1, name: 'After Hours' })).toBeInTheDocument();
      expect(reads).toBeGreaterThanOrEqual(2);
      expect(screen.queryByText(/rafa needs to let you in/i)).toBeNull();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('treats a rate-limited poll as a wait, not as a revoked pass', async () => {
    // The per-session budget is a temporary ceiling. If it were classified like
    // UNAUTHORIZED the tab would stop polling for good, which turns a busy minute
    // into a dead room.
    vi.useFakeTimers();
    let reads = 0;
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'touch-member') return {};
        if (name === 'guest-room-read') {
          reads += 1;
          if (reads === 2) {
            throw new RoomApiError('RATE_LIMITED', 429, 'Slow down: too many requests from this session');
          }
          return liveRoom();
        }
        return {};
      }) as unknown as EdgeApi['invoke'],
    };
    const view = renderGuest(api);
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByRole('heading', { level: 1, name: 'After Hours' })).toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
      expect(screen.getByRole('heading', { level: 1, name: 'After Hours' })).toBeInTheDocument();
      expect(screen.queryByText(/room pass is no longer valid/i)).toBeNull();

      await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
      expect(reads).toBeGreaterThanOrEqual(3);
      expect(screen.getByRole('heading', { level: 1, name: 'After Hours' })).toBeInTheDocument();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('shows the room identity and the shared queue', async () => {
    const { api, calls } = makeApi();
    renderGuest(api);

    expect(await screen.findByRole('heading', { level: 1, name: 'After Hours' })).toBeInTheDocument();
    expect(screen.getByText(/hosted by ana/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /the room queue/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /search/i })).toBeInTheDocument();
    expect(calls).toContain('guest-room-read');
  });

  it('offers only live search on the search tab', async () => {
    const { api } = makeApi();
    renderGuest(api, '/room/' + roomId + '/search');

    expect(await screen.findByLabelText(/find a song on youtube/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/paste a youtube link/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: /add a song by youtube link/i })).not.toBeInTheDocument();
  });

  it('shows the lock notice and disables guest requests when the host locks them', async () => {
    const { api, calls } = makeApi(true);
    renderGuest(api, '/room/' + roomId + '/search');

    expect(await screen.findByText(/guest requests are off/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/find a song on youtube/i), { target: { value: 'Rick Astley' } });
    const add = await screen.findByRole('button', { name: /^add never gonna give you up$/i });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(calls).not.toContain('queue-command');
  });

  it('adds a song from a YouTube search result', async () => {
    const { api, calls } = makeApi();
    renderGuest(api, '/room/' + roomId + '/search');

    fireEvent.change(await screen.findByLabelText(/find a song on youtube/i), { target: { value: 'Rick Astley' } });
    fireEvent.click(await screen.findByRole('button', { name: /^add never gonna give you up$/i }));

    expect(await screen.findByText(/never gonna give you up added/i)).toBeInTheDocument();
    expect(calls).toContain('queue-command');
  });

  it('carries the host lock into the songbook so a locked guest cannot queue a song', async () => {
    // GuestRoomPage passes locked={locked} to the songbook screen. Nothing
    // covered that seam: dropping the prop left a locked guest with a fully
    // working Add button on the one screen that had no test for it.
    const song = {
      videoId: 'dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      channelTitle: 'Rick Astley',
      thumbnailUrl: null,
      publishedAt: '2025-01-02T00:00:00Z',
    };

    const open = makeApi(true, [song]);
    renderGuest(open.api, '/room/' + roomId + '/songbook');
    const addLocked = await screen.findByRole('button', { name: 'Add Never Gonna Give You Up' });
    expect(addLocked).toBeDisabled();
    fireEvent.click(addLocked);
    expect(open.calls).not.toContain('queue-command');

    const unlocked = makeApi(false, [song]);
    cleanup();
    renderGuest(unlocked.api, '/room/' + roomId + '/songbook');
    expect(await screen.findByRole('button', { name: 'Add Never Gonna Give You Up' })).toBeEnabled();
  });

  it('opens the songbook inside the remote as its own tab', async () => {
    const { api, calls } = makeApi();
    renderGuest(api, '/room/' + roomId + '/songbook');

    expect(await screen.findByRole('heading', { name: 'Karaoke songbook' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/room/' + roomId + '/search');
    expect(within(main).getByRole('button', { name: 'Musisi Karaoke' })).toBeInTheDocument();
    expect(await screen.findByText(/warming up/i)).toBeInTheDocument();
    expect(calls).toContain('guest-room-read');
    expect(calls).toContain('catalog-page');

    const nav = screen.getByRole('navigation', { name: /remote sections/i });
    expect(within(nav).getAllByRole('link')).toHaveLength(3);
    expect(within(nav).getByRole('link', { name: 'Search' }))
      .toHaveAttribute('href', '/room/' + roomId + '/search');
    expect(within(nav).getByRole('link', { name: /queue/i }))
      .toHaveAttribute('href', '/room/' + roomId);
    expect(within(nav).getByRole('link', { name: 'Songbook' }))
      .toHaveAttribute('href', '/room/' + roomId + '/songbook');
    // The screen you are on owns the highlight.
    expect(within(nav).getByRole('link', { name: 'Songbook' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Search' })).not.toHaveAttribute('aria-current');
  });

  it('lets a guest leave the room and drops the pass', async () => {
    const { api } = makeApi();
    renderGuest(api);

    fireEvent.click(await screen.findByRole('button', { name: /leave room/i }));

    expect(await screen.findByText('Back at the start')).toBeInTheDocument();
    expect(localStorage.getItem('karaoke.guest.' + roomId)).toBeNull();
  });
});
