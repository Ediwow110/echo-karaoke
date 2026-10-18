import type { EdgeApi } from '../../lib/edgeApi';
import { normalizeDisplayName } from './displayName';
import { normalizeRoomCode } from './roomCode';
import { loadGuestToken, loadHostToken, saveGuestToken, saveHostToken } from './tokenStore';

export type CreatedRoom = {
  roomId: string;
  roomCode: string;
  memberId: string;
  displayName: string;
  role: string;
  guestToken: string;
  hostToken: string;
};

export type JoinedRoom = {
  roomId: string;
  memberId: string;
  displayName: string;
  role: string;
  guestToken: string;
};

export type RoomDeps = {
  api: EdgeApi;
  randomGuestNumber?: () => number;
};

export async function createRoom(
  deps: RoomDeps,
  displayName: string,
): Promise<CreatedRoom> {
  const normalized = normalizeDisplayName(displayName, deps.randomGuestNumber?.());
  const created = await deps.api.invoke<CreatedRoom>('create-room', { displayName: normalized });

  saveGuestToken(created.roomId, created.guestToken);
  saveHostToken(created.roomId, created.hostToken);

  return created;
}

export async function joinRoom(
  deps: RoomDeps,
  code: string,
  displayName: string,
): Promise<JoinedRoom> {
  const normalizedCode = normalizeRoomCode(code);
  const normalized = normalizeDisplayName(displayName, deps.randomGuestNumber?.());

  const joined = await deps.api.invoke<JoinedRoom>('join-room', {
    code: normalizedCode,
    displayName: normalized,
  });

  saveGuestToken(joined.roomId, joined.guestToken);
  return joined;
}

export async function readRoomAsGuest<T>(api: EdgeApi, roomId: string): Promise<T> {
  const guestToken = loadGuestToken(roomId);
  if (guestToken === null) {
    throw new Error('This browser has no guest pass for the room.');
  }
  return api.invoke<T>('guest-room-read', { roomId }, { guestToken });
}

export async function readRoomAsHost<T>(api: EdgeApi, roomId: string): Promise<T> {
  const hostToken = loadHostToken(roomId);
  if (hostToken === null) {
    throw new Error('This browser has no host pass for the room.');
  }
  return api.invoke<T>('host-room-read', { roomId }, { hostToken });
}

export async function touchRoomMember(
  api: EdgeApi,
  roomId: string,
  role: 'guest' | 'host',
): Promise<void> {
  const guestToken = loadGuestToken(roomId);
  if (guestToken === null) {
    return;
  }
  try {
    await api.invoke('touch-member', { roomId }, { guestToken });
  } catch {
    // A heartbeat is best effort; the read that follows reports real failures.
  }
  void role;
}

export async function sendHostCommand<T>(
  api: EdgeApi,
  roomId: string,
  action: 'end' | 'lock' | 'unlock' | 'clear_queue',
): Promise<T> {
  const hostToken = loadHostToken(roomId);
  if (hostToken === null) {
    throw new Error('This browser has no host pass for the room.');
  }
  return api.invoke<T>('host-command', { roomId, action }, { hostToken });
}