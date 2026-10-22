import { readJsonObject } from './tokens';
import { callOperation, requireRoomId, requireSongId, type Caller } from './room';
import { HttpError, jsonResponse } from './errors';
import { fetchVideoMetadata, isValidVideoId } from './metadata';

const ACTIONS = new Set(['add', 'remove', 'reorder']);
const METADATA_DAILY_BUDGET = 1000;

function readCapability(request: Request): { guestToken: string | null; hostToken: string | null } {
  const guest = request.headers.get('x-room-guest-token');
  const host = request.headers.get('x-room-host-token');
  const guestToken = guest !== null && guest.trim().length >= 32 ? guest.trim() : null;
  const hostToken = host !== null && host.trim().length >= 32 ? host.trim() : null;
  if (guestToken === null && hostToken === null) {
    throw new HttpError('UNAUTHORIZED', 401, 'A valid room token is required');
  }
  return { guestToken, hostToken };
}

async function enforceLimit(
  name: string,
  params: unknown[],
  message: string,
): Promise<void> {
  const result = (await callOperation(name, params)) as { allowed?: boolean };
  if (result.allowed !== true) {
    throw new HttpError('LOOKUP_RATE_LIMITED', 429, message);
  }
}

async function requireRoomAccess(
  caller: Caller,
  roomId: string,
  capability: { guestToken: string | null; hostToken: string | null },
): Promise<void> {
  const access = (capability.hostToken !== null
    ? await callOperation('host_access_check', [roomId, caller.userId, capability.hostToken])
    : await callOperation('room_access_check', [roomId, caller.userId, capability.guestToken])) as {
      status?: string;
    };
  if (access.status === 'ended') {
    throw new HttpError('ROOM_ENDED', 409, 'This room has ended');
  }
}

export async function queueCommand(request: Request, caller: Caller): Promise<Response> {
  const capability = readCapability(request);
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  const action = body.action;

  if (typeof action !== 'string' || !ACTIONS.has(action)) {
    throw new HttpError('VALIDATION_ERROR', 400, 'That queue action is not supported');
  }

  if (action === 'add') {
    const videoId = body.videoId;
    if (!isValidVideoId(videoId)) {
      throw new HttpError('VALIDATION_ERROR', 400, 'A valid YouTube video is required');
    }

    await requireRoomAccess(caller, roomId, capability);
    await enforceLimit(
      'consume_rate_limit',
      [caller.userId, 'queue-metadata', 10, 60],
      'Too many song lookups. Give it a moment.',
    );
    await enforceLimit(
      'consume_daily_rate_limit',
      ['global', 'queue-metadata-day', METADATA_DAILY_BUDGET],
      'Too many song lookups today. Try again tomorrow.',
    );

    const metadata = await fetchVideoMetadata(videoId);
    if (metadata === null) {
      throw new HttpError(
        'METADATA_UNAVAILABLE',
        422,
        'That video could not be read. Check the link and try again.',
      );
    }

    const result = await callOperation('queue_add', [
      roomId,
      caller.userId,
      capability.guestToken,
      capability.hostToken,
      metadata.videoId,
      metadata.title,
      metadata.channelTitle,
      metadata.thumbnailUrl,
      metadata.durationSeconds,
    ]);
    return jsonResponse(result, 201);
  }

  if (action === 'remove') {
    const result = await callOperation('queue_remove', [
      roomId,
      caller.userId,
      capability.guestToken,
      capability.hostToken,
      requireSongId(body.songId),
    ]);
    return jsonResponse(result);
  }

  const direction = body.direction;
  if (direction !== 'up' && direction !== 'down') {
    throw new HttpError('VALIDATION_ERROR', 400, 'Direction must be up or down');
  }

  const result = await callOperation('queue_reorder', [
    roomId,
    caller.userId,
    capability.guestToken,
    capability.hostToken,
    requireSongId(body.songId),
    direction,
  ]);
  return jsonResponse(result);
}
