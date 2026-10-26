import { operationCall, serviceDatabase } from '../db/client.js';
import { HttpError, jsonResponse, logFailure, mapDatabaseError } from './errors.js';
import { sweepAbandonedRooms, sweepEndedRooms } from './sweep.js';
import {
  generateRoomCode,
  generateToken,
  normalizeDisplayName,
  normalizeRoomName,
  readJsonObject,
  readOptionalBoolean,
} from './tokens.js';

type Caller = { userId: string; accessToken: string };

export async function createRoom(request: Request, caller: Caller): Promise<Response> {
  const body = await readJsonObject(request);
  const displayName = normalizeDisplayName(body.displayName);
  const roomName = normalizeRoomName(body.roomName);
  const guestsCanAdd = readOptionalBoolean(body.guestsCanAdd, true);
  const guestsCanControlPlayback = readOptionalBoolean(body.guestsCanControlPlayback, false);
  const requireApproval = readOptionalBoolean(body.requireApproval, false);
  const sweeps = await Promise.allSettled([sweepAbandonedRooms(), sweepEndedRooms()]);
  for (const sweep of sweeps) {
    if (sweep.status === 'rejected') {
      logFailure('create-room/sweep', sweep.reason, 500, request);
    }
  }
  const database = serviceDatabase();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const guestToken = generateToken();
    const hostToken = generateToken();
    const call = operationCall('create_room', [
      generateRoomCode(),
      caller.userId,
      displayName,
      guestToken,
      hostToken,
      roomName,
      !guestsCanAdd,
      !guestsCanControlPlayback,
      requireApproval,
    ]);

    try {
      const rows = await database.query(call.text, call.params);
      const result = (rows[0] as { result?: unknown } | undefined)?.result;
      if (result === undefined || result === null) {
        throw new HttpError('INTERNAL_ERROR', 500, 'The room could not be created');
      }
      return jsonResponse(result, 201);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        continue;
      }
      throw mapDatabaseError(error as { message?: string });
    }
  }

  throw new HttpError('ROOM_CODE_UNAVAILABLE', 503, 'A room code could not be allocated');
}
