import { beforeEach, describe, expect, it } from 'vitest';
import type { EdgeApi } from '../../src/lib/edgeApi';
import {
  claimHostPass,
  createRoom,
  joinRoom,
  readRoomAsGuest,
  readRoomAsHost,
  sendHostCommand,
  transferRoomTo,
} from '../../src/features/rooms/roomApi';
import {
  clearGuestToken,
  clearRoomTokens,
  loadGuestToken,
  loadHostToken,
  saveGuestToken,
  saveHostToken,
} from '../../src/features/rooms/tokenStore';

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

describe('handing over a room', () => {
  const roomId = '550e8400-e29b-41d4-a716-446655440000';
  const memberId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';

  beforeEach(() => {
    localStorage.clear();
    clearRoomTokens(roomId);
  });

  it('stores the outgoing host’s new guest pass and drops the host pass', async () => {
    const { api, calls } = fakeApi({
      roomId,
      role: 'guest',
      guestToken: 'g'.repeat(40),
      newHost: { memberId, displayName: 'Rafa' },
    });
    saveHostToken(roomId, 'h'.repeat(40));

    const transferred = await transferRoomTo(api, roomId, memberId);

    expect(calls[0].name).toBe('transfer-host');
    expect(loadHostToken(roomId)).toBeNull();
    expect(loadGuestToken(roomId)).toBe(transferred.guestToken);
  });

  it('keeps the host pass when the transfer answer is unusable', async () => {
    // Verification runs before anything is cleared on purpose: a malformed
    // response must not leave the host demoted with no credentials at all.
    const { api } = fakeApi({
      roomId,
      role: 'guest',
      guestToken: 'short',
      newHost: { memberId, displayName: 'Rafa' },
    });
    saveHostToken(roomId, 'h'.repeat(40));

    await expect(transferRoomTo(api, roomId, memberId)).rejects.toThrow(/could not be transferred/);
    expect(loadHostToken(roomId)).not.toBeNull();
    expect(loadGuestToken(roomId)).toBeNull();
  });

  it('claims the host pass with the guest credential the member already holds', async () => {
    const { api, calls } = fakeApi({ roomId, memberId, hostToken: 'c'.repeat(40) });
    saveGuestToken(roomId, 'g'.repeat(40));

    expect(await claimHostPass(api, roomId)).toBe(true);
    expect(calls[0].tokens).toEqual({ guestToken: 'g'.repeat(40) });
    expect(loadHostToken(roomId)).toBe('c'.repeat(40));
  });

  it('will not claim without a guest pass to prove who is asking', async () => {
    const { api, calls } = fakeApi({ roomId, memberId, hostToken: 'c'.repeat(40) });

    expect(await claimHostPass(api, roomId)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('refuses to store a claim that returned no host pass', async () => {
    const { api } = fakeApi({ roomId, memberId });
    saveGuestToken(roomId, 'g'.repeat(40));

    await expect(claimHostPass(api, roomId)).rejects.toThrow(/could not be claimed/);
    expect(loadHostToken(roomId)).toBeNull();
  });
});

describe('room api', () => {
  beforeEach(() => {
    localStorage.clear();
    // tokenStore deliberately caches passes in memory; clearing browser
    // localStorage alone does not isolate these per-test credentials.
    clearGuestToken('3a1ee27f-a539-4190-9250-bdc14ff631e0');
    clearRoomTokens('550e8400-e29b-41d4-a716-446655440000');
  });

  it('creates a room and stores both room passes', async () => {
    const { api, calls } = fakeApi({
      roomId: '550e8400-e29b-41d4-a716-446655440000',
      roomCode: 'ABCDEFGHJKMNPQRS',
      roomName: 'After Hours',
      memberId: '3a1ee27f-a539-4190-9250-bdc14ff631e0',
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
    expect(created.roomId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(loadGuestToken('550e8400-e29b-41d4-a716-446655440000')).toBe('guest-token-value');
    expect(loadHostToken('550e8400-e29b-41d4-a716-446655440000')).toBe('host-token-value');
  });

  it('supports deferring both host and guest passes until an active screen verifies creation', async () => {
    const { api } = fakeApi({
      roomId: '550e8400-e29b-41d4-a716-446655440000',
      roomCode: 'ABCDEFGHJKMNPQRS',
      roomName: 'After Hours',
      memberId: '3a1ee27f-a539-4190-9250-bdc14ff631e0',
      displayName: 'Alex', role: 'host', guestToken: 'test-guest', hostToken: 'test-host',
    });
    await createRoom({ api }, 'Alex', {}, { storeTokens: false });
    expect(loadGuestToken('550e8400-e29b-41d4-a716-446655440000')).toBeNull();
    expect(loadHostToken('550e8400-e29b-41d4-a716-446655440000')).toBeNull();
  });

  it.each([
    ['missing host pass', { roomId: '550e8400-e29b-41d4-a716-446655440000', roomCode: 'ABCDEFGHJKMNPQRS', roomName: 'After Hours', memberId: 'member-1', displayName: 'Alex', role: 'host', guestToken: 'test-guest' }],
    ['incorrect role', { roomId: '550e8400-e29b-41d4-a716-446655440000', roomCode: 'ABCDEFGHJKMNPQRS', roomName: 'After Hours', memberId: 'member-1', displayName: 'Alex', role: 'guest', guestToken: 'test-guest', hostToken: 'test-host' }],
    ['invalid room code', { roomId: '550e8400-e29b-41d4-a716-446655440000', roomCode: 'NO', roomName: 'After Hours', memberId: 'member-1', displayName: 'Alex', role: 'host', guestToken: 'test-guest', hostToken: 'test-host' }],
    ['missing response', null],
  ])('rejects %s before storing any created room credentials', async (_description, result) => {
    const { api } = fakeApi(result);
    await expect(createRoom({ api }, 'Alex')).rejects.toThrow(/verify.*room|invalid.*room/i);
    expect(loadGuestToken('550e8400-e29b-41d4-a716-446655440000')).toBeNull();
    expect(loadHostToken('550e8400-e29b-41d4-a716-446655440000')).toBeNull();
  });

  it('normalizes the room code before joining and stores the guest pass', async () => {
    const { api, calls } = fakeApi({
      roomId: '3a1ee27f-a539-4190-9250-bdc14ff631e0',
      roomCode: 'ABCDEFGHJKMNPQRS',
      roomName: 'Songs',
      memberId: 'member-2',
      displayName: 'Guest 07',
      role: 'guest',
      guestToken: 'guest-2',
    });

    await joinRoom({ api, randomGuestNumber: () => 7 }, ' abcd-efgh jkmn pqrs ', '   ');

    expect(calls[0].body).toEqual({ code: 'ABCDEFGHJKMNPQRS', displayName: 'Guest 07' });
    expect(loadGuestToken('3a1ee27f-a539-4190-9250-bdc14ff631e0')).toBe('guest-2');
    expect(loadHostToken('3a1ee27f-a539-4190-9250-bdc14ff631e0')).toBeNull();
  });

  it('can defer saving the guest pass until the active join screen validates its result', async () => {
    const { api } = fakeApi({
      roomId: '3a1ee27f-a539-4190-9250-bdc14ff631e0', memberId: 'member-1', displayName: 'Jamie',
      roomName: 'Songs', roomCode: 'ABCDEFGHJKMNPQRS', role: 'guest', guestToken: 'deferred-pass',
    });
    await joinRoom({ api }, 'ABCDEFGHJKMNPQRS', 'Jamie', { storeToken: false });
    expect(loadGuestToken('3a1ee27f-a539-4190-9250-bdc14ff631e0')).toBeNull();
  });

  it('carries the waiting status from a moderated join and still stores the pass', async () => {
    const { api } = fakeApi({
      roomId: '3a1ee27f-a539-4190-9250-bdc14ff631e0',
      roomCode: 'ABCDEFGHJKMNPQRS',
      roomName: 'Songs',
      memberId: 'member-2',
      displayName: 'Guest 07',
      role: 'guest',
      guestToken: 'guest-waiting',
      status: 'waiting',
    });

    const joined = await joinRoom({ api }, 'ABCDEFGHJKMNPQRS', 'Guest 07');

    expect(joined.status).toBe('waiting');
    expect(loadGuestToken('3a1ee27f-a539-4190-9250-bdc14ff631e0')).toBe('guest-waiting');
  });

  it('leaves an older server\'s join response without a status field', async () => {
    const { api } = fakeApi({
      roomId: '3a1ee27f-a539-4190-9250-bdc14ff631e0',
      roomCode: 'ABCDEFGHJKMNPQRS',
      roomName: 'Songs',
      memberId: 'member-2',
      displayName: 'Guest 07',
      role: 'guest',
      guestToken: 'guest-2',
    });

    const joined = await joinRoom({ api }, 'ABCDEFGHJKMNPQRS', 'Guest 07');

    expect('status' in joined).toBe(false);
    expect(joined.status).toBeUndefined();
  });

  it('does not invent a join status it does not recognize', async () => {
    const { api } = fakeApi({
      roomId: '3a1ee27f-a539-4190-9250-bdc14ff631e0',
      roomCode: 'ABCDEFGHJKMNPQRS',
      roomName: 'Songs',
      memberId: 'member-2',
      displayName: 'Guest 07',
      role: 'guest',
      guestToken: 'guest-2',
      status: 'pending',
    });

    const joined = await joinRoom({ api }, 'ABCDEFGHJKMNPQRS', 'Guest 07');

    expect('status' in joined).toBe(false);
  });

  it.each([
    ['missing response', null],
    ['missing roomId', { roomCode: 'ABCDEFGHJKMNPQRS', roomName: 'Songs', memberId: 'm1', displayName: 'Jamie', role: 'guest', guestToken: 'guest-test' }],
    ['invalid roomId', { roomId: '../bad', roomCode: 'ABCDEFGHJKMNPQRS', roomName: 'Songs', memberId: 'm1', displayName: 'Jamie', role: 'guest', guestToken: 'guest-test' }],
    ['missing memberId', { roomId: '3a1ee27f-a539-4190-9250-bdc14ff631e0', roomCode: 'ABCDEFGHJKMNPQRS', roomName: 'Songs', displayName: 'Jamie', role: 'guest', guestToken: 'guest-test' }],
    ['missing guestToken', { roomId: '3a1ee27f-a539-4190-9250-bdc14ff631e0', roomCode: 'ABCDEFGHJKMNPQRS', roomName: 'Songs', memberId: 'm1', displayName: 'Jamie', role: 'guest' }],
    ['incorrect role', { roomId: '3a1ee27f-a539-4190-9250-bdc14ff631e0', roomCode: 'ABCDEFGHJKMNPQRS', roomName: 'Songs', memberId: 'm1', displayName: 'Jamie', role: 'host', guestToken: 'guest-test' }],
    ['different code', { roomId: '3a1ee27f-a539-4190-9250-bdc14ff631e0', roomCode: 'Z0HHP1YRRQ2QS212', roomName: 'Songs', memberId: 'm1', displayName: 'Jamie', role: 'guest', guestToken: 'guest-test' }],
    ['missing displayName', { roomId: '3a1ee27f-a539-4190-9250-bdc14ff631e0', roomCode: 'ABCDEFGHJKMNPQRS', roomName: 'Songs', memberId: 'm1', role: 'guest', guestToken: 'guest-test' }],
    ['missing roomName', { roomId: '3a1ee27f-a539-4190-9250-bdc14ff631e0', roomCode: 'ABCDEFGHJKMNPQRS', memberId: 'm1', displayName: 'Jamie', role: 'guest', guestToken: 'guest-test' }],
  ])('refuses %s rather than storing an invalid guest response', async (_label, response) => {
    const { api } = fakeApi(response);
    await expect(joinRoom({ api }, 'ABCDEFGHJKMNPQRS', 'Jamie')).rejects.toThrow(/verify.*room|invalid.*room/i);
    expect(loadGuestToken('3a1ee27f-a539-4190-9250-bdc14ff631e0')).toBeNull();
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
