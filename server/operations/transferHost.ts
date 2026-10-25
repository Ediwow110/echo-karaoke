import { operationCall, serviceDatabase } from '../db/client.js';
import { HttpError, jsonResponse, mapDatabaseError, UNAUTHORIZED_MESSAGE } from './errors.js';
import { generateToken, readJsonObject } from './tokens.js';
import { optionalTokenHeader, requireMemberId, requireRoomId, type Caller } from './room.js';
import { requireHostAccess } from './catalogAccess.js';

// Host authority is a single shared secret stored only as a digest, so the
// database cannot reveal it later and the plaintext can only ever be returned to
// whoever minted it. That is why handing a room over is two calls: the outgoing
// host revokes their own secret, and the promoted member mints a replacement on
// their own device with the guest pass they already hold.

async function transfer(name: string, params: unknown[], failure: string): Promise<Record<string, unknown>> {
  const call = operationCall(name, params);
  try {
    const rows = await serviceDatabase().query(call.text, call.params);
    const result = (rows[0] as { result?: unknown } | undefined)?.result;
    if (result === undefined || result === null || typeof result !== 'object') {
      throw new HttpError('INTERNAL_ERROR', 500, failure);
    }
    return result as Record<string, unknown>;
  } catch (error) {
    // A denied or missing grant must reach the host as a failure, not as an
    // empty success they would read as "nothing happened".
    if (error instanceof HttpError) throw error;
    throw mapDatabaseError(error as { message?: string });
  }
}

export async function transferHost(request: Request, caller: Caller): Promise<Response> {
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  const hostToken = optionalTokenHeader(request, 'x-room-host-token');
  if (hostToken === null) {
    throw new HttpError('FORBIDDEN', 403, 'Only the host can hand over a room');
  }
  await requireHostAccess(caller, roomId, hostToken);
  const memberId = requireMemberId(body.memberId);

  // The outgoing host never received a guest pass, because they created the room.
  // Without one, being demoted also means being locked out.
  const guestToken = generateToken();
  const result = await transfer(
    'room_transfer_host',
    [roomId, caller.userId, hostToken, memberId, guestToken],
    'The room could not be transferred',
  );

  return jsonResponse({ ...result, guestToken });
}

export async function claimHost(request: Request, caller: Caller): Promise<Response> {
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  const guestToken = optionalTokenHeader(request, 'x-room-guest-token');
  if (guestToken === null) {
    throw new HttpError('UNAUTHORIZED', 401, UNAUTHORIZED_MESSAGE);
  }

  const hostToken = generateToken();
  const result = await transfer(
    'room_claim_host',
    [roomId, caller.userId, guestToken, hostToken],
    'The host pass could not be claimed',
  );

  return jsonResponse({ ...result, hostToken });
}
