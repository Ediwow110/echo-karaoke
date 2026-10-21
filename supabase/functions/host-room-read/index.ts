import {
  handleThrown,
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

    const { data, error } = await serviceClient().rpc('read_room_host', {
      p_room_id: roomId,
      p_user_id: caller.userId,
      p_host_token: hostToken,
    });

    if (error !== null || data === null) throw mapDatabaseError(error);

    return jsonResponse(data, 200, origin);
  } catch (error) {
    return handleThrown(error, origin);
  }
});
