import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import HomePage from '../../src/app/HomePage';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function stubWide(wide: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: wide,
    media: '',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })));
}

function renderHome(api: EdgeApi = { invoke: (async () => ({})) as unknown as EdgeApi['invoke'] }) {
  return render(
    <RoomApiProvider api={api}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/room/:roomId/host" element={<p>Host room</p>} />
        </Routes>
      </MemoryRouter>
    </RoomApiProvider>,
  );
}

describe('create room workspace', () => {
  it('leads with the named room and host form', () => {
    stubWide(true);
    renderHome();

    expect(screen.getByRole('heading', { level: 2, name: /good company/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/room name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^create room$/i })).toBeInTheDocument();
  });

  it('offers the two guest permissions and explains the host-only rules', () => {
    stubWide(true);
    renderHome();

    expect(screen.getByRole('switch', { name: /guests can add songs/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /guest playback controls/i })).not.toBeChecked();
    expect(screen.getByText(/skip, remove and reorder are always host-only/i)).toBeInTheDocument();
  });

  it('shows the stage guide with real process steps', () => {
    stubWide(true);
    renderHome();

    expect(screen.getByRole('img', { name: /empty stage under a warm spotlight/i })).toHaveAttribute('src', '/images/stage-spotlight.jpg');
    expect(screen.getByText('Create your room')).toBeInTheDocument();
    expect(screen.getByText('Scan. Join. Pass the mic.')).toBeInTheDocument();
  });

  it('creates the named room and moves the host to it', async () => {
    stubWide(true);
    const calls: Array<{ name: string; body: unknown }> = [];
    const api: EdgeApi = {
      invoke: (async (name: string, body: unknown) => {
        calls.push({ name, body });
        return {
          roomId: 'room-1',
          roomCode: 'ABCDEFGHJKMNPQRS',
          roomName: 'After Hours',
          memberId: 'm1',
          displayName: 'Alex',
          role: 'host',
          guestToken: 'guest-pass',
          hostToken: 'host-pass',
        };
      }) as unknown as EdgeApi['invoke'],
    };
    renderHome(api);

    fireEvent.change(screen.getByLabelText(/room name/i), { target: { value: 'After Hours' } });
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: /^create room$/i }));

    expect(await screen.findByText('Host room')).toBeInTheDocument();
    expect(calls[0]).toMatchObject({
      name: 'create-room',
      body: {
        displayName: 'Alex',
        roomName: 'After Hours',
        guestsCanAdd: true,
        guestsCanControlPlayback: false,
      },
    });
  });

  it('asks for a host name before creating a room', async () => {
    stubWide(true);
    renderHome({ invoke: (async () => ({})) as unknown as EdgeApi['invoke'] });

    fireEvent.click(screen.getByRole('button', { name: /^create room$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/add the name guests will see/i);
  });
});

describe('phone entry', () => {
  it('leads a phone with joining, then switches to hosting', () => {
    stubWide(false);
    renderHome();

    expect(screen.getByRole('heading', { level: 1, name: /join the room/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/room code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join room/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /hosting tonight/i }));

    expect(screen.getByRole('heading', { level: 1, name: /make it your room/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/room name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^create room$/i })).toBeInTheDocument();
  });
});
