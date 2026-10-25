import { operationCall, serviceDatabase } from '../db/client.js';
import { HttpError, jsonResponse, mapDatabaseError } from './errors.js';
import { readJsonObject } from './tokens.js';
import { requireRoomId, type Caller } from './room.js';
import { requireRoomAccess } from './catalogAccess.js';

export async function catalogPage(request: Request, caller: Caller): Promise<Response> {
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  await requireRoomAccess(request, caller, roomId);

  const query = typeof body.query === 'string' ? body.query.slice(0, 80) : '';
  const channel = typeof body.channel === 'string' ? body.channel.slice(0, 80) : '';
  const offset = Number.isInteger(body.offset) ? (body.offset as number) : 0;
  const limit = Number.isInteger(body.limit) ? (body.limit as number) : 30;

  try {
    const call = operationCall('karaoke_catalog_page', [query, channel, offset, limit]);
    const rows = await serviceDatabase().query(call.text, call.params);
    const result = (rows[0] as { result?: unknown } | undefined)?.result;
    if (result === undefined || result === null) {
      throw new HttpError('INTERNAL_ERROR', 500, 'The songbook returned no result');
    }
    return jsonResponse(result);
  } catch (error) {
    throw mapDatabaseError(error as { message?: string });
  }
}
