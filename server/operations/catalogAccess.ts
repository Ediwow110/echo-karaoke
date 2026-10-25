import { HttpError, mapDatabaseError, UNAUTHORIZED_MESSAGE } from './errors.js';
import { operationCall, serviceDatabase } from '../db/client.js';
import { optionalTokenHeader, type Caller } from './room.js';

async function check(name: string, params: unknown[]): Promise<{ status?: string } | null> {
  const call = operationCall(name, params);
  try {
    const rows = await serviceDatabase().query(call.text, call.params);
    return (rows[0] as { result?: { status?: string } } | undefined)?.result ?? null;
  } catch (error) {
    // The access functions raise UNAUTHORIZED instead of returning empty; map
    // it to the 401 the guards used to produce before they were shared.
    throw mapDatabaseError(error as { message?: string });
  }
}

export async function requireHostAccess(caller: Caller, roomId: string, hostToken: string): Promise<void> {
  const access = await check('host_access_check', [roomId, caller.userId, hostToken]);
  if (access === null) throw new HttpError('UNAUTHORIZED', 401, UNAUTHORIZED_MESSAGE);
  if (access.status === 'ended') throw new HttpError('ROOM_ENDED', 409, 'This room has ended');
}

export async function requireRoomAccess(request: Request, caller: Caller, roomId: string): Promise<string> {
  const guestToken = optionalTokenHeader(request, 'x-room-guest-token');
  const hostToken = optionalTokenHeader(request, 'x-room-host-token');
  if (guestToken !== null) {
    const access = await check('room_access_check', [roomId, caller.userId, guestToken]);
    if (access === null) throw new HttpError('UNAUTHORIZED', 401, UNAUTHORIZED_MESSAGE);
    if (access.status === 'ended') throw new HttpError('ROOM_ENDED', 409, 'This room has ended');
    return guestToken;
  }
  if (hostToken !== null) {
    const access = await check('host_access_check', [roomId, caller.userId, hostToken]);
    if (access === null) throw new HttpError('UNAUTHORIZED', 401, UNAUTHORIZED_MESSAGE);
    if (access.status === 'ended') throw new HttpError('ROOM_ENDED', 409, 'This room has ended');
    return hostToken;
  }
  throw new HttpError('UNAUTHORIZED', 401, UNAUTHORIZED_MESSAGE);
}
