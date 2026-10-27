import { operationCall, serviceDatabase } from '../db/client.js';
import { HttpError, jsonResponse, mapDatabaseError, UNAUTHORIZED_MESSAGE } from './errors.js';
import { resolveRoomMemberLimit } from './limits.js';
import { generateToken, normalizeDisplayName, readJsonObject } from './tokens.js';

export type Caller = { userId: string; accessToken: string };

const PLAYBACK_ACTIONS = new Set(['play', 'pause', 'next']);
const HOST_ACTIONS = new Set([
  'end',
  'lock',
  'unlock',
  'lock_playback',
  'unlock_playback',
  'clear_queue',
]);

function normalizeRoomCode(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError('VALIDATION_ERROR', 400, 'A room code is required');
  }
  const code = value.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(code)) {
    throw new HttpError('VALIDATION_ERROR', 400, 'That room code is not valid');
  }
  return code;
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function requireRoomId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new HttpError('VALIDATION_ERROR', 400, 'A room identifier is required');
  }
  return value;
}

export function requireSongId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new HttpError('VALIDATION_ERROR', 400, 'A song identifier is required');
  }
  return value;
}

export function requireMemberId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new HttpError('VALIDATION_ERROR', 400, 'A member identifier is required');
  }
  return value;
}

export function requireTokenHeader(request: Request, name: string): string {
  const value = request.headers.get(name);
  if (value === null || value.trim().length < 32) {
    throw new HttpError('UNAUTHORIZED', 401, UNAUTHORIZED_MESSAGE);
  }
  return value.trim();
}

export function optionalTokenHeader(request: Request, name: string): string | null {
  const value = request.headers.get(name);
  return value !== null && value.trim().length >= 32 ? value.trim() : null;
}

export async function callOperation(name: string, params: unknown[]): Promise<unknown> {
  const call = operationCall(name, params);
  try {
    const rows = await serviceDatabase().query(call.text, call.params);
    const result = (rows[0] as { result?: unknown } | undefined)?.result;
    if (result === undefined || result === null) {
      throw new HttpError('INTERNAL_ERROR', 500, 'The operation returned no result');
    }
    return result;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw mapDatabaseError(error as { message?: string });
  }
}

export async function joinRoom(request: Request, caller: Caller): Promise<Response> {
  const body = await readJsonObject(request);
  const code = normalizeRoomCode(body.code);
  const displayName = normalizeDisplayName(body.displayName);
  const guestToken = generateToken();
  const result = await callOperation('join_room', [
    code,
    caller.userId,
    displayName,
    guestToken,
    resolveRoomMemberLimit(),
  ]);
  return jsonResponse(result);
}

export async function readRoomGuest(request: Request, caller: Caller): Promise<Response> {
  const guestToken = requireTokenHeader(request, 'x-room-guest-token');
  const body = await readJsonObject(request);
  const result = await callOperation('read_room_guest', [
    requireRoomId(body.roomId),
    caller.userId,
    guestToken,
  ]);
  return jsonResponse(result);
}

export async function readRoomHost(request: Request, caller: Caller): Promise<Response> {
  const hostToken = requireTokenHeader(request, 'x-room-host-token');
  const body = await readJsonObject(request);
  const result = await callOperation('read_room_host', [
    requireRoomId(body.roomId),
    caller.userId,
    hostToken,
  ]);
  return jsonResponse(result);
}

export async function touchMember(request: Request, caller: Caller): Promise<Response> {
  const hostToken = optionalTokenHeader(request, 'x-room-host-token');
  const guestToken = optionalTokenHeader(request, 'x-room-guest-token');
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);

  if (hostToken !== null) {
    return jsonResponse(await callOperation('touch_host', [roomId, hostToken]));
  }
  if (guestToken === null) {
    throw new HttpError('UNAUTHORIZED', 401, UNAUTHORIZED_MESSAGE);
  }
  return jsonResponse(await callOperation('touch_member', [
    roomId,
    caller.userId,
    guestToken,
  ]));
}

