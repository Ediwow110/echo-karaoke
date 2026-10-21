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
import { parseSuggestions } from '../_shared/youtube.ts';

const MAX_SUGGESTIONS = 10;
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; suggestions: string[] }>();

function requireQuery(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError('VALIDATION_ERROR', 400, 'A search term is required');
  }
  const query = value.trim();
  if (query.length < 2 || query.length > 100) {
    throw new HttpError('VALIDATION_ERROR', 400, 'Type at least two characters');
  }
  return query;
}

async function fetchSuggestions(query: string): Promise<string[]> {
  const cached = cache.get(query);
  if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.suggestions;
  }

  const target = 'https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=' +
    encodeURIComponent(query);

  let response: Response;
  try {
    response = await fetch(target, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    return [];
  }

  if (!response.ok) {
    return [];
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return [];
  }

  const suggestions = parseSuggestions(payload);
  cache.set(query, { at: Date.now(), suggestions });
  return suggestions;
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

    const suggestions = await fetchSuggestions(query);
    return jsonResponse({ suggestions }, 200, origin);
  } catch (error) {
    return handleThrown(error, origin);
  }
});