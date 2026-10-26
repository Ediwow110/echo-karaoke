import { HttpError, jsonResponse } from './errors.js';
import { readJsonObject } from './tokens.js';
import { callOperation, requireMemberId, requireRoomId, type Caller } from './room.js';
import { requireHostAccess } from './catalogAccess.js';

async function admission(
  request: Request,
  caller: Caller,
  operation: 'room_approve_member' | 'room_reject_member',
): Promise<Response> {
  const hostToken = request.headers.get('x-room-host-token');
  if (hostToken === null || hostToken.length === 0) {
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
