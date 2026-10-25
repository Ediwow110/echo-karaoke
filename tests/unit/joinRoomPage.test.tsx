import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { createElement } from 'react';
import JoinRoomPage from '../../src/app/JoinRoomPage';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import { RoomApiError } from '../../src/lib/edgeApi';
import { loadGuestToken } from '../../src/features/rooms/tokenStore';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const api: EdgeApi = { invoke: (async () => ({})) as unknown as EdgeApi['invoke'] };

function renderJoin(code = 'ABCDEFGHJKMNPQRS', roomApi: EdgeApi = api) {
  const path = code.length > 0 ? '/join/' + code : '/join';
  return render(
    createElement(RoomApiProvider, {
      api: roomApi,
      children: createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement('div', null,
          createElement(Link, { to: '/join/Z0HHP1YRRQ2QS212' }, 'Open another invite'),
          createElement(Routes, { children: [
            createElement(Route, { key: 'home', path: '/', element: createElement('h1', null, 'Home screen') }),
            createElement(Route, { key: 'join', path: '/join', element: createElement(JoinRoomPage) }),
            createElement(Route, { key: 'code', path: '/join/:roomCode', element: createElement(JoinRoomPage) }),
            createElement(Route, { key: 'joined', path: '/room/:roomId', element: createElement('h1', null, 'Guest room loaded') }),
          ] }),
        ),
      ),
    }),
  );
}

