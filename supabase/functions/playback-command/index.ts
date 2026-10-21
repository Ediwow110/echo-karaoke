import {
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

const ACTIONS = new Set(['play', 'pause', 'next']);

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return optionsResponse(origin);
  if (req.method !== 'POST') {
    return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } }, 405, origin);
  }

  try {
    const caller = await requireAnonymousCaller(req);
    const guestHeader = req.headers.get('x-room-guest-token');
    const hostHeader = req.headers.get('x-room-host-token');
    const guestToken = guestHeader !== null && guestHeader.trim().length >= 32 ? guestHeader.trim() : null;
    const hostToken = hostHeader !== null && hostHeader.trim().length >= 32 ? hostHeader.trim() : null;

    if (guestToken === null && hostToken === null) {
      throw new HttpError('UNAUTHORIZED', 401, 'A valid room token is required');
    }

    const body = await readJsonObject(req);
    const roomId = requireRoomId(body.roomId);
    const action = body.action;

    if (typeof action !== 'string' || !ACTIONS.has(action)) {
      throw new HttpError('VALIDATION_ERROR', 400, 'That playback action is not supported');
    }

    const { data, error } = await serviceClient().rpc('playback_command', {
      p_room_id: roomId,
      p_user_id: caller.userId,
      p_guest_token: guestToken,
      p_host_token: hostToken,
      p_action: action,
    });

    if (error !== null || data === null) throw mapDatabaseError(error);

    return jsonResponse(data, 200, origin);
  } catch (error) {
    return handleThrown(error, origin);
  }
});
