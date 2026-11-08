import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import HostRoomPage from '../../src/app/HostRoomPage';
import HostQueuePage from '../../src/app/HostQueuePage';
import HostSettingsPage from '../../src/app/HostSettingsPage';
import HostPartyPage from '../../src/app/HostPartyPage';
import { HostStageRedirect } from '../../src/app/App';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import { clearRoomTokens, saveGuestToken, saveHostToken } from '../../src/features/rooms/tokenStore';
import { getHostedRoom, getLastRoom, rememberSession } from '../../src/features/rooms/sessionStore';
import { isFavorite } from '../../src/features/library/libraryStore';
import '@testing-library/jest-dom/vitest';

const playerClock = vi.hoisted(() => ({
  currentTime: 0,
  duration: 0,
  state: -1,
  loadCalls: 0,
  playCalls: 0,
  pauseCalls: 0,
  onEnded: null as (() => void) | null,
  onError: null as ((code: number) => void) | null,
  onStateChange: null as ((state: number) => void) | null,
}));

vi.mock('../../src/features/playback/youtubeIframe', () => ({
  youtubePlayerFactory: (
    _element: unknown,
    callbacks: {
      onEnded: () => void;
      onError?: (code: number) => void;
      onStateChange?: (state: number) => void;
    },
  ) => {
    playerClock.onEnded = callbacks.onEnded;
    playerClock.onError = callbacks.onError ?? null;
    playerClock.onStateChange = callbacks.onStateChange ?? null;
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
  playerClock.onError = null;
  playerClock.onStateChange = null;
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
          createElement(Route, { path: '/room/:roomId', element: createElement('p', null, 'Guest remote') }),
          createElement(
            Route,
            { path: '/room/:roomId/host', element: createElement(HostRoomPage) },
            createElement(Route, { index: true, element: createElement(Navigate, { to: 'party', replace: true }) }),
            createElement(Route, { path: 'queue', element: createElement(HostQueuePage) }),
            createElement(Route, { path: 'settings', element: createElement(HostSettingsPage) }),
            createElement(Route, { path: 'stage', element: createElement(HostStageRedirect) }),
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

    // The room is the stage now: its name is in the header and the invitation
    // sits over the video.
    expect(await screen.findByText('After Hours · TV stage')).toBeInTheDocument();
    expect(screen.getAllByText(/ABCD EFGH JKMN PQRS/).length).toBeGreaterThan(0);
    expect(await screen.findByRole('img', { name: /QR code to join After Hours/i })).toBeInTheDocument();
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
    // The approval door is gone: there is no switch for it, and guests are in
    // the room the moment they join.
    expect(screen.queryByRole('switch', { name: /approve each guest/i })).toBeNull();
    // Guests can always add songs now, so no switch for it survives under any
    // label. Matching the concept rather than the old wording is the point: the
    // control came back once already behind a renamed label.
    expect(screen.queryByRole('switch', { name: /guests can add/i })).toBeNull();
    // Ending the room lives on the stage now; settings keeps only decisions.
    expect(screen.queryByRole('button', { name: /leave & end room|leave screen/i })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Invite your people' })).toBeNull();
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

  it('can end the room from the stage header after confirmation', async () => {
    const { api, calls } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/party');

    fireEvent.click(await screen.findByRole('button', { name: /^end room$/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/every remote loses access/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^end the room$/i }));

    expect(await screen.findByText('Back at the start')).toBeInTheDocument();
    expect(calls.some((call) => call.name === 'host-command' && (call.body as { action?: string }).action === 'end')).toBe(true);
  });

  it('keeps the room open when the stage end dialog is cancelled', async () => {
    const { api, calls } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/party');

    fireEvent.click(await screen.findByRole('button', { name: /^end room$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /keep it open/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.some((call) => call.name === 'host-command' && (call.body as { action?: string }).action === 'end')).toBe(false);
    expect(screen.getByText('After Hours · TV stage')).toBeInTheDocument();
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
    renderHost(api, '/room/' + roomId + '/host/party');

    fireEvent.click(await screen.findByRole('button', { name: /^end room$/i }));
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
    // The stage is the room now and carries no exit; leaving for home is an act
    // of the console pages, which is where the shell's sign-out lives.
    renderHost(api, '/room/' + roomId + '/host/queue');

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

    // The redirect into party plus the first room read can exceed the default
    // one-second find timeout on a loaded CI worker.
    expect(await screen.findByRole('heading', { level: 1, name: 'After Hours' }, { timeout: 4000 })).toBeInTheDocument();
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
    renderHost(api, '/room/' + roomId + '/host/party');

    fireEvent.click(await screen.findByRole('button', { name: /^end room$/i }));
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

    expect(await screen.findByRole('heading', { level: 1, name: 'After Hours' }, { timeout: 4000 })).toBeInTheDocument();
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
    expect((await screen.findAllByText('After Hours · TV stage')).length).toBeGreaterThan(0);
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
    expect((await screen.findAllByText('After Hours · TV stage')).length).toBeGreaterThan(0);
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
    // The dock renders its controls disabled until the room read lands, and a
    // click on a disabled button is a no-op, so wait for it to be live.
    const back = await screen.findByLabelText('Back 10 seconds');
    await waitFor(() => expect(back).toBeEnabled());
    await act(async () => {
      fireEvent.click(back);
    });
    return reports;
  }

  it('does not tell the room about a seek the player could not make', async () => {
    // A player that never handed over its controls reads 0 and drops the seek,
    // so reporting one moves every phone to a place the video never reached.
    const reports = await reportsFromSeek(-1, 0, 0);
    // Give a wrongly scheduled report time to surface before calling the list empty.
    await new Promise((resolve) => { window.setTimeout(resolve, 20); });
    expect(reports).toEqual([]);
  });

  it('still tells the room where a real seek landed', async () => {
    const reports = await reportsFromSeek(1, 100, 222);
    // The report travels through the async command helper; on a loaded worker
    // the tick that pushes it can land after the click returns.
    await waitFor(() => {
      expect(reports.some((report) => report.positionSeconds === 90)).toBe(true);
    });
  });

  it('does not claim autoplay is on while the room is paused', async () => {
    const { api } = makeApi();

    renderHost(api, '/room/' + roomId + '/host/stage');
    await screen.findByRole('button', { name: /switch to (tv|computer)/i });

    expect(screen.queryByText('Autoplay on')).toBeNull();
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('does not show a green autoplay light while the advance is stalled', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('min-width: 1024px'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })));
    const playingRoom = {
      ...liveRoom,
      playback: { ...liveRoom.playback, isPlaying: true, positionSeconds: 217 },
    };
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'playback-command') {
          throw new Error('The room service could not be reached');
        }
        if (name === 'host-room-read' || name === 'guest-room-read' || name === 'touch-member') {
          return playingRoom;
        }
        return { ok: true };
      }) as unknown as EdgeApi['invoke'],
    };
    playerClock.state = 1;
    playerClock.currentTime = 217;
    playerClock.duration = 222;

    // The song ends, the advance fails, and the player stays mounted across the
    // route change, so the stage inherits the stalled flag.
    renderHost(api);
    fireEvent.click(await screen.findByLabelText('Open TV stage'));
    await screen.findByRole('button', { name: /switch to (tv|computer)/i });

    // One "Playback stalled" is the overlay over the video; the second is the
    // status pill, which used to keep reporting that all was well.
    await waitFor(() => expect(screen.getAllByText('Playback stalled').length).toBe(2));
    expect(screen.queryByText('Autoplay on')).toBeNull();
  });

  it('still reports autoplay once the room is really playing', async () => {
    const playing = { ...liveRoom, playback: { ...liveRoom.playback, isPlaying: true } };
    const { api } = makeApi(playing);
    playerClock.state = 1;

    renderHost(api, '/room/' + roomId + '/host/stage');
    await screen.findByRole('button', { name: /switch to (tv|computer)/i });

    expect(screen.getByText('Autoplay on')).toBeInTheDocument();
  });

  it('clears a transient player error once the video is actually playing', async () => {
    // YouTube can report an error while a cue is still loading and then play
    // the video anyway. The overlay and the six-second auto-skip must not
    // punish a video that recovered.
    const playing = { ...liveRoom, playback: { ...liveRoom.playback, isPlaying: true } };
    const { api, calls } = makeApi(playing);
    playerClock.state = 1;

    renderHost(api, '/room/' + roomId + '/host/stage');
    await screen.findByRole('button', { name: /switch to (tv|computer)/i });
    await waitFor(() => expect(playerClock.onError).not.toBeNull());

    act(() => { playerClock.onError?.(2); });
    expect(await screen.findByRole('heading', { name: /this video can't play here/i })).toBeInTheDocument();

    act(() => { playerClock.onStateChange?.(1); });
    await waitFor(() => expect(screen.queryByRole('heading', { name: /this video can't play here/i })).toBeNull());
    expect(calls.some((call) => call.name === 'playback-command'
      && (call.body as { action?: string }).action === 'next')).toBe(false);
  });

  async function confirmTransfer(fails: boolean): Promise<void> {
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'transfer-host') {
          if (fails) {
            throw new Error('The room service could not be reached');
          }
          return {
            roomId,
            guestToken: 'g'.repeat(40),
            role: 'guest',
            newHost: { memberId: '22222222-2222-2222-2222-222222222222', displayName: 'Jamie' },
          };
        }
        if (name === 'host-room-read' || name === 'guest-room-read' || name === 'touch-member') {
          return liveRoom;
        }
        return { ok: true };
      }) as unknown as EdgeApi['invoke'],
    };

    renderHost(api, '/room/' + roomId + '/host/settings');
    fireEvent.click(await screen.findByLabelText('Hand the room to Jamie'));
    fireEvent.click(await screen.findByText('Hand it over'));
  }

  it('keeps the handover dialog open when the transfer fails', async () => {
    // A handover that did not happen must not look like one that did: the host
    // needs the same dialog still there to try again, not a rebuilt list.
    await confirmTransfer(true);

    await waitFor(() => {
      expect(screen.getByText('The room could not be transferred.')).toBeInTheDocument();
    });
    expect(screen.getByText('Hand it over')).toBeInTheDocument();
  });

  it('hands the room over and leaves the host screen when the transfer succeeds', async () => {
    await confirmTransfer(false);

    expect(await screen.findByText('Guest remote')).toBeInTheDocument();
  });

  it('stays on the stage when starting the queue fails', async () => {
    // Starting the room used to live on the console page. The stage owns that
    // press now, so a refused start has to leave the host where the retry is.
    const stoppedRoom = {
      ...liveRoom,
      playback: { currentSongId: null, positionSeconds: 0, isPlaying: false, updatedAt: null },
      queue: [{ ...liveRoom.queue[0], status: 'queued' }],
    };
    let attemptedPlay = 0;
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'playback-command') {
          attemptedPlay += 1;
          throw new Error('The room service could not be reached');
        }
        if (name === 'host-room-read' || name === 'guest-room-read' || name === 'touch-member') {
          return stoppedRoom;
        }
        return { ok: true };
      }) as unknown as EdgeApi['invoke'],
    };

    renderHost(api);
    // Wait for the stage itself: the index route redirects, and the console
    // shell's dock also has a Play button while that lands.
    expect(await screen.findByRole('button', { name: /switch to computer/i })).toBeInTheDocument();
    // Nothing is playing and one song waits, which is the state the old console
    // page called "Start the session".
    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));

    await waitFor(() => expect(attemptedPlay).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /switch to computer/i })).toBeInTheDocument();
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

    expect((await screen.findAllByText(/Added by Ana/)).length).toBeGreaterThan(0);
  });

  it('lets the host drag the floating video', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('min-width: 1024px'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })));
    const { api } = makeApi();
    // The draggable frame is the docked player on a console page; the stage owns
    // its slot instead.
    renderHost(api, '/room/' + roomId + '/host/queue');

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

  it('keeps the stage as the room, with no exit control', async () => {
    // The leave control is gone on purpose: the stage is the room now, and the
    // only move is the layout switch. Escape on the TV layout must not navigate
    // anywhere either, because the console page it used to return to is retired.
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/party');

    expect(await screen.findByRole('button', { name: /switch to computer/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /leave/i })).toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText('After Hours · TV stage')).toBeInTheDocument();
    expect(screen.queryByText('kara-echo song search')).toBeNull();
  });

  it('takes Escape from the computer layout back to the TV layout, not out of the room', async () => {
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/party');

    fireEvent.click(await screen.findByRole('button', { name: /switch to computer/i }));
    expect(await screen.findByRole('tab', { name: /search/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('tab', { name: /songbook/i })).toBeNull());
    expect(screen.getByText('After Hours · TV stage')).toBeInTheDocument();
  });

  it('takes Escape from a focused control back to the TV layout', async () => {
    // The real flow ends with a click, so focus sits on a tab or a transport
    // button by the time a host reaches for Escape. A guard that swallowed the
    // key over any control left the computer layout unexitable.
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/party');

    fireEvent.click(await screen.findByRole('button', { name: /switch to computer/i }));
    const queueTab = await screen.findByRole('tab', { name: /queue/i });
    fireEvent.click(queueTab);
    fireEvent.keyDown(queueTab, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('tab', { name: /songbook/i })).toBeNull());
    expect(screen.getByText('After Hours · TV stage')).toBeInTheDocument();
  });

  it('keeps Escape to itself when a search field has focus', async () => {
    // Typing is the one place Escape must not switch layouts: a host dismissing
    // a dropdown or clearing a field has to stay on the panel they are in.
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/party?layout=computer');

    const search = await screen.findByRole('search');
    fireEvent.keyDown(search.querySelector('input') ?? search, { key: 'Escape' });

    expect(await screen.findByRole('tab', { name: /songbook/i })).toBeInTheDocument();
  });

  it('saves the song the stage is playing to favorites', async () => {
    // The stage is the only screen that shows what the room is watching, so its
    // heart is how that song gets kept. Merging the stage into the party view
    // dropped the control and no other test noticed, because the library page has
    // its own.
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/party');

    fireEvent.click(await screen.findByRole('button', { name: 'Save Afterglow to favorites' }));

    expect(screen.getByRole('button', { name: 'Remove Afterglow from favorites' })).toHaveAttribute('aria-pressed', 'true');
    expect(isFavorite('dQw4w9WgXcQ')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Afterglow from favorites' }));
    expect(isFavorite('dQw4w9WgXcQ')).toBe(false);
  });

  it('enters the stage at the video frame', async () => {
    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    try {
      const { api } = makeApi();
      renderHost(api, '/room/' + roomId + '/host/stage');
      expect((await screen.findAllByText('After Hours · TV stage')).length).toBeGreaterThan(0);
      expect(scrollSpy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    } finally {
      scrollSpy.mockRestore();
    }
  });

  it('keeps the now-playing band outside the video frame', async () => {
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/stage');

    expect((await screen.findAllByText('After Hours · TV stage')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Now on the host screen')).toBeNull();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeInTheDocument();
  });

  it('opens the stage as a TV layout with no operator panel', async () => {
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/stage');

    const switcher = await screen.findByRole('button', { name: /switch to computer/i });
    expect(switcher).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('redirects the retired stage route onto the TV stage', async () => {
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/stage');

    // The stage screen no longer exists; the old link has to land on the one
    // audience screen rather than 404 into the catch-all redirect. The header
    // text appears in both layouts, so the layout itself is what gets asserted.
    expect(await screen.findByRole('button', { name: /switch to computer/i })).toBeInTheDocument();
    expect(screen.queryByRole('search')).toBeNull();
    expect(screen.queryByRole('tab', { name: /songbook/i })).toBeNull();
    expect(screen.queryByText('Your private stage')).toBeNull();
  });

  it('opens Room settings from the stage header', async () => {
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/party');

    fireEvent.click(await screen.findByRole('link', { name: 'Room settings' }));

    expect(await screen.findByRole('heading', { name: /a room that feels like yours/i })).toBeInTheDocument();
  });

  it('gives the computer layout Search, Queue and Songbook tabs', async () => {
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/party');

    fireEvent.click(await screen.findByRole('button', { name: /switch to computer/i }));

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Search', 'Queue', 'Songbook']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('search')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /^queue$/i }));
    expect(screen.queryByRole('search')).toBeNull();
    expect(within(screen.getByRole('tabpanel', { name: 'queue panel' })).getByText('Midnight City')).toBeInTheDocument();
  });

  it('adds the search panel without leaving the stage route', async () => {
    const { api } = makeApi();
    renderHost(api, '/room/' + roomId + '/host/stage');

    fireEvent.click(await screen.findByRole('button', { name: /switch to computer/i }));

    expect(await screen.findByRole('search')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch to tv/i })).toHaveAttribute('aria-pressed', 'true');
    // The positive half: the stage rendered, not Discover. Its only h1 is the
    // song the room is watching, where Discover's would name the room.
    expect(screen.getByRole('heading', { level: 1, name: 'Afterglow' })).toBeInTheDocument();
    // The switch is a query param, not a route change: navigating would leave this
    // screen's measured slot and move the video to the floating frame, and it would
    // land on Discover, whose own heading must not appear here.
    expect(screen.queryByText('kara-echo song search')).toBeNull();
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

  it('reports a slider seek once when it is released, not on every input event', async () => {
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
    playerClock.state = 1;
    playerClock.currentTime = 100;
    playerClock.duration = 222;

    // The slider under test is the docked player's, which console pages carry.
    renderHost(api, '/room/' + roomId + '/host/queue');
    const back = await screen.findByLabelText('Back 10 seconds');
    await waitFor(() => expect(back).toBeEnabled());
    const slider = screen.getByRole('slider', { name: 'Playback position' });

    await act(async () => {
      fireEvent.change(slider, { target: { value: '150' } });
    });
    expect(reports).toEqual([]);

    await act(async () => {
      fireEvent.pointerUp(slider);
    });
    await waitFor(() => expect(reports).toHaveLength(1));
  });

});
