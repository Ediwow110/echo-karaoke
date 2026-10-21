import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function liveRoom() {
  return {
    roomId,
    status: 'live',
    room: { id: roomId, code: 'ABCDEFGHJKMNPQRS', status: 'live', guestControlLocked: false, createdAt: '2026-10-18T00:00:00Z' },
    viewer: { memberId: 'm1', displayName: 'Sam', role: 'guest' },
    roster: [{ memberId: 'm1', displayName: 'Sam', role: 'guest', online: true }],
    queue: [],
    playback: { currentSongId: null, positionSeconds: 0, isPlaying: false, updatedAt: null },
    events: [],
  };
}

function renderGuest(api: EdgeApi) {
  localStorage.setItem('karaoke.guest.' + roomId, 'guest-pass-value');
  return render(
    createElement(
      RoomApiProvider,
      { api, children: createElement(MemoryRouter, {
        initialEntries: ['/room/' + roomId],
        children: createElement(Routes, {
          children: [
            createElement(Route, {
              key: 'room',
              path: '/room/:roomId',
              element: createElement(GuestRoomPage),
            }),
            createElement(Route, {
              key: 'home',
              path: '/',
              element: createElement('p', null, 'Back at the start'),
            }),
          ],
        }),
      }) },
    ),
  );
}

describe('guest room page', () => {
  it('shows the room state and offers an add-song form', async () => {
    const calls: string[] = [];
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        calls.push(name);
        return liveRoom();
      }) as unknown as EdgeApi['invoke'],
    };

    renderGuest(api);

    expect(await screen.findByRole('heading', { name: 'Sam' })).toBeInTheDocument();
    expect(screen.getAllByText('Sam').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/paste a youtube link/i)).toBeInTheDocument();
    expect(calls).toContain('guest-room-read');
  });

  it('shows the lock notice when the host locks guest controls', async () => {
    const locked = liveRoom();
    locked.room.guestControlLocked = true;
    const api: EdgeApi = {
      invoke: (async () => locked) as unknown as EdgeApi['invoke'],
    };

    renderGuest(api);

    expect(await screen.findByText(/guest controls are locked/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add to queue/i })).toBeDisabled();
  });

  it('adds a song from a pasted link', async () => {
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'queue-command') {
          return { songId: 's1', videoId: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', position: 1 };
        }
        return liveRoom();
      }) as unknown as EdgeApi['invoke'],
    };

    renderGuest(api);

    const input = await screen.findByLabelText(/paste a youtube link/i);
    fireEvent.change(input, { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } });
    fireEvent.click(screen.getByRole('button', { name: /add to queue/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/never gonna give you up/i);
    });
  });

  it('rejects a link that is not a YouTube video', async () => {
    const api: EdgeApi = {
      invoke: (async () => liveRoom()) as unknown as EdgeApi['invoke'],
    };

    renderGuest(api);

    const input = await screen.findByLabelText(/paste a youtube link/i);
    fireEvent.change(input, { target: { value: 'https://vimeo.com/123' } });
    fireEvent.click(screen.getByRole('button', { name: /add to queue/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/youtube link/i);
  });

  it('lets a guest leave the room and drops the pass', async () => {
    const api: EdgeApi = {
      invoke: (async () => liveRoom()) as unknown as EdgeApi['invoke'],
    };

    renderGuest(api);

    fireEvent.click(await screen.findByRole('button', { name: /leave room/i }));

    expect(await screen.findByText('Back at the start')).toBeInTheDocument();
    expect(localStorage.getItem('karaoke.guest.' + roomId)).toBeNull();
  });
});