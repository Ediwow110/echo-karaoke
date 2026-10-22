import {
  consumeDailyRateLimit,
  consumeRateLimit,
  handleThrown,
  HttpError,
  jsonResponse,
  mapDatabaseError,
  optionsResponse,
  readJsonObject,
  readSearchCache,
  requireAnonymousCaller,
  requireRoomId,
  requireTokenHeader,
  serviceClient,
  writeSearchCache,
} from '../_shared/room.ts';
import { mapSearchResponse, type SearchResult } from '../_shared/youtube.ts';

const MEMBER_SEARCH_LIMIT = 20;
const USER_DAILY_SEARCH_LIMIT = 30;
const ROOM_DAILY_SEARCH_LIMIT = 60;
const SEARCH_WINDOW_SECONDS = 60;
const CACHE_TTL_SECONDS = 600;
const DEFAULT_DAILY_SEARCH_BUDGET = 90;

function dailySearchBudget(): number {
  const raw = Number(Deno.env.get('YOUTUBE_DAILY_SEARCH_BUDGET') ?? String(DEFAULT_DAILY_SEARCH_BUDGET));
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_DAILY_SEARCH_BUDGET;
}

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

    const memberLimit = await consumeRateLimit(
      caller.userId,
      'youtube-search-member',
      MEMBER_SEARCH_LIMIT,
      SEARCH_WINDOW_SECONDS,
    );
    if (!memberLimit.allowed) {
      throw new HttpError('RATE_LIMITED', 429, 'Search is busy. Try again in a moment.');
    }

    const cacheKey = query.trim().toLowerCase().replace(/\s+/g, ' ');
    const cached = await readSearchCache<SearchResult>(cacheKey);
    if (cached !== null) {
      return jsonResponse({ available: true, results: cached }, 200, origin);
    }

    const userDaily = await consumeDailyRateLimit(
      'user:' + caller.userId,
      'youtube-search-day',
      USER_DAILY_SEARCH_LIMIT,
    );
    if (!userDaily.allowed) {
      throw new HttpError('RATE_LIMITED', 429, 'You have reached today\'s search limit. Paste a link or try tomorrow.');
    }

    const roomDaily = await consumeDailyRateLimit(
      'room:' + roomId,
      'youtube-search-day',
      ROOM_DAILY_SEARCH_LIMIT,
    );
    if (!roomDaily.allowed) {
      return jsonResponse(
        {
          available: false,
          results: [],
          message: 'This room has reached its search limit for today. Paste a YouTube link instead.',
        },
        200,
        origin,
      );
    }

    const dailyBudget = await consumeDailyRateLimit(
      'global',
      'youtube-search-day',
      dailySearchBudget(),
    );
    if (!dailyBudget.allowed) {
      return jsonResponse(
        {
          available: false,
          results: [],
          message: 'Search is resting for today. Paste a YouTube link instead.',
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

    const results = mapSearchResponse(payload);
    await writeSearchCache(cacheKey, results, CACHE_TTL_SECONDS);
    return jsonResponse({ available: true, results }, 200, origin);
  } catch (error) {
    return handleThrown(error, origin);
  }
});
