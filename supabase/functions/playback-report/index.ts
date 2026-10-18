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

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return optionsResponse(origin);
  if (req.method !== 'POST') {
    return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } }, 405, origin);
  }

  try {
    const caller = await requireAnonymousCaller(req);
    const hostToken = requireTokenHeader(req, 'x-room-host-token');
    const body = await readJsonObject(req);
    const roomId = requireRoomId(body.roomId);
    const position = body.positionSeconds;

    if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > 86400) {
      throw new HttpError('VALIDATION_ERROR', 400, 'A playback position is required');
    }

    const { data, error } = await serviceClient().rpc('playback_report', {
      p_room_id: roomId,
      p_user_id: caller.userId,
      p_host_token: hostToken,
      p_position_seconds: Math.floor(position),
    });

    if (error !== null || data === null) throw mapDatabaseError(error);

    return jsonResponse(data, 200, origin);
  } catch (error) {
    return handleThrown(error, origin);
  }
});
