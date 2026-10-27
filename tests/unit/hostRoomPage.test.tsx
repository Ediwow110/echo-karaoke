import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import type { DoorEntry } from '../../src/features/rooms/roomApi';
import { clearRoomTokens, saveGuestToken, saveHostToken } from '../../src/features/rooms/tokenStore';
import { getHostedRoom, getLastRoom, rememberSession } from '../../src/features/rooms/sessionStore';
import '@testing-library/jest-dom/vitest';

const playerClock = vi.hoisted(() => ({
  currentTime: 0,
  duration: 0,
  state: -1,
  loadCalls: 0,
  playCalls: 0,
  pauseCalls: 0,
  onEnded: null as (() => void) | null,
}));

vi.mock('../../src/features/playback/youtubeIframe', () => ({
  youtubePlayerFactory: (_element: unknown, callbacks: { onEnded: () => void }) => {
    playerClock.onEnded = callbacks.onEnded;
    return ({
    load: () => { playerClock.loadCalls += 1; },
    play: () => { playerClock.playCalls += 1; },
    pause: () => { playerClock.pauseCalls += 1; },
    seekTo: () => undefined,
    getCurrentTime: () => playerClock.currentTime,
    getDuration: () => playerClock.duration,
    setVolume: () => undefined,
    getVolume: () => 100,
    getState: () => playerClock.state,
    destroy: () => undefined,
    });
  },
}));

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';

