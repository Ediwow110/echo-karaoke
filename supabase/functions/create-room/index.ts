import {
  generateRoomCode,
  generateToken,
  handleThrown,
  HttpError,
  jsonResponse,
  mapDatabaseError,
  normalizeDisplayName,
  normalizeRoomName,
  optionsResponse,
  readJsonObject,
  readOptionalBoolean,
  requireAnonymousCaller,
  serviceClient,
} from '../_shared/room.ts';

const MAX_ATTEMPTS = 4;

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return optionsResponse(origin);
  if (req.method !== 'POST') {
    return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } }, 405, origin);
  }

  try {
    const caller = await requireAnonymousCaller(req);
    const body = await readJsonObject(req);
    const displayName = normalizeDisplayName(body.displayName);
    const roomName = normalizeRoomName(body.roomName);
    const guestsCanAdd = readOptionalBoolean(body.guestsCanAdd, true);
    const guestsCanControlPlayback = readOptionalBoolean(body.guestsCanControlPlayback, false);
    const admin = serviceClient();

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const guestToken = generateToken();
      const hostToken = generateToken();

      const { data, error } = await admin.rpc('create_room', {
        p_code: generateRoomCode(),
        p_user_id: caller.userId,
        p_display_name: displayName,
        p_guest_token: guestToken,
        p_host_token: hostToken,
        p_name: roomName,
        p_guest_control_locked: !guestsCanAdd,
        p_guest_playback_locked: !guestsCanControlPlayback,
      });

      if (error === null && data !== null) {
        return jsonResponse(data, 201, origin);
      }
      if ((error?.message ?? '').includes('duplicate key') === false) {
        throw mapDatabaseError(error);
      }
    }

    throw new HttpError('ROOM_CODE_UNAVAILABLE', 503, 'A room code could not be allocated');
  } catch (error) {
    return handleThrown(error, origin);
  }
});
