import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import HomePage from '../../src/app/HomePage';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import { RoomApiError } from '../../src/lib/edgeApi';
import { clearGuestToken, clearRoomTokens, loadGuestToken, loadHostToken } from '../../src/features/rooms/tokenStore';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  clearGuestToken('3a1ee27f-a539-4190-9250-bdc14ff631e0');
  clearRoomTokens('550e8400-e29b-41d4-a716-446655440000');
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
          <Route path="/room/:roomId" element={<p>Guest room</p>} />
          <Route path="/join" element={<p>Join by code</p>} />
        </Routes>
      </MemoryRouter>
    </RoomApiProvider>,
  );
}

describe('create room workspace', () => {
  it('starts the name field empty even when an earlier visit left a name behind', () => {
    // On a TV or a shared laptop the landing screen should not announce whoever
    // last used it. The field you type into begins blank, with the placeholder
    // showing what to write, and the name stays out of the chrome too.
    localStorage.setItem('karaoke.profile.name', 'Qoder');
    stubWide(true);
    renderHome();

    const field = screen.getByLabelText('Your name');
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('placeholder', 'Alex');
    expect(screen.queryByText('Qoder')).toBeNull();
  });

  it('gives the sidebar the name being typed, never one from storage', () => {
    localStorage.setItem('karaoke.profile.name', 'Qoder');
    stubWide(true);
    renderHome();

    expect(screen.getByText('Host', { exact: true })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Rafa' } });
    expect(screen.getByText('Rafa')).toBeInTheDocument();
  });

  it('offers joining by code as an action beside the create button, not as fine print', async () => {
    stubWide(true);
    renderHome();

    expect(screen.queryByRole('link', { name: /have a room code/i })).toBeNull();
    const join = screen.getByRole('button', { name: /have a room code\? join a room/i });
    const create = screen.getByRole('button', { name: 'Create room' });
    expect(create.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(join);
    expect(await screen.findByText('Join by code')).toBeInTheDocument();
  });

  const created = {
    roomId: '550e8400-e29b-41d4-a716-446655440000',
    roomCode: 'ABCDEFGHJKMNPQRS',
    roomName: 'After Hours',
    memberId: '3a1ee27f-a539-4190-9250-bdc14ff631e0',
    displayName: 'Alex',
    role: 'host',
    guestToken: 'create-test-guest-pass',
    hostToken: 'create-test-host-pass',
  };

  it('warns about an uncertain network create and requires deliberate consent before another request', async () => {
    stubWide(true);
    let calls = 0;
    const api: EdgeApi = { invoke: (async () => {
      calls += 1;
      throw new RoomApiError('NETWORK_ERROR', 0, 'The room service could not be reached');
    }) as EdgeApi['invoke'] };
    renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/may have been created/i);
    expect(screen.getByRole('button', { name: 'Create room' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Corrected while uncertain' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Start a room' }));
    expect(calls).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /create another room anyway/i }));
    expect(screen.getByRole('button', { name: 'Create room' })).toBeEnabled();
    expect(calls).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(calls).toBe(2);
  });

  it('retains an uncertain room creation warning across a same-tab page reload', async () => {
    stubWide(true);
    let calls = 0;
    const api: EdgeApi = { invoke: (async () => {
      calls += 1;
      throw new RoomApiError('NETWORK_ERROR', 0, 'Connection lost');
    }) as EdgeApi['invoke'] };
    const first = renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/may have been created/i);
    first.unmount();

    renderHome(api);
    expect(screen.getByRole('alert')).toHaveTextContent(/may have been created/i);
    expect(screen.getByRole('button', { name: 'Create room' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Start a room' }));
    expect(calls).toBe(1);
    expect(screen.getByRole('button', { name: /create another room anyway/i })).toBeInTheDocument();
  });

  it('guards a reloaded tab when room creation was still pending before the reload', () => {
    stubWide(true);
    let calls = 0;
    const api: EdgeApi = { invoke: (() => {
      calls += 1;
      return new Promise(() => undefined);
    }) as EdgeApi['invoke'] };
    const first = renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(calls).toBe(1);
    first.unmount();
    renderHome(api);
    expect(screen.getByRole('alert')).toHaveTextContent(/may have been created/i);
    expect(screen.getByRole('button', { name: 'Create room' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Start a room' }));
    expect(calls).toBe(1);
  });

  it('clears the pending create caution after confirmed successful room creation', async () => {
    stubWide(true);
    const api: EdgeApi = { invoke: (async () => created) as EdgeApi['invoke'] };
    const first = renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByText('Host room')).toBeInTheDocument();
    first.unmount();
    renderHome(api);
    expect(screen.queryByRole('button', { name: /create another room anyway/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create room' })).toBeEnabled();
  });

  it('clears the pending create caution after an explicitly rejected request', async () => {
    stubWide(true);
    const api: EdgeApi = { invoke: (async () => {
      throw new RoomApiError('ROOM_CREATE_RATE_LIMITED', 429, 'Too many room attempts');
    }) as EdgeApi['invoke'] };
    const first = renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many room attempts');
    first.unmount();
    renderHome(api);
    expect(screen.queryByRole('button', { name: /create another room anyway/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create room' })).toBeEnabled();
  });

  it('does not persist host credentials in the tab-local uncertainty marker', async () => {
    stubWide(true);
    const api: EdgeApi = { invoke: (async () => {
      throw new RoomApiError('INTERNAL_ERROR', 503, 'Request timed out');
    }) as EdgeApi['invoke'] };
    renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/may have been created/i);
    const stored = Object.values(sessionStorage).join(' ') + [...Array(sessionStorage.length).keys()]
      .map((i) => sessionStorage.getItem(sessionStorage.key(i) ?? '')).join(' ');
    expect(stored).not.toContain(created.hostToken);
    expect(stored).not.toContain(created.guestToken);
  });

  it('clears the persisted warning only after explicit acknowledgment', async () => {
    stubWide(true);
    const api: EdgeApi = { invoke: (async () => {
      throw new RoomApiError('NETWORK_ERROR', 0, 'Network offline');
    }) as EdgeApi['invoke'] };
    const first = renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/may have been created/i);
    fireEvent.click(screen.getByRole('button', { name: /create another room anyway/i }));
    first.unmount();
    renderHome(api);
    expect(screen.queryByRole('button', { name: /create another room anyway/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create room' })).toBeEnabled();
  });

  it('does not describe an HTTP 5xx room-create response as a known failure', async () => {
    stubWide(true);
    const api: EdgeApi = { invoke: (async () => {
      throw new RoomApiError('INTERNAL_ERROR', 503, 'Temporary service error');
    }) as EdgeApi['invoke'] };
    renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/may have been created/i);
    expect(screen.getByRole('button', { name: 'Create room' })).toBeDisabled();
  });

  it('treats an incomplete HTTP success as uncertain without storing host credentials', async () => {
    stubWide(true);
    const api: EdgeApi = { invoke: (async () => ({
      ...created, hostToken: undefined,
    })) as EdgeApi['invoke'] };
    renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/may have been created/i);
    expect(loadHostToken(created.roomId)).toBeNull();
    expect(loadGuestToken(created.roomId)).toBeNull();
    expect(screen.getByRole('button', { name: 'Create room' })).toBeDisabled();
  });

  it('creates a new room only after explicit acknowledgement of an uncertain result', async () => {
    stubWide(true);
    let calls = 0;
    const api: EdgeApi = { invoke: (async () => {
      calls += 1;
      if (calls === 1) throw new RoomApiError('NETWORK_ERROR', 0, 'Connection interrupted');
      return created;
    }) as EdgeApi['invoke'] };
    renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/may have been created/i);
    expect(calls).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /create another room anyway/i }));
    expect(calls).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByText('Host room')).toBeInTheDocument();
    expect(calls).toBe(2);
    expect(loadHostToken(created.roomId)).toBe(created.hostToken);
  });

  it('keeps the create caution after mobile mode switches until explicitly acknowledged', async () => {
    stubWide(false);
    const api: EdgeApi = { invoke: (async () => {
      throw new RoomApiError('NETWORK_ERROR', 0, 'Network unreachable');
    }) as EdgeApi['invoke'] };
    renderHome(api);
    fireEvent.click(screen.getByRole('button', { name: /hosting tonight/i }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/may have been created/i);
    fireEvent.click(screen.getByRole('button', { name: /joining instead/i }));
    fireEvent.click(screen.getByRole('button', { name: /hosting tonight/i }));
    expect(screen.getByRole('button', { name: 'Create room' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /create another room anyway/i })).toBeInTheDocument();
  });

  it('allows retry of a confirmed rejected create without an ambiguity warning', async () => {
    stubWide(true);
    const api: EdgeApi = { invoke: (async () => {
      throw new RoomApiError('ROOM_CREATE_RATE_LIMITED', 429, 'Too many room attempts');
    }) as EdgeApi['invoke'] };
    renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many room attempts');
    expect(screen.queryByRole('button', { name: /create another room anyway/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create room' })).toBeEnabled();
  });

  it('submits a pending desktop host create exactly once', () => {
    stubWide(true);
    let calls = 0;
    const api: EdgeApi = { invoke: (() => {
      calls += 1;
      return new Promise(() => undefined);
    }) as EdgeApi['invoke'] };
    renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    const form = screen.getByRole('form', { name: 'Start a room' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(calls).toBe(1);
    expect(screen.getByRole('button', { name: 'Create room' })).toBeDisabled();
  });

  it('does not save stale host/guest passes after changing from create to join', async () => {
    stubWide(false);
    let finish: ((response: unknown) => void) | undefined;
    const api: EdgeApi = { invoke: (() => new Promise<unknown>((resolve) => { finish = resolve; })) as EdgeApi['invoke'] };
    renderHome(api);
    fireEvent.click(screen.getByRole('button', { name: /hosting tonight/i }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    fireEvent.click(screen.getByRole('button', { name: /joining instead/i }));
    await act(async () => { finish?.(created); });
    expect(screen.getByRole('heading', { name: /join the room/i })).toBeInTheDocument();
    expect(screen.queryByText('Host room')).not.toBeInTheDocument();
    expect(loadGuestToken(created.roomId)).toBeNull();
    expect(loadHostToken(created.roomId)).toBeNull();
  });

  it('ignores a late create response after the host edits the room name', async () => {
    stubWide(true);
    let finish: ((response: unknown) => void) | undefined;
    const api: EdgeApi = { invoke: (() => new Promise<unknown>((resolve) => { finish = resolve; })) as EdgeApi['invoke'] };
    renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'First name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Corrected name' } });
    await act(async () => { finish?.(created); });
    expect(screen.getByLabelText('Room name')).toHaveValue('Corrected name');
    expect(screen.queryByText('Host room')).not.toBeInTheDocument();
    expect(loadHostToken(created.roomId)).toBeNull();
    expect(loadGuestToken(created.roomId)).toBeNull();
  });

  it('does not start another room creation after an edit while the original request is unresolved', async () => {
    stubWide(true);
    let calls = 0;
    let finish: ((response: unknown) => void) | undefined;
    const api: EdgeApi = { invoke: (() => {
      calls += 1;
      return new Promise<unknown>((resolve) => { finish = resolve; });
    }) as EdgeApi['invoke'] };
    renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Changed during create' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Start a room' }));
    expect(calls).toBe(1);
    await act(async () => { finish?.(created); });
    expect(screen.queryByText('Host room')).not.toBeInTheDocument();
    expect(loadHostToken(created.roomId)).toBeNull();
    expect(screen.getByRole('button', { name: 'Create room' })).toBeEnabled();
  });

  it('ignores a create response after the home screen unmounts', async () => {
    stubWide(true);
    let finish: ((response: unknown) => void) | undefined;
    const api: EdgeApi = { invoke: (() => new Promise<unknown>((resolve) => { finish = resolve; })) as EdgeApi['invoke'] };
    const view = renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    view.unmount();
    await act(async () => { finish?.(created); });
    expect(loadHostToken(created.roomId)).toBeNull();
    expect(loadGuestToken(created.roomId)).toBeNull();
  });

  it('persists both passes and navigates on a current valid host create', async () => {
    stubWide(true);
    const api: EdgeApi = { invoke: (async () => created) as EdgeApi['invoke'] };
    renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByText('Host room')).toBeInTheDocument();
    expect(loadHostToken(created.roomId)).toBe(created.hostToken);
    expect(loadGuestToken(created.roomId)).toBe(created.guestToken);
  });

  it('recovers from a rejected create and permits a safe retry', async () => {
    stubWide(true);
    let requests = 0;
    const api: EdgeApi = { invoke: (async () => {
      requests += 1;
      if (requests === 1) throw new RoomApiError('ROOM_CREATE_RATE_LIMITED', 429, 'Room limit reached');
      return created;
    }) as EdgeApi['invoke'] };
    renderHome(api);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Room limit reached');
    expect(loadHostToken(created.roomId)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByText('Host room')).toBeInTheDocument();
    expect(requests).toBe(2);
  });
  it('leads with the named room and host form', () => {
    stubWide(true);
    renderHome();

    expect(screen.getByRole('heading', { level: 2, name: /good company/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/room name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^create room$/i })).toBeInTheDocument();
  });

  it('states the guest defaults on the create form instead of offering toggles', () => {
    stubWide(true);
    renderHome();

    // The three permission switches moved into room settings; the create form only
    // says what the room will do.
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(/guests can add songs/i)).toBeInTheDocument();
    expect(screen.getByText(/every new guest waits for your approval/i)).toBeInTheDocument();
    expect(screen.getByText(/skip, remove and reorder stay host-only/i)).toBeInTheDocument();
  });

  it('creates a room with approval on and guest playback locked', async () => {
    stubWide(true);
    const calls: Array<{ name: string; body: unknown }> = [];
    const api: EdgeApi = {
      invoke: (async (name: string, body: unknown) => {
        calls.push({ name, body });
        return created;
      }) as unknown as EdgeApi['invoke'],
    };
    renderHome(api);

    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: /^create room$/i }));

    expect(await screen.findByText('Host room')).toBeInTheDocument();
    expect(calls[0]).toMatchObject({
      name: 'create-room',
      body: { requireApproval: true, guestsCanAdd: true, guestsCanControlPlayback: false },
    });
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
          roomId: '550e8400-e29b-41d4-a716-446655440000',
          roomCode: 'ABCDEFGHJKMNPQRS',
          roomName: 'After Hours',
          memberId: '3a1ee27f-a539-4190-9250-bdc14ff631e0',
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
        requireApproval: true,
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
  function enterRoomCode() {
    fireEvent.change(screen.getByLabelText('Room code'), { target: { value: 'ABCDEFGHJKMNPQRS' } });
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Jamie' } });
  }

  const joined = {
    roomId: '3a1ee27f-a539-4190-9250-bdc14ff631e0',
    roomCode: 'ABCDEFGHJKMNPQRS',
    roomName: 'Test room',
    memberId: '550e8400-e29b-41d4-a716-446655440000',
    displayName: 'Jamie',
    role: 'guest',
    guestToken: 'new-guest-pass',
  };

  it('submits at most one guest join request while the first request is pending', () => {
    stubWide(false);
    let calls = 0;
    const api: EdgeApi = { invoke: (() => {
      calls += 1;
      return new Promise(() => undefined);
    }) as EdgeApi['invoke'] };
    renderHome(api);
    enterRoomCode();
    const form = screen.getByRole('form', { name: 'Join a room' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(calls).toBe(1);
    expect(screen.getByRole('button', { name: 'Join room' })).toBeDisabled();
  });

  it('does not persist a stale guest pass or navigate after changing to hosting', async () => {
    stubWide(false);
    let finish: ((value: unknown) => void) | undefined;
    const api: EdgeApi = { invoke: (() => new Promise<unknown>((resolve) => { finish = resolve; })) as EdgeApi['invoke'] };
    renderHome(api);
    enterRoomCode();
    fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    expect(finish).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /hosting tonight/i }));
    await act(async () => { finish?.(joined); });
    expect(screen.getByRole('heading', { name: /make it your room/i })).toBeInTheDocument();
    expect(screen.queryByText('Guest room')).not.toBeInTheDocument();
    expect(loadGuestToken(joined.roomId)).toBeNull();
  });

  it('ignores the previous room response after the user corrects the code', async () => {
    stubWide(false);
    let finish: ((value: unknown) => void) | undefined;
    const api: EdgeApi = { invoke: (() => new Promise<unknown>((resolve) => { finish = resolve; })) as EdgeApi['invoke'] };
    renderHome(api);
    enterRoomCode();
    fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    fireEvent.change(screen.getByLabelText('Room code'), { target: { value: 'Z0HHP1YRRQ2QS212' } });
    await act(async () => { finish?.(joined); });
    expect(screen.getByLabelText('Room code')).toHaveValue('Z0HHP1YRRQ2QS212');
    expect(screen.queryByText('Guest room')).not.toBeInTheDocument();
    expect(loadGuestToken(joined.roomId)).toBeNull();
  });

  it('ignores a pending join if the guest changes their display name', async () => {
    stubWide(false);
    let finish: ((value: unknown) => void) | undefined;
    const api: EdgeApi = { invoke: (() => new Promise<unknown>((resolve) => { finish = resolve; })) as EdgeApi['invoke'] };
    renderHome(api);
    enterRoomCode();
    fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'New name' } });
    await act(async () => { finish?.(joined); });
    expect(screen.getByLabelText('Your name')).toHaveValue('New name');
    expect(screen.queryByText('Guest room')).not.toBeInTheDocument();
    expect(loadGuestToken(joined.roomId)).toBeNull();
  });

  it('stores only the verified guest pass when the active join succeeds', async () => {
    stubWide(false);
    const calls: string[] = [];
    const api: EdgeApi = { invoke: (async (name: string) => {
      calls.push(name);
      return joined;
    }) as EdgeApi['invoke'] };
    renderHome(api);
    enterRoomCode();
    fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    expect(await screen.findByText('Guest room')).toBeInTheDocument();
    expect(calls).toEqual(['join-room']);
    expect(loadGuestToken(joined.roomId)).toBe(joined.guestToken);
  });

  it('does not retain the guest pass if the home page unmounts before a join completes', async () => {
    stubWide(false);
    let finish: ((value: unknown) => void) | undefined;
    const api: EdgeApi = { invoke: (() => new Promise<unknown>((resolve) => { finish = resolve; })) as EdgeApi['invoke'] };
    const view = renderHome(api);
    enterRoomCode();
    fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    view.unmount();
    await act(async () => { finish?.(joined); });
    expect(loadGuestToken(joined.roomId)).toBeNull();
  });

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
