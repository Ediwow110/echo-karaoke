import { operationCall, serviceDatabase } from '../db/client.js';
import { HttpError, jsonResponse, mapDatabaseError } from './errors.js';
import { readJsonObject } from './tokens.js';
import { callOperation, requireRoomId, type Caller } from './room.js';
import { requireRoomAccess } from './catalogAccess.js';

// Mirrors the clamps inside karaoke_catalog_page. Number.isInteger accepts 1e15,
// but Postgres rejects it as an integer out of range, so a wildly paging client
// got a 500 instead of a page.
export const MAX_OFFSET = 5000;
export const MAX_LIMIT = 50;

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export async function catalogPage(request: Request, caller: Caller): Promise<Response> {
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  await requireRoomAccess(request, caller, roomId);

  const query = typeof body.query === 'string' ? body.query.slice(0, 80) : '';
  const channel = typeof body.channel === 'string' ? body.channel.slice(0, 80) : '';
  const offset = boundedInteger(body.offset, 0, 0, MAX_OFFSET);
  const limit = boundedInteger(body.limit, 30, 1, MAX_LIMIT);

  // The page scan is an unindexable LIKE over the whole catalog, so the shared
  // session ceiling alone lets one member turn the songbook into a database
  // heater. Charge a per-member window after the cheap checks.
  const allowance = await callOperation('consume_rate_limit', [
    caller.userId,
    'catalog-page',
    60,
    60,
  ]) as { allowed?: boolean };
  if (allowance.allowed !== true) {
    throw new HttpError('RATE_LIMITED', 429, 'The songbook is busy. Try again in a moment.');
  }

  try {
    const call = operationCall('karaoke_catalog_page', [query, channel, offset, limit]);
    const rows = await serviceDatabase().query(call.text, call.params);
    const result = (rows[0] as { result?: unknown } | undefined)?.result;
    if (result === undefined || result === null) {
      throw new HttpError('INTERNAL_ERROR', 500, 'The songbook returned no result');
    }
    return jsonResponse(result);
  } catch (error) {
    // Raising above was remapped by the handler below, so the specific reason
    // never reached the client or the log.
    if (error instanceof HttpError) throw error;
    throw mapDatabaseError(error as { message?: string });
  }
}
