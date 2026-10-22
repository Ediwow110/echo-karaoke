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

const ALLOWED_ACTIONS = new Set([
  'end',
  'lock',
  'unlock',
  'lock_playback',
  'unlock_playback',
  'clear_queue',
]);

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
    const action = body.action;

    if (typeof action !== 'string' || !ALLOWED_ACTIONS.has(action)) {
      throw new HttpError('VALIDATION_ERROR', 400, 'That host action is not supported');
    }

    const { data, error } = await serviceClient().rpc('host_command', {
      p_room_id: roomId,
      p_user_id: caller.userId,
      p_host_token: hostToken,
      p_action: action,
    });

    if (error !== null || data === null) throw mapDatabaseError(error);

    return jsonResponse(data, 200, origin);
  } catch (error) {
    return handleThrown(error, origin);
  }
});
