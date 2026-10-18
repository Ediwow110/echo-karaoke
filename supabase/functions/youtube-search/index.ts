import {
  handleThrown,
  HttpError,
  jsonResponse,
  mapDatabaseError,
  optionsResponse,
  readJsonObject,
  requireAnonymousCaller,
  requireRoomId,
  requireTokenHeader,
  serviceClient,
} from '../_shared/room.ts';
import { mapSearchResponse } from '../_shared/youtube.ts';

function requireQuery(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError('VALIDATION_ERROR', 400, 'A search term is required');
  }
  const query = value.trim();
  if (query.length === 0 || query.length > 100) {
    throw new HttpError('VALIDATION_ERROR', 400, 'Search terms must be between 1 and 100 characters');
  }
  return query;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return optionsResponse(origin);
  if (req.method !== 'POST') {
    return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } }, 405, origin);
  }

  try {
    const caller = await requireAnonymousCaller(req);
    const guestToken = requireTokenHeader(req, 'x-room-guest-token');
    const body = await readJsonObject(req);
    const roomId = requireRoomId(body.roomId);
    const query = requireQuery(body.query);

    const access = await serviceClient().rpc('room_access_check', {
      p_room_id: roomId,
      p_user_id: caller.userId,
      p_guest_token: guestToken,
    });

    if (access.error !== null || access.data === null) {
      throw mapDatabaseError(access.error);
    }
    if ((access.data as { status?: string }).status === 'ended') {
      throw new HttpError('ROOM_ENDED', 409, 'This room has ended');
    }

    const apiKey = Deno.env.get('YOUTUBE_API_KEY') ?? '';
    if (apiKey.length === 0) {
      return jsonResponse(
        {
          available: false,
          results: [],
          message: 'Search is not configured. Paste a YouTube link instead.',
        },
        200,
        origin,
      );
    }

    const target = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&key=' +
      encodeURIComponent(apiKey) + '&q=' + encodeURIComponent(query);

    let upstream: Response;
    try {
      upstream = await fetch(target, { signal: AbortSignal.timeout(6000) });
    } catch {
      throw new HttpError('SEARCH_UNAVAILABLE', 503, 'YouTube search is unavailable right now');
    }

    if (!upstream.ok) {
      throw new HttpError('SEARCH_UNAVAILABLE', 503, 'YouTube search is unavailable right now');
    }

    let payload: unknown;
    try {
      payload = await upstream.json();
    } catch {
      throw new HttpError('SEARCH_UNAVAILABLE', 503, 'YouTube search returned an unreadable response');
    }

    return jsonResponse({ available: true, results: mapSearchResponse(payload) }, 200, origin);
  } catch (error) {
    return handleThrown(error, origin);
  }
});
