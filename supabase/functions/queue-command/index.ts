import {
  consumeDailyRateLimit,
  consumeRateLimit,
  handleThrown,
  HttpError,
  jsonResponse,
  mapDatabaseError,
  optionsResponse,
  readJsonObject,
  requireAnonymousCaller,
  requireRoomId,
  serviceClient,
} from '../_shared/room.ts';
import { fetchVideoMetadata, isValidVideoId } from '../_shared/youtube.ts';

const ACTIONS = new Set(['add', 'remove', 'reorder']);
const METADATA_DAILY_BUDGET = 1000;

function requireSongId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(value)) {
    throw new HttpError('VALIDATION_ERROR', 400, 'A song identifier is required');
  }
  return value;
}

function readCapability(req: Request): { guestToken: string | null; hostToken: string | null } {
  const guest = req.headers.get('x-room-guest-token');
  const host = req.headers.get('x-room-host-token');

  const guestToken = guest !== null && guest.trim().length >= 32 ? guest.trim() : null;
  const hostToken = host !== null && host.trim().length >= 32 ? host.trim() : null;

  if (guestToken === null && hostToken === null) {
    throw new HttpError('UNAUTHORIZED', 401, 'A valid room token is required');
  }

  return { guestToken, hostToken };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return optionsResponse(origin);
  if (req.method !== 'POST') {
    return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } }, 405, origin);
  }

  try {
    const caller = await requireAnonymousCaller(req);
    const capability = readCapability(req);
    const body = await readJsonObject(req);
    const roomId = requireRoomId(body.roomId);
    const action = body.action;

    if (typeof action !== 'string' || !ACTIONS.has(action)) {
      throw new HttpError('VALIDATION_ERROR', 400, 'That queue action is not supported');
    }

    const admin = serviceClient();

    if (action === 'add') {
      const videoId = body.videoId;
      if (!isValidVideoId(videoId)) {
        throw new HttpError('VALIDATION_ERROR', 400, 'A valid YouTube video is required');
      }

      // Authorize before calling the external metadata service. Otherwise an
      // anonymous caller with a random header can use this endpoint as an
      // outbound request amplifier.
      const access = capability.hostToken !== null
        ? await admin.rpc('host_access_check', {
          p_room_id: roomId,
          p_user_id: caller.userId,
          p_host_token: capability.hostToken,
        })
        : await admin.rpc('room_access_check', {
          p_room_id: roomId,
          p_user_id: caller.userId,
          p_guest_token: capability.guestToken,
        });

      if (access.error !== null || access.data === null) {
        throw mapDatabaseError(access.error);
      }
      if ((access.data as { status?: string }).status === 'ended') {
        throw new HttpError('ROOM_ENDED', 409, 'This room has ended');
      }

      // Reject the member's burst before spending the shared daily budget.
      const metadataLimit = await consumeRateLimit(caller.userId, 'queue-metadata', 10, 60);
      if (!metadataLimit.allowed) {
        throw new HttpError('LOOKUP_RATE_LIMITED', 429, 'Too many song lookups. Give it a moment.');
      }

      const metadataDaily = await consumeDailyRateLimit('global', 'queue-metadata-day', METADATA_DAILY_BUDGET);
      if (!metadataDaily.allowed) {
        throw new HttpError('LOOKUP_RATE_LIMITED', 429, 'Too many song lookups today. Try again tomorrow.');
      }

      const metadata = await fetchVideoMetadata(videoId);
      if (metadata === null) {
        throw new HttpError(
          'METADATA_UNAVAILABLE',
          422,
          'That video could not be read. Check the link and try again.',
        );
      }

      const { data, error } = await admin.rpc('queue_add', {
        p_room_id: roomId,
        p_user_id: caller.userId,
        p_guest_token: capability.guestToken,
        p_host_token: capability.hostToken,
        p_video_id: metadata.videoId,
        p_title: metadata.title,
        p_channel_title: metadata.channelTitle,
        p_thumbnail_url: metadata.thumbnailUrl,
        p_duration_seconds: metadata.durationSeconds,
      });

      if (error !== null || data === null) throw mapDatabaseError(error);
      return jsonResponse(data, 201, origin);
    }

    if (action === 'remove') {
      const { data, error } = await admin.rpc('queue_remove', {
        p_room_id: roomId,
        p_user_id: caller.userId,
        p_guest_token: capability.guestToken,
        p_host_token: capability.hostToken,
        p_song_id: requireSongId(body.songId),
      });

      if (error !== null || data === null) throw mapDatabaseError(error);
      return jsonResponse(data, 200, origin);
    }

    const direction = body.direction;
    if (direction !== 'up' && direction !== 'down') {
      throw new HttpError('VALIDATION_ERROR', 400, 'Direction must be up or down');
    }

    const { data, error } = await admin.rpc('queue_reorder', {
      p_room_id: roomId,
      p_user_id: caller.userId,
      p_guest_token: capability.guestToken,
      p_host_token: capability.hostToken,
      p_song_id: requireSongId(body.songId),
      p_direction: direction,
    });

    if (error !== null || data === null) throw mapDatabaseError(error);
    return jsonResponse(data, 200, origin);
  } catch (error) {
    return handleThrown(error, origin);
  }
});
