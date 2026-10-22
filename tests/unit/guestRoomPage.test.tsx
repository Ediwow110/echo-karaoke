import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createElement } from 'react';
import GuestRoomPage from '../../src/app/GuestRoomPage';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';

afterEach(() => {
  cleanup();
  localStorage.clear();
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

function makeApi(locked = false): { api: EdgeApi; calls: string[] } {
  const calls: string[] = [];
  const api: EdgeApi = {
    invoke: (async (name: string) => {
      calls.push(name);
      if (name === 'queue-command') {
        return { songId: 's1', videoId: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', position: 1 };
      }
      if (name === 'youtube-search' || name === 'youtube-popular') {
        return { available: false, results: [], message: 'Search is not configured.' };
      }
      if (name === 'playback-command') {
        return { roomId, status: 'live', playback: liveRoom(locked).playback };
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
          createElement(Route, { path: '/join/:roomCode', element: createElement('p', null, 'Join page') }),
        ),
      ),
    }),
  );
}

describe('guest phone remote', () => {
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

  it('shows the room identity and the shared queue', async () => {
    const { api, calls } = makeApi();
    renderGuest(api);

    expect(await screen.findByRole('heading', { level: 1, name: 'After Hours' })).toBeInTheDocument();
    expect(screen.getByText(/hosted by ana/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /the room queue/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /search/i })).toBeInTheDocument();
    expect(calls).toContain('guest-room-read');
  });

  it('offers live search and the paste fallback on the search tab', async () => {
    const { api } = makeApi();
    renderGuest(api, '/room/' + roomId + '/search');

    expect(await screen.findByLabelText(/find a song on youtube/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/paste a youtube link/i)).toBeInTheDocument();
  });

  it('shows the lock notice and disables guest requests when the host locks them', async () => {
    const { api } = makeApi(true);
    renderGuest(api, '/room/' + roomId + '/search');

    expect(await screen.findByText(/guest requests are off/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add to queue/i })).toBeDisabled();
  });

  it('adds a song from a pasted link', async () => {
    const { api } = makeApi();
    renderGuest(api, '/room/' + roomId + '/search');

    fireEvent.change(await screen.findByLabelText(/paste a youtube link/i), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } });
    fireEvent.click(screen.getByRole('button', { name: /add to queue/i }));

    expect(await screen.findByText(/never gonna give you up/i)).toBeInTheDocument();
  });

  it('rejects a link that is not a YouTube video', async () => {
    const { api } = makeApi();
    renderGuest(api, '/room/' + roomId + '/search');

    fireEvent.change(await screen.findByLabelText(/paste a youtube link/i), { target: { value: 'https://vimeo.com/123' } });
    fireEvent.click(screen.getByRole('button', { name: /add to queue/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/youtube link/i);
  });

  it('lets a guest leave the room and drops the pass', async () => {
    const { api } = makeApi();
    renderGuest(api);

    fireEvent.click(await screen.findByRole('button', { name: /leave room/i }));

    expect(await screen.findByText('Back at the start')).toBeInTheDocument();
    expect(localStorage.getItem('karaoke.guest.' + roomId)).toBeNull();
  });
});
