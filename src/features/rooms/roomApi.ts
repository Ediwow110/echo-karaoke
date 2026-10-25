import type { EdgeApi } from '../../lib/edgeApi';
import { normalizeDisplayName } from './displayName';
import { isValidRoomCode, normalizeRoomCode } from './roomCode';
import { clearRoomTokens, loadGuestToken, loadHostToken, saveGuestToken, saveHostToken } from './tokenStore';

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

const ROOM_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** A successful create-room response is not proof that its bearer data is usable. */
function verifyCreatedRoom(value: unknown): CreatedRoom {
  const invalid = (): never => {
    throw new Error('Could not verify the created room. Please check your rooms before trying again.');
  };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const room = value as Record<string, unknown>;
  if (typeof room.roomId !== 'string' || !ROOM_UUID.test(room.roomId)
    || typeof room.roomCode !== 'string' || !isValidRoomCode(room.roomCode)
    || typeof room.roomName !== 'string' || room.roomName.trim().length === 0
    || typeof room.memberId !== 'string' || !ROOM_UUID.test(room.memberId)
    || typeof room.displayName !== 'string' || room.displayName.trim().length === 0
    || room.role !== 'host'
    || typeof room.guestToken !== 'string' || room.guestToken.length === 0
    || typeof room.hostToken !== 'string' || room.hostToken.length === 0) return invalid();
  return {
    roomId: room.roomId,
    roomCode: room.roomCode,
    roomName: room.roomName,
    memberId: room.memberId,
    displayName: room.displayName,
    role: 'host',
    guestToken: room.guestToken,
    hostToken: room.hostToken,
  };
}

/**
 * Treat successful HTTP responses as untrusted until the expected guest
 * identity and requested room code have been verified. Never include a
 * malformed response (which may contain a bearer pass) in error text.
 */
function verifyJoinedRoom(value: unknown, requestedCode: string): JoinedRoom {
  const invalid = (): never => {
    throw new Error('Could not verify this room invitation. Please try again.');
  };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const room = value as Record<string, unknown>;
  if (typeof room.roomId !== 'string' || !ROOM_UUID.test(room.roomId)
    || typeof room.roomCode !== 'string'
    || !isValidRoomCode(normalizeRoomCode(room.roomCode))
    || normalizeRoomCode(room.roomCode) !== requestedCode
    || typeof room.roomName !== 'string'
    || typeof room.memberId !== 'string' || room.memberId.trim().length === 0
    || typeof room.displayName !== 'string' || room.displayName.trim().length === 0
    || room.role !== 'guest'
    || typeof room.guestToken !== 'string' || room.guestToken.length === 0) {
    return invalid();
  }
  return {
    roomId: room.roomId,
    roomCode: requestedCode,
    roomName: room.roomName,
    memberId: room.memberId,
    displayName: room.displayName,
    role: 'guest',
    guestToken: room.guestToken,
  };
}

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
  persist: { storeTokens?: boolean } = {},
): Promise<CreatedRoom> {
  const normalized = normalizeDisplayName(displayName, deps.randomGuestNumber?.());
  const response = await deps.api.invoke<unknown>('create-room', {
    displayName: normalized,
    roomName: options.roomName ?? '',
    guestsCanAdd: options.guestsCanAdd ?? true,
    guestsCanControlPlayback: options.guestsCanControlPlayback ?? false,
  });
  const created = verifyCreatedRoom(response);

  if (persist.storeTokens !== false) {
    saveGuestToken(created.roomId, created.guestToken);
    saveHostToken(created.roomId, created.hostToken);
  }

  return created;
}

export async function joinRoom(
  deps: RoomDeps,
  code: string,
  displayName: string,
  options: { storeToken?: boolean } = {},
): Promise<JoinedRoom> {
  const normalizedCode = normalizeRoomCode(code);
  const normalized = normalizeDisplayName(displayName, deps.randomGuestNumber?.());

  const response = await deps.api.invoke<unknown>('join-room', {
    code: normalizedCode,
    displayName: normalized,
  });
  const joined = verifyJoinedRoom(response, normalizedCode);

  if (options.storeToken !== false) {
    saveGuestToken(joined.roomId, joined.guestToken);
  }
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

export async function removeRoomMember(
  api: EdgeApi,
  roomId: string,
  memberId: string,
): Promise<void> {
  const hostToken = loadHostToken(roomId);
  if (hostToken === null) {
    throw new Error('This browser has no host pass for the room.');
  }
  await api.invoke('host-remove-member', { roomId, memberId }, { hostToken });
}

export type TransferredRoom = {
  roomId: string;
  guestToken: string;
  newHost: { memberId: string; displayName: string };
};

/**
 * Hand the room to a guest. The response is verified rather than cast because it
 * carries a credential that is about to be stored, and a silently missing field
 * would leave this browser demoted with no way back into the room.
 */
function verifyTransfer(value: unknown, roomId: string): TransferredRoom {
  const invalid = (): never => {
    throw new Error('The room could not be transferred. Nothing has changed.');
  };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const room = value as Record<string, unknown>;
  const target = room.newHost as Record<string, unknown> | undefined;
  if (typeof room.roomId !== 'string' || !ROOM_UUID.test(room.roomId) || room.roomId !== roomId
    || typeof room.guestToken !== 'string' || room.guestToken.length < 32
    || room.role !== 'guest'
    || target === undefined || typeof target.memberId !== 'string' || !ROOM_UUID.test(target.memberId)
    || typeof target.displayName !== 'string' || target.displayName.trim().length === 0) {
    return invalid();
  }
  return {
    roomId: room.roomId,
    guestToken: room.guestToken,
    newHost: { memberId: target.memberId, displayName: target.displayName },
  };
}

export async function transferRoomTo(
  api: EdgeApi,
  roomId: string,
  memberId: string,
): Promise<TransferredRoom> {
  const hostToken = loadHostToken(roomId);
  if (hostToken === null) {
    throw new Error('This browser has no host pass for the room.');
  }
  const transferred = verifyTransfer(
    await api.invoke<unknown>('transfer-host', { roomId, memberId }, { hostToken }),
    roomId,
  );
  // The outgoing host never received a guest pass, because they created the room.
  // Storing this one is what keeps them in the room as a guest instead of dropping
  // them out of a room they are still watching.
  clearRoomTokens(roomId);
  saveGuestToken(transferred.roomId, transferred.guestToken);
  return transferred;
}

export async function claimHostPass(api: EdgeApi, roomId: string): Promise<boolean> {
  const guestToken = loadGuestToken(roomId);
  if (guestToken === null) {
    return false;
  }
  const response = await api.invoke<unknown>('claim-host', { roomId }, { guestToken });
  const claim = response as { hostToken?: unknown } | null;
  if (claim === null || typeof claim.hostToken !== 'string' || claim.hostToken.length < 32) {
    throw new Error('The host pass could not be claimed. Try again in a moment.');
  }
  saveHostToken(roomId, claim.hostToken);
  return true;
}