beforeEach(() => {
  playerClock.currentTime = 0;
  playerClock.duration = 0;
  playerClock.state = -1;
  playerClock.loadCalls = 0;
  playerClock.playCalls = 0;
  playerClock.pauseCalls = 0;
  playerClock.onEnded = null;
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
  vi.useRealTimers();
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
    requireApproval: true,
    guestPlaybackLocked: true,
    admissionsLocked: false,
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
  door: [] as DoorEntry[],
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
  it('removes all live invite controls when the server ends a room', async () => {
    const ended = { ...liveRoom, status: 'ended' };
    const { api } = makeApi(ended);
    renderHost(api, '/room/' + roomId + '/host');
    expect(await screen.findByRole('heading', { name: 'This room has ended.' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Invite your people' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy link|copy join link/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/ABCD EFGH JKMN PQRS/)).not.toBeInTheDocument();
  });
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
    expect(screen.getByRole('region', { name: 'Invite your people' })).toHaveTextContent('1 in');
    expect(screen.getByRole('region', { name: 'Invite your people' })).not.toHaveTextContent('2 in');
  });

  it('counts guests rather than the host in the stage invitation', async () => {
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/stage');
    const invite = await screen.findByRole('region', { name: 'Invite your people' });
    expect(invite).toHaveTextContent('1 in');
    expect(invite).not.toHaveTextContent('2 in');
  });

  it('keeps the settings that still have a decision, and no add-songs switch', async () => {
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/settings');

    expect(await screen.findByRole('switch', { name: /guests can pause or resume/i })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /approve each guest/i })).toBeChecked();
    // Guests can always add songs now, so the control is gone rather than hidden.
    expect(screen.queryByRole('switch', { name: /guests can add songs/i })).toBeNull();
    expect(screen.getByRole('button', { name: /leave & end room/i })).toBeInTheDocument();
  });

  it('turns approval off and says who was let in', async () => {
    const calls: Array<{ name: string; body: unknown }> = [];
    const api: EdgeApi = {
      invoke: (async (name: string, body: unknown) => {
        calls.push({ name, body });
        if (name === 'set-approval') return { roomId, requireApproval: false, admitted: 2, door: [] };
        if (name === 'host-room-read') return liveRoom;
        if (name === 'touch-member') return {};
        if (name === 'youtube-popular') return { available: false, results: [], message: 'not configured' };
        return { ok: true };
      }) as unknown as EdgeApi['invoke'],
    };
    renderHost(api, '/room/' + roomId + '/host/settings');

    fireEvent.click(await screen.findByRole('switch', { name: /approve each guest/i }));

    await waitFor(() => {
      expect(calls.some((call) => call.name === 'set-approval')).toBe(true);
    });
    expect(calls.find((call) => call.name === 'set-approval')?.body).toEqual({ roomId, requireApproval: false });
    expect(await screen.findByText(/let 2 waiting guests in/i)).toBeInTheDocument();
  });

  it('shows who is waiting and admits them from settings', async () => {
    const withDoor = {
      ...liveRoom,
      door: [{ memberId: '9d1c', displayName: 'Waiting Guest', online: true, joinedAt: '2026-10-26T00:00:00Z' }],
    };
    const { api, calls } = makeApi(withDoor);
    renderHost(api, '/room/' + roomId + '/host/settings');

    expect(await screen.findByText('Waiting Guest')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /let waiting guest in/i }));
    await waitFor(() => {
      expect(calls.some((call) => call.name === 'approve-member')).toBe(true);
    });
  });

  it('names each door answer after the guest it applies to', async () => {
    const withDoor = {
      ...liveRoom,
      door: [{ memberId: '9d1c', displayName: 'Waiting Guest', online: true, joinedAt: '2026-10-26T00:00:00Z' }],
    };
    const { api } = makeApi(withDoor);
    renderHost(api, '/room/' + roomId + '/host/settings');

    expect(await screen.findByRole('button', { name: 'Let Waiting Guest in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep Waiting Guest out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep them out' })).not.toBeInTheDocument();
  });

  it('disables every door answer while one is already pending', async () => {
    const withDoor = {
      ...liveRoom,
      door: [
        { memberId: '9d1c', displayName: 'Waiting Guest', online: true, joinedAt: '2026-10-26T00:00:00Z' },
        { memberId: '7b2e', displayName: 'Second Guest', online: true, joinedAt: '2026-10-26T00:01:00Z' },
      ],
    };
    let release: (value: unknown) => void = () => undefined;
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'host-room-read' || name === 'guest-room-read' || name === 'touch-member') {
          return withDoor;
        }
        if (name === 'approve-member') {
          return new Promise((resolve) => { release = resolve; });
        }
        return { ok: true };
      }) as unknown as EdgeApi['invoke'],
    };
    renderHost(api, '/room/' + roomId + '/host/settings');

    fireEvent.click(await screen.findByRole('button', { name: 'Let Waiting Guest in' }));

    const otherApprove = await screen.findByRole('button', { name: 'Let Second Guest in' });
    const otherReject = screen.getByRole('button', { name: 'Keep Second Guest out' });
    await waitFor(() => {
      expect(otherApprove).toBeDisabled();
      expect(otherReject).toBeDisabled();
    });

    release({ ok: true });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Let Waiting Guest in' })).toBeEnabled();
    });
  });

  it('closes the door to new guests from settings', async () => {
    const { api, calls } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/settings');

    const closeDoor = await screen.findByRole('switch', { name: /close the door to new guests/i });
    expect(closeDoor).not.toBeChecked();
    fireEvent.click(closeDoor);
    await waitFor(() => {
      expect(calls).toContainEqual(expect.objectContaining({
        name: 'set-admissions',
        body: { roomId, locked: true },
      }));
    });
  });

  it('shows a closed door as closed and reopens it from settings', async () => {
    const closedRoom = { ...liveRoom, room: { ...liveRoom.room, admissionsLocked: true } };
    const { api, calls } = makeApi(closedRoom);
    renderHost(api, '/room/' + roomId + '/host/settings');

    const closeDoor = await screen.findByRole('switch', { name: /close the door to new guests/i });
    expect(closeDoor).toBeChecked();
    fireEvent.click(closeDoor);
    await waitFor(() => {
      expect(calls).toContainEqual(expect.objectContaining({
        name: 'set-admissions',
        body: { roomId, locked: false },
      }));
    });
  });

  it('announces the door count on every host screen', async () => {
    const withDoor = {
      ...liveRoom,
      door: [{ memberId: '9d1c', displayName: 'Waiting Guest', online: true, joinedAt: '2026-10-26T00:00:00Z' }],
    };
    const { api } = makeApi(withDoor);
    renderHost(api);
    expect(await screen.findByText(/1 at the door/i)).toBeInTheDocument();
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

  it('forgets the ended room so it is never offered back', async () => {
    // The home screen offers "Back to the room" for a room this browser hosts.
    // An ended room must never be that offer, and the last-room pointer must
    // not lead into it either.
    clearRoomTokens(roomId);
    saveHostToken(roomId, 'host-pass-value');
    rememberSession({
      roomId,
      code: 'ABCDEFGHJKMNPQRS',
      roomName: 'After Hours',
      hostName: 'Ana',
      role: 'host',
    });
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/settings');

    fireEvent.click(await screen.findByRole('button', { name: /leave & end room/i }));
    fireEvent.click(screen.getByRole('button', { name: /^end the room$/i }));

    expect(await screen.findByText('Back at the start')).toBeInTheDocument();
    expect(getHostedRoom()).toBeNull();
    expect(getLastRoom()).toBeNull();
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

  it('does not pause a room this device just ended', async () => {
    // Ending a room clears playback server-side. The exit cleanup still sent a
    // pause afterwards, and the ended room refused it: a 409 in the console every
    // time a host left their own finished room.
    const { api, calls } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/settings');

    fireEvent.click(await screen.findByRole('button', { name: /leave & end room/i }));
    fireEvent.click(screen.getByRole('button', { name: /^end the room$/i }));
    expect(await screen.findByText('Back at the start')).toBeInTheDocument();
    await new Promise((resolve) => { window.setTimeout(resolve, 20); });

    expect(calls.some(
      (call) => call.name === 'playback-command' && (call.body as { action?: string }).action === 'pause',
    )).toBe(false);
  });

  it('does not pause a room this device can no longer command', async () => {
    // The demoted half of a transfer. This tab keeps playing until it unmounts, and
    // the command helper falls back to whatever pass it holds — so the exit pause
    // went out as a *guest* pause and came back 403, because guests cannot pause.
    const { api, calls } = makeApi();
    renderHost(api);

    expect(await screen.findByRole('heading', { level: 1, name: 'After Hours' })).toBeInTheDocument();
    clearRoomTokens(roomId);
    saveGuestToken(roomId, 'fresh-guest-pass');
    window.dispatchEvent(new Event('pagehide'));
    await new Promise((resolve) => { window.setTimeout(resolve, 20); });

    expect(calls.some(
      (call) => call.name === 'playback-command' && (call.body as { action?: string }).action === 'pause',
    )).toBe(false);
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
    // Desktop has a visible floating player while the host is on this route.
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('min-width: 1024px'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })));
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

  async function reportsFromPlayingHost(
    state: number,
    currentTime: number,
    elapsedMs = 2800,
  ): Promise<Array<{ positionSeconds?: unknown }>> {
    // Desktop has a visible floating player while the host is on this route.
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('min-width: 1024px'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })));
    vi.useFakeTimers();
    const reports: Array<{ positionSeconds?: unknown }> = [];
    const playingRoom = {
      ...liveRoom,
      playback: { ...liveRoom.playback, isPlaying: true, positionSeconds: 100 },
    };
    const api: EdgeApi = {
      invoke: (async (name: string, body: unknown) => {
        if (name === 'playback-report') {
          reports.push(body as { positionSeconds?: unknown });
          return playingRoom.playback;
        }
        if (name === 'host-room-read' || name === 'guest-room-read' || name === 'touch-member') {
          return playingRoom;
        }
        return { ok: true };
      }) as unknown as EdgeApi['invoke'],
    };
    playerClock.state = state;
    playerClock.currentTime = currentTime;
    playerClock.duration = 222;

    renderHost(api);
    // Stepped so the report timer is scheduled before the clock passes it.
    for (let step = 0; step < Math.ceil(elapsedMs / 200); step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
    }
    return reports;
  }

  it('does not report a position the video has not reached yet', async () => {
    // YouTube publishes the duration as soon as a video is cued, well before it
    // starts, while getCurrentTime() is still 0. The server writes a reported
    // position unconditionally, so that 0 rewinds the room for every phone.
    expect(await reportsFromPlayingHost(3, 0)).toEqual([]);
  });

  it('keeps reporting the real position once the video is playing', async () => {
    const reports = await reportsFromPlayingHost(1, 102);
    expect(reports.some((report) => report.positionSeconds === 102)).toBe(true);
  });

  it('stays quiet through a long buffering stall', async () => {
    // The twelve-second heartbeat is the report that repeats, so a video that
    // never starts would otherwise rewrite the position over and over.
    expect(await reportsFromPlayingHost(3, 0, 13_000)).toEqual([]);
  });

  async function reportsFromSeek(
    state: number,
    currentTime: number,
    duration: number,
  ): Promise<Array<{ positionSeconds?: unknown }>> {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('min-width: 1024px'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })));
    const reports: Array<{ positionSeconds?: unknown }> = [];
    const playingRoom = {
      ...liveRoom,
      playback: { ...liveRoom.playback, isPlaying: true, positionSeconds: 100 },
    };
    const api: EdgeApi = {
      invoke: (async (name: string, body: unknown) => {
        if (name === 'playback-report') {
          reports.push(body as { positionSeconds?: unknown });
          return playingRoom.playback;
        }
        if (name === 'host-room-read' || name === 'guest-room-read' || name === 'touch-member') {
          return playingRoom;
        }
        return { ok: true };
      }) as unknown as EdgeApi['invoke'],
    };
    playerClock.state = state;
    playerClock.currentTime = currentTime;
    playerClock.duration = duration;

    renderHost(api);
    await screen.findByLabelText('Back 10 seconds');
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Back 10 seconds'));
    });
    return reports;
  }

  it('does not tell the room about a seek the player could not make', async () => {
    // A player that never handed over its controls reads 0 and drops the seek,
    // so reporting one moves every phone to a place the video never reached.
    expect(await reportsFromSeek(-1, 0, 0)).toEqual([]);
  });

  it('still tells the room where a real seek landed', async () => {
    const reports = await reportsFromSeek(1, 100, 222);
    expect(reports.some((report) => report.positionSeconds === 90)).toBe(true);
  });

  it('coalesces repeated YouTube end events into one automatic next request', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('min-width: 1024px'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })));
    const actions: Array<{ action?: string; expectedSongId?: string }> = [];
    const playingRoom = {
      ...liveRoom,
      playback: { ...liveRoom.playback, isPlaying: true },
    };
    const api: EdgeApi = {
      invoke: (async (name: string, body: unknown) => {
        if (name === 'host-room-read' || name === 'guest-room-read' || name === 'touch-member') {
          return playingRoom;
        }
        if (name === 'playback-command') {
          actions.push(body as { action?: string; expectedSongId?: string });
          return { roomId, status: 'live', playback: playingRoom.playback };
        }
        return { ok: true };
      }) as unknown as EdgeApi['invoke'],
    };
    renderHost(api, '/room/' + roomId + '/host/queue');
    await waitFor(() => expect(playerClock.loadCalls).toBeGreaterThan(0));
    expect(playerClock.onEnded).not.toBeNull();
    playerClock.onEnded?.();
    playerClock.onEnded?.();
    await waitFor(() => {
      expect(actions.filter((body) => body.action === 'next')).toHaveLength(1);
    });
    // The old timer-only guard forgets the first event after 1500 ms.
    // Repeated delivery for the same song must still be idempotent.
    await new Promise((resolve) => window.setTimeout(resolve, 1600));
    playerClock.onEnded?.();
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    expect(actions.filter((body) => body.action === 'next')).toHaveLength(1);
    expect(actions.find((body) => body.action === 'next')).toMatchObject({
      action: 'next', expectedSongId: 's1',
    });
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
    expect(Number.parseInt(layer.style.width, 10)).toBeGreaterThanOrEqual(200);
    expect(Number.parseInt(layer.style.height, 10)).toBeGreaterThanOrEqual(200);
  });

  it('does not load or play a song inside an off-screen mobile host player', async () => {
    const playingRoom = {
      ...liveRoom,
      playback: { ...liveRoom.playback, isPlaying: true },
    };
    const { api } = makeApi(playingRoom);
    renderHost(api, '/room/' + roomId + '/host/queue');

    expect(await screen.findByRole('heading', { name: /keep the night moving/i })).toBeInTheDocument();
    const layer = document.querySelector('[data-host-player]') as HTMLElement;
    expect(layer.style.opacity).toBe('0');
    await waitFor(() => {
      expect(playerClock.pauseCalls).toBeGreaterThan(0);
    });
    expect(playerClock.loadCalls).toBe(0);
    expect(playerClock.playCalls).toBe(0);
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
