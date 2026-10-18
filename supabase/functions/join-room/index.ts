import {
  generateToken,
  handleThrown,
  HttpError,
  jsonResponse,
  mapDatabaseError,
  normalizeDisplayName,
  optionsResponse,
  readJsonObject,
  requireAnonymousCaller,
  serviceClient,
} from '../_shared/room.ts';

function normalizeRoomCode(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError('VALIDATION_ERROR', 400, 'A room code is required');
  }
  const code = value.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(code)) {
    throw new HttpError('VALIDATION_ERROR', 400, 'That room code is not valid');
  }
  return code;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return optionsResponse(origin);
  if (req.method !== 'POST') {
    return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } }, 405, origin);
  }

  try {
    const caller = await requireAnonymousCaller(req);
    const body = await readJsonObject(req);
    const code = normalizeRoomCode(body.code);
    const displayName = normalizeDisplayName(body.displayName);
    const guestToken = generateToken();

    const { data, error } = await serviceClient().rpc('join_room', {
      p_code: code,
      p_user_id: caller.userId,
      p_display_name: displayName,
      p_guest_token: guestToken,
    });

    if (error !== null || data === null) throw mapDatabaseError(error);

    return jsonResponse(data, 200, origin);
  } catch (error) {
    return handleThrown(error, origin);
  }
});
