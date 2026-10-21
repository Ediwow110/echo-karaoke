import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import HostRoomPage from '../../src/app/HostRoomPage';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const liveRoom = {
  roomId,
  status: 'live',
  room: { id: roomId, code: 'ABCDEFGHJKMNPQRS', status: 'live', guestControlLocked: false, createdAt: '2026-10-18T00:00:00Z' },
  viewer: { memberId: 'm1', displayName: 'Ana', role: 'host' },
  roster: [{ memberId: 'm1', displayName: 'Ana', role: 'host', online: true }],
  queue: [],
  playback: { currentSongId: null, currentVideoId: null, positionSeconds: 0, isPlaying: false, updatedAt: null },
  events: [],
};

function renderHost() {
  localStorage.setItem('karaoke.host.' + roomId, 'host-pass');
  const api: EdgeApi = {
    invoke: (async () => liveRoom) as unknown as EdgeApi['invoke'],
  };
  return render(
    createElement(
      RoomApiProvider,
      {
        api,
        children: createElement(
          MemoryRouter,
          { initialEntries: ['/room/' + roomId + '/host'] },
          createElement(
            Routes,
            { children: createElement(Route, { path: '/room/:roomId/host', element: createElement(HostRoomPage) }) },
          ),
        ),
      },
    ),
  );
}

describe('host console', () => {
  it('shows the room code and the invite tools', async () => {
    renderHost();
    expect(await screen.findByText('ABCDEFGHJKMNPQRS')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('offers the host controls with an icon and a word', async () => {
    renderHost();
    expect(await screen.findByRole('button', { name: /^lock$/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /clear queue/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /end room/i })).toBeInTheDocument();
  });
});
