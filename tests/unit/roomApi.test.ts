import { beforeEach, describe, expect, it } from 'vitest';
import type { EdgeApi } from '../../src/lib/edgeApi';
import {
  createRoom,
  joinRoom,
  readRoomAsGuest,
  readRoomAsHost,
  sendHostCommand,
} from '../../src/features/rooms/roomApi';
import { loadGuestToken, loadHostToken } from '../../src/features/rooms/tokenStore';

type Invocation = { name: string; body: unknown; tokens: unknown };

function fakeApi(result: unknown = {}): { api: EdgeApi; calls: Invocation[] } {
  const calls: Invocation[] = [];
  const api: EdgeApi = {
    invoke: (async (name: string, body: unknown, tokens: unknown) => {
      calls.push({ name, body, tokens });
      return result;
    }) as unknown as EdgeApi['invoke'],
  };
  return { api, calls };
}

describe('room api', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates a room and stores both room passes', async () => {
    const { api, calls } = fakeApi({
      roomId: 'room-1',
      roomCode: 'ABCDEFGHJKMNPQRS',
      roomName: 'After Hours',
      memberId: 'member-1',
      displayName: 'Ana',
      role: 'host',
      guestToken: 'guest-token-value',
      hostToken: 'host-token-value',
    });

    const created = await createRoom({ api, randomGuestNumber: () => 3 }, '  Ana  ', {
      roomName: 'After Hours',
      guestsCanAdd: false,
      guestsCanControlPlayback: true,
    });

    expect(calls[0].name).toBe('create-room');
    expect(calls[0].body).toEqual({
      displayName: 'Ana',
      roomName: 'After Hours',
      guestsCanAdd: false,
      guestsCanControlPlayback: true,
    });
    expect(created.roomId).toBe('room-1');
    expect(loadGuestToken('room-1')).toBe('guest-token-value');
    expect(loadHostToken('room-1')).toBe('host-token-value');
  });

  it('normalizes the room code before joining and stores the guest pass', async () => {
    const { api, calls } = fakeApi({
      roomId: 'room-2',
      memberId: 'member-2',
      displayName: 'Guest 07',
      role: 'guest',
      guestToken: 'guest-2',
    });

    await joinRoom({ api, randomGuestNumber: () => 7 }, ' abcd-efgh jkmn pqrs ', '   ');

    expect(calls[0].body).toEqual({ code: 'ABCDEFGHJKMNPQRS', displayName: 'Guest 07' });
    expect(loadGuestToken('room-2')).toBe('guest-2');
    expect(loadHostToken('room-2')).toBeNull();
  });

  it('sends the stored guest pass and refuses to guess one', async () => {
    const { api, calls } = fakeApi({ status: 'live' });

    await expect(readRoomAsGuest(api, 'room-3')).rejects.toThrow(/guest pass/i);
    expect(calls).toHaveLength(0);

    localStorage.setItem('karaoke.guest.room-3', 'stored-guest');
    await readRoomAsGuest(api, 'room-3');

    expect(calls[0]).toMatchObject({
      name: 'guest-room-read',
      body: { roomId: 'room-3' },
      tokens: { guestToken: 'stored-guest' },
    });
  });

  it('sends the stored host pass and refuses to guess one', async () => {
    const { api, calls } = fakeApi({ status: 'live' });

    await expect(readRoomAsHost(api, 'room-4')).rejects.toThrow(/host pass/i);
    expect(calls).toHaveLength(0);

    localStorage.setItem('karaoke.host.room-4', 'stored-host');
    await readRoomAsHost(api, 'room-4');

    expect(calls[0]).toMatchObject({
      name: 'host-room-read',
      tokens: { hostToken: 'stored-host' },
    });
  });

  it('sends host commands only with a host pass', async () => {
    const { api, calls } = fakeApi({ status: 'ended' });

    localStorage.setItem('karaoke.host.room-5', 'stored-host');
    await sendHostCommand(api, 'room-5', 'end');

    expect(calls[0]).toMatchObject({
      name: 'host-command',
      body: { roomId: 'room-5', action: 'end' },
      tokens: { hostToken: 'stored-host' },
    });
  });

  it('does not leak tokens into thrown errors', async () => {
    const api: EdgeApi = {
      invoke: (async () => {
        throw new Error('boom');
      }) as unknown as EdgeApi['invoke'],
    };
    localStorage.setItem('karaoke.guest.room-6', 'secret-guest-value');

    await expect(readRoomAsGuest(api, 'room-6')).rejects.toThrow(/boom/);
    try {
      await readRoomAsGuest(api, 'room-6');
    } catch (error) {
      expect(String(error)).not.toContain('secret-guest-value');
    }
  });
});