describe('join screen', () => {
  it('starts the name blank when an earlier visit left a name behind', () => {
    localStorage.setItem('karaoke.profile.name', 'Qoder');
    renderJoin();
    expect(screen.getByLabelText('Your name')).toHaveValue('');
    expect(screen.queryByText('Qoder')).toBeNull();
  });

  it('ignores the older room response after navigating from invitation A to B', async () => {
    const oldRoomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';
    const newRoomId = '550e8400-e29b-41d4-a716-446655440000';
    const deferred: Array<(value: unknown) => void> = [];
    const roomApi: EdgeApi = {
      invoke: (() => new Promise<unknown>((resolve) => { deferred.push(resolve); })) as EdgeApi['invoke'],
    };
    renderJoin('ABCDEFGHJKMNPQRS', roomApi);
    fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    expect(deferred).toHaveLength(1);
    fireEvent.click(screen.getByRole('link', { name: 'Open another invite' }));
    expect(screen.getByLabelText('Room code')).toHaveValue('Z0HHP1YRRQ2QS212');
    fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    expect(deferred).toHaveLength(2);
    await act(async () => {
      deferred[0]({
        roomId: oldRoomId, roomCode: 'ABCDEFGHJKMNPQRS', roomName: 'Old room',
        memberId: 'old-member', displayName: 'Guest', role: 'guest', guestToken: 'old-pass',
      });
    });
    expect(screen.getByLabelText('Room code')).toHaveValue('Z0HHP1YRRQ2QS212');
    expect(loadGuestToken(oldRoomId)).toBeNull();
    await act(async () => {
      deferred[1]({
        roomId: newRoomId, roomCode: 'Z0HHP1YRRQ2QS212', roomName: 'New room',
        memberId: 'new-member', displayName: 'Guest', role: 'guest', guestToken: 'new-pass',
      });
    });
    expect(screen.getByRole('heading', { name: 'Guest room loaded' })).toBeInTheDocument();
    expect(loadGuestToken(newRoomId)).toBe('new-pass');
    expect(loadGuestToken(oldRoomId)).toBeNull();
  });
  it('keeps the join form and reports a safe error for an incomplete successful HTTP response', async () => {
    const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';
    const roomApi: EdgeApi = { invoke: (async () => ({
      roomId, roomCode: 'ABCDEFGHJKMNPQRS', roomName: 'Songs',
      memberId: 'member-1', displayName: 'Jamie', role: 'guest',
      // A missing guestToken must never be persisted or used for navigation.
    })) as EdgeApi['invoke'] };
    renderJoin('ABCDEFGHJKMNPQRS', roomApi);
    fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not verify this room|invalid room response/i);
    expect(screen.getByRole('heading', { name: 'Join the room.' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Guest room loaded' })).not.toBeInTheDocument();
    expect(loadGuestToken(roomId)).toBeNull();
  });
  it('does not resurrect a previous room or retain its pass after leaving a pending join', async () => {
    const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';
    let finish: ((value: unknown) => void) | null = null;
    const roomApi: EdgeApi = {
      invoke: (() => new Promise<unknown>((resolve) => { finish = resolve; })) as EdgeApi['invoke'],
    };
    renderJoin('ABCDEFGHJKMNPQRS', roomApi);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Jamie' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    expect(finish).not.toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Home screen' })).toBeInTheDocument();
    await act(async () => {
      finish?.({
        roomId, roomCode: 'ABCDEFGHJKMNPQRS', roomName: 'Room A',
        memberId: 'guest-1', displayName: 'Jamie', role: 'guest',
        guestToken: 'old-request-token',
      });
    });
    expect(screen.getByRole('heading', { name: 'Home screen' })).toBeInTheDocument();
    expect(loadGuestToken(roomId)).toBeNull();
  });

  it('submits the guest join request at most once while the first request is pending', async () => {
    let requests = 0;
    const roomApi: EdgeApi = {
      invoke: (() => {
        requests += 1;
        return new Promise(() => undefined);
      }) as EdgeApi['invoke'],
    };
    renderJoin('ABCDEFGHJKMNPQRS', roomApi);
    const form = screen.getByRole('form', { name: 'Join this room' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(requests).toBe(1);
    expect(screen.getByRole('button', { name: 'Join room' })).toBeDisabled();
  });

  it('ignores a late join for the old code after the user corrects the invitation', async () => {
    const oldRoomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';
    let finishOld: ((value: unknown) => void) | null = null;
    const roomApi: EdgeApi = {
      invoke: (() => new Promise<unknown>((resolve) => { finishOld = resolve; })) as EdgeApi['invoke'],
    };
    renderJoin('ABCDEFGHJKMNPQRS', roomApi);
    fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    fireEvent.change(screen.getByLabelText('Room code'), { target: { value: 'Z0HHP1YRRQ2QS212' } });
    await act(async () => {
      finishOld?.({
        roomId: oldRoomId, roomCode: 'ABCDEFGHJKMNPQRS', roomName: 'Old room',
        memberId: 'member-old', displayName: 'Jamie', role: 'guest',
        guestToken: 'old-room-pass',
      });
    });
    expect(screen.getByRole('heading', { name: 'Join the room.' })).toBeInTheDocument();
    expect(screen.getByLabelText('Room code')).toHaveValue('Z0HHP1YRRQ2QS212');
    expect(loadGuestToken(oldRoomId)).toBeNull();
  });
  it('shows ended-room errors and never stores a guest pass or navigates', async () => {
    const roomApi: EdgeApi = {
      invoke: (async () => {
        throw new RoomApiError('ROOM_ENDED', 409, 'This room has ended');
      }) as EdgeApi['invoke'],
    };
    renderJoin('ABCDEFGHJKMNPQRS', roomApi);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Jamie' } });
    fireEvent.click(screen.getByRole('button', { name: /join room/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This room has ended');
    expect(screen.getByRole('heading', { name: 'Join the room.' })).toBeInTheDocument();
    expect(loadGuestToken('3a1ee27f-a539-4190-9250-bdc14ff631e0')).toBeNull();
  });

  it('navigates only after confirmed join and stores the returned scoped guest pass', async () => {
    const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';
    const submitted: unknown[] = [];
    const roomApi: EdgeApi = {
      invoke: (async (_name: string, body: unknown) => {
        submitted.push(body);
        return {
          roomId,
          roomCode: 'ABCDEFGHJKMNPQRS',
          roomName: 'Evening singalong',
          memberId: 'member-1',
          displayName: 'Jamie',
          role: 'guest',
          guestToken: 'test-guest-pass',
        };
      }) as EdgeApi['invoke'],
    };
    renderJoin('ABCDEFGHJKMNPQRS', roomApi);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Jamie' } });
    fireEvent.click(screen.getByRole('button', { name: /join room/i }));
    expect(await screen.findByRole('heading', { name: 'Guest room loaded' })).toBeInTheDocument();
    await waitFor(() => expect(loadGuestToken(roomId)).toBe('test-guest-pass'));
    expect(submitted).toEqual([{ code: 'ABCDEFGHJKMNPQRS', displayName: 'Jamie' }]);
  });
  it('names the room the guest is joining', () => {
    renderJoin();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/join the room/i);
    expect(screen.getByLabelText(/room code/i)).toHaveValue('ABCDEFGHJKMNPQRS');
  });

  it('asks for the guest name and offers the join action', () => {
    renderJoin();
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join room/i })).toBeInTheDocument();
  });

  it('keeps the room code editable for a code typed by hand', () => {
    renderJoin('');
    expect(screen.getByLabelText(/room code/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /join room/i })).toBeDisabled();
  });
});
