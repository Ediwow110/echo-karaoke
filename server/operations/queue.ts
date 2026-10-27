import { readJsonObject } from './tokens.js';
import { callOperation, requireRoomId, requireSongId, type Caller } from './room.js';
import { HttpError, jsonResponse, logFailure, UNAUTHORIZED_MESSAGE } from './errors.js';
import { fetchVideoMetadata, isValidVideoId } from './metadata.js';

const ACTIONS = new Set(['add', 'remove', 'reorder']);
const DEFAULT_METADATA_DAILY_BUDGET = 5000;
const DEFAULT_METADATA_ROOM_BUDGET = 500;

function dailyBudget(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? String(fallback));
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : fallback;
}

function readCapability(request: Request): { guestToken: string | null; hostToken: string | null } {
  const guest = request.headers.get('x-room-guest-token');
  const host = request.headers.get('x-room-host-token');
  const guestToken = guest !== null && guest.trim().length >= 32 ? guest.trim() : null;
  const hostToken = host !== null && host.trim().length >= 32 ? host.trim() : null;
  if (guestToken === null && hostToken === null) {
    throw new HttpError('UNAUTHORIZED', 401, UNAUTHORIZED_MESSAGE);
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

    // Reject locked, duplicate, ended, and over-limit adds before the shared
    // metadata budget or an outbound oEmbed request is spent.
    await callOperation('queue_add_preflight', [
      roomId,
      caller.userId,
      capability.guestToken,
      capability.hostToken,
      videoId,
    ]);
    await enforceLimit(
      'consume_rate_limit',
      [caller.userId, 'queue-metadata', 10, 60],
      'Too many song lookups. Give it a moment.',
    );

    const roomSubject = 'room:' + roomId;

    // A failed lookup spent no YouTube cost and added no song, so both shared
    // budgets must be given back. Otherwise looped dead links exhaust the room
    // for every guest until the next Pacific midnight.
    const charged: string[] = [];
    const refundCharged = async (): Promise<void> => {
      if (charged.length === 0) return;
      const results = await Promise.allSettled(charged.map((subject) => (
        callOperation('refund_daily_rate_limit', [subject, 'queue-metadata-day'])
      )));
      for (const result of results) {
        if (result.status === 'rejected') {
          logFailure('queue-command/refund', result.reason, 500, request);
        }
      }
    };
    const chargeDaily = async (subject: string, params: unknown[], message: string): Promise<void> => {
      const result = (await callOperation('consume_daily_rate_limit', params)) as { allowed?: boolean };
      charged.push(subject);
      if (result.allowed !== true) {
        await refundCharged();
        throw new HttpError('LOOKUP_RATE_LIMITED', 429, message);
      }
    };

    await chargeDaily(
      roomSubject,
      [
        roomSubject,
        'queue-metadata-day',
        dailyBudget('YOUTUBE_ROOM_METADATA_BUDGET', DEFAULT_METADATA_ROOM_BUDGET),
      ],
      "This room has reached today's song lookup limit. Try again tomorrow.",
    );
    await chargeDaily(
      'global',
      [
        'global',
        'queue-metadata-day',
        dailyBudget('YOUTUBE_DAILY_METADATA_BUDGET', DEFAULT_METADATA_DAILY_BUDGET),
      ],
      'Too many song lookups today. Try again tomorrow.',
    );

    const metadata = await fetchVideoMetadata(videoId);
    if (metadata === null) {
      await refundCharged();
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
