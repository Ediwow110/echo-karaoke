import { HttpError, jsonResponse } from './errors.js';
import { readJsonObject, readOptionalBoolean } from './tokens.js';
import { callOperation, optionalTokenHeader, requireRoomId, type Caller } from './room.js';
import { requireHostAccess } from './catalogAccess.js';

/**
 * The mid-party lock. The value has no default on purpose: a body without a
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
