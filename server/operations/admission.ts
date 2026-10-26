import { HttpError, jsonResponse } from './errors.js';
import { readJsonObject, readOptionalBoolean } from './tokens.js';
import { callOperation, optionalTokenHeader, requireMemberId, requireRoomId, type Caller } from './room.js';
import { requireHostAccess } from './catalogAccess.js';

async function admission(
  request: Request,
  caller: Caller,
  operation: 'room_approve_member' | 'room_reject_member',
): Promise<Response> {
  const hostToken = optionalTokenHeader(request, 'x-room-host-token');
  if (hostToken === null) {
    throw new HttpError('FORBIDDEN', 403, 'Only the host can answer the door');
  }
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  const memberId = requireMemberId(body.memberId);
  await requireHostAccess(caller, roomId, hostToken);

  // callOperation already unwraps the function's jsonb result, throws on an empty
  // one, and maps SQLSTATEs; a denied grant must read as a failure, never a success.
  const result = await callOperation(operation, [roomId, caller.userId, hostToken, memberId]);
  return jsonResponse(result);
}

export function approveMember(request: Request, caller: Caller): Promise<Response> {
  return admission(request, caller, 'room_approve_member');
}

export function rejectMember(request: Request, caller: Caller): Promise<Response> {
  return admission(request, caller, 'room_reject_member');
}

/**
 * The mid-party switch. The value has no default on purpose: a body without a
 * boolean `locked` is a caller mistake, and guessing either way would silently
 * open or close a room the host did not ask about.
 */
export async function setAdmissions(request: Request, caller: Caller): Promise<Response> {
  const hostToken = optionalTokenHeader(request, 'x-room-host-token');
  if (hostToken === null) {
    throw new HttpError('FORBIDDEN', 403, 'Only the host can answer the door');
  }
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  if (body.locked === undefined) {
    throw new HttpError('VALIDATION_ERROR', 400, 'A door setting is required');
  }
  const locked = readOptionalBoolean(body.locked, false);
  await requireHostAccess(caller, roomId, hostToken);

  const result = await callOperation('room_set_admissions', [roomId, caller.userId, hostToken, locked]);
  return jsonResponse(result);
}