export async function voteCommand(request: Request, caller: Caller): Promise<Response> {
  // Either pass identifies the voter: the guest one for a phone, the host one for
  // a host tab, whose anonymous identity can be replaced while its host pass lives.
  const hostToken = optionalTokenHeader(request, 'x-room-host-token');
  const guestToken = optionalTokenHeader(request, 'x-room-guest-token');
  if (hostToken === null && guestToken === null) {
    throw new HttpError('UNAUTHORIZED', 401, UNAUTHORIZED_MESSAGE);
  }
  const body = await readJsonObject(request);
  const limit = await callOperation('consume_rate_limit', [
    caller.userId,
    'vote',
    30,
    60,
  ]) as { allowed?: boolean };
  if (limit.allowed !== true) {
    throw new HttpError('RATE_LIMITED', 429, 'Too many votes. Give it a moment.');
  }
  const result = await callOperation('vote_toggle', [
    requireRoomId(body.roomId),
    caller.userId,
    guestToken,
    hostToken,
    requireSongId(body.songId),
  ]);
  return jsonResponse(result);
}

export async function playbackCommand(request: Request, caller: Caller): Promise<Response> {
  const guestToken = optionalTokenHeader(request, 'x-room-guest-token');
  const hostToken = optionalTokenHeader(request, 'x-room-host-token');
  if (guestToken === null && hostToken === null) {
    throw new HttpError('UNAUTHORIZED', 401, UNAUTHORIZED_MESSAGE);
  }

  const body = await readJsonObject(request);
  const action = body.action;
  if (typeof action !== 'string' || !PLAYBACK_ACTIONS.has(action)) {
    throw new HttpError('VALIDATION_ERROR', 400, 'That playback action is not supported');
  }

  // Automatic advances are scoped to a song, unlike deliberate host skips.
  // The database rechecks the song under the room lock before advancing.
  if (body.expectedSongId !== undefined) {
    if (action !== 'next' || hostToken === null) {
      throw new HttpError('FORBIDDEN', 403, 'Only the host can auto-advance a song');
    }
    const result = await callOperation('playback_next_if_current', [
      requireRoomId(body.roomId),
      caller.userId,
      hostToken,
      requireSongId(body.expectedSongId),
    ]);
    return jsonResponse(result);
  }

  const result = await callOperation('playback_command', [
    requireRoomId(body.roomId),
    caller.userId,
    guestToken,
    hostToken,
    action,
  ]);
  return jsonResponse(result);
}

export async function playbackReport(request: Request, caller: Caller): Promise<Response> {
  const hostToken = requireTokenHeader(request, 'x-room-host-token');
  const body = await readJsonObject(request);
  const position = body.positionSeconds;
  const duration = body.durationSeconds;
  const songId = body.songId;

  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > 86400) {
    throw new HttpError('VALIDATION_ERROR', 400, 'A playback position is required');
  }
  if (duration !== undefined && duration !== null) {
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 || duration > 86400) {
      throw new HttpError('VALIDATION_ERROR', 400, 'A playback duration is invalid');
    }
  }
  if (songId !== undefined && songId !== null
    && (typeof songId !== 'string' || !UUID.test(songId))) {
    throw new HttpError('VALIDATION_ERROR', 400, 'The playback song is invalid');
  }

  const result = await callOperation('playback_report', [
    requireRoomId(body.roomId),
    caller.userId,
    hostToken,
    Math.floor(position),
    duration === undefined || duration === null ? null : Math.floor(duration),
    songId ?? null,
  ]);
  return jsonResponse(result);
}

export async function hostCommand(request: Request, caller: Caller): Promise<Response> {
  const hostToken = requireTokenHeader(request, 'x-room-host-token');
  const body = await readJsonObject(request);
  const action = body.action;
  if (typeof action !== 'string' || !HOST_ACTIONS.has(action)) {
    throw new HttpError('VALIDATION_ERROR', 400, 'That host action is not supported');
  }

  const result = await callOperation('host_command', [
    requireRoomId(body.roomId),
    caller.userId,
    hostToken,
    action,
  ]);
  return jsonResponse(result);
}

export async function removeRoomMember(request: Request, caller: Caller): Promise<Response> {
  const hostToken = requireTokenHeader(request, 'x-room-host-token');
  const body = await readJsonObject(request);
  const result = await callOperation('host_remove_member', [
    requireRoomId(body.roomId),
    caller.userId,
    hostToken,
    requireMemberId(body.memberId),
  ]);
  return jsonResponse(result);
}
