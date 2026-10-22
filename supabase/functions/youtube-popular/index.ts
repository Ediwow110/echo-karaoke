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
  requireTokenHeader,
  serviceClient,
} from '../_shared/room.ts';
import { mapSearchResponse, type SearchResult } from '../_shared/youtube.ts';

const CACHE_TTL_MS = 5 * 60_000;
const MUSIC_CATEGORY_ID = '10';
const REGION_CODE = 'US';
const MAX_RESULTS = 12;
const DEFAULT_DAILY_POPULAR_BUDGET = 200;

function dailyPopularBudget(): number {
  const raw = Number(Deno.env.get('YOUTUBE_DAILY_POPULAR_BUDGET') ?? String(DEFAULT_DAILY_POPULAR_BUDGET));
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_DAILY_POPULAR_BUDGET;
}

let cached: { at: number; results: SearchResult[] } | null = null;

/**
 * Reads the YouTube music chart so a guest can queue a song without typing.
 * The chart moves slowly, so the answer is held for five minutes.
 */
async function fetchPopular(apiKey: string): Promise<SearchResult[]> {
  if (cached !== null && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.results;
  }

  const budget = await consumeDailyRateLimit('global', 'youtube-popular-day', dailyPopularBudget());
  if (!budget.allowed) {
    throw new HttpError('SEARCH_UNAVAILABLE', 503, 'The music chart is unavailable right now');
  }

  const target = 'https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&videoCategoryId=' +
    MUSIC_CATEGORY_ID + '&maxResults=' + MAX_RESULTS + '&regionCode=' + REGION_CODE + '&key=' +
    encodeURIComponent(apiKey);

  let response: Response;
  try {
    response = await fetch(target, { signal: AbortSignal.timeout(6000) });
  } catch {
    throw new HttpError('SEARCH_UNAVAILABLE', 503, 'YouTube suggestions are unavailable right now');
  }

  if (!response.ok) {
    throw new HttpError('SEARCH_UNAVAILABLE', 503, 'YouTube suggestions are unavailable right now');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError('SEARCH_UNAVAILABLE', 503, 'YouTube suggestions returned an unreadable response');
  }

  const results = mapSearchResponse(payload);
  cached = { at: Date.now(), results };
  return results;
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
          message: 'Suggestions are not configured. Paste a YouTube link instead.',
        },
        200,
        origin,
      );
    }

    const memberLimit = await consumeRateLimit(caller.userId, 'youtube-popular-member', 30, 60);
    if (!memberLimit.allowed) {
      throw new HttpError('RATE_LIMITED', 429, 'Suggestions are busy. Try again shortly.');
    }

    const results = await fetchPopular(apiKey);
    return jsonResponse({ available: true, results }, 200, origin);
  } catch (error) {
    return handleThrown(error, origin);
  }
});
