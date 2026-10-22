import type { EdgeApi } from '../../lib/edgeApi';
import { normalizeDisplayName } from './displayName';
import { normalizeRoomCode } from './roomCode';
import { loadGuestToken, loadHostToken, saveGuestToken, saveHostToken } from './tokenStore';

export type CreatedRoom = {
  roomId: string;
  roomCode: string;
  roomName: string;
  memberId: string;
  displayName: string;
  role: string;
  guestToken: string;
  hostToken: string;
};

export type JoinedRoom = {
  roomId: string;
  roomCode: string;
  roomName: string;
  memberId: string;
  displayName: string;
  role: string;
  guestToken: string;
};

export type RoomDeps = {
  api: EdgeApi;
  randomGuestNumber?: () => number;
};

export type CreateRoomOptions = {
  roomName?: string;
  guestsCanAdd?: boolean;
  guestsCanControlPlayback?: boolean;
};

export async function createRoom(
  deps: RoomDeps,
  displayName: string,
  options: CreateRoomOptions = {},
): Promise<CreatedRoom> {
  const normalized = normalizeDisplayName(displayName, deps.randomGuestNumber?.());
  const created = await deps.api.invoke<CreatedRoom>('create-room', {
    displayName: normalized,
    roomName: options.roomName ?? '',
    guestsCanAdd: options.guestsCanAdd ?? true,
    guestsCanControlPlayback: options.guestsCanControlPlayback ?? false,
  });

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
  if (role === 'host') {
    const hostToken = loadHostToken(roomId);
    if (hostToken === null) {
      return;
    }
    try {
      await api.invoke('touch-member', { roomId }, { hostToken });
    } catch {
      // A heartbeat is best effort; the read that follows reports real failures.
    }
    return;
  }

  const guestToken = loadGuestToken(roomId);
  if (guestToken === null) {
    return;
  }
  try {
    await api.invoke('touch-member', { roomId }, { guestToken });
  } catch {
    // A heartbeat is best effort; the read that follows reports real failures.
  }
}

export type HostAction =
  | 'end'
  | 'lock'
  | 'unlock'
  | 'lock_playback'
  | 'unlock_playback'
  | 'clear_queue';

export async function sendHostCommand<T>(
  api: EdgeApi,
  roomId: string,
  action: HostAction,
): Promise<T> {
  const hostToken = loadHostToken(roomId);
  if (hostToken === null) {
    throw new Error('This browser has no host pass for the room.');
  }
  return api.invoke<T>('host-command', { roomId, action }, { hostToken });
}
