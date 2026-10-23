import { operationCall, serviceDatabase } from '../db/client.js';
import { HttpError, jsonResponse, mapDatabaseError } from './errors.js';
import { readJsonObject } from './tokens.js';
import { requireRoomId, requireTokenHeader, type Caller } from './room.js';

export type SearchResult = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
};

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const MAX_RESULTS = 10;
export const MAX_SUGGESTIONS = 10;
const MEMBER_SEARCH_LIMIT = 20;
const USER_DAILY_SEARCH_LIMIT = 30;
const ROOM_DAILY_SEARCH_LIMIT = 60;
const SEARCH_WINDOW_SECONDS = 60;
const CACHE_TTL_SECONDS = 600;
const DEFAULT_DAILY_SEARCH_BUDGET = 90;
const DEFAULT_DAILY_POPULAR_BUDGET = 200;
const SEARCH_CACHE_TTL_MS = 5 * 60_000;
const SUGGEST_CACHE_TTL_MS = 60_000;

let popularCached: { at: number; results: SearchResult[] } | null = null;
const suggestCache = new Map<string, { at: number; suggestions: string[] }>();

function text(value: unknown, limit: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, limit) : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function mapSearchResponse(payload: unknown): SearchResult[] {
  if (payload === null || typeof payload !== 'object') return [];
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  const mapped: SearchResult[] = [];
  for (const raw of items) {
    const item = raw as {
      id?: { videoId?: unknown };
      snippet?: {
        title?: unknown;
        channelTitle?: unknown;
        thumbnails?: { medium?: { url?: unknown }; high?: { url?: unknown }; default?: { url?: unknown } };
      };
    } | null;
    const videoId = item?.id?.videoId;
    if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId)) continue;
    const title = text(item?.snippet?.title, 500);
    if (title === null) continue;
    const thumbnails = item?.snippet?.thumbnails;
    const thumbnail = text(thumbnails?.medium?.url, 500)
      ?? text(thumbnails?.high?.url, 500)
      ?? text(thumbnails?.default?.url, 500);
    mapped.push({
      videoId,
      title: decodeEntities(title),
      channelTitle: text(item?.snippet?.channelTitle, 200),
      thumbnailUrl: thumbnail,
      durationSeconds: null,
    });
    if (mapped.length === MAX_RESULTS) break;
  }
  return mapped;
}

export function parseSuggestions(payload: unknown): string[] {
  if (!Array.isArray(payload) || payload.length < 2) return [];
  const items = payload[1];
  if (!Array.isArray(items)) return [];
  const suggestions: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const value = item.trim().slice(0, 100);
    if (value.length === 0 || suggestions.includes(value)) continue;
    suggestions.push(value);
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }
  return suggestions;
}

function requireQuery(value: unknown, minimum = 1): string {
  if (typeof value !== 'string') {
    throw new HttpError('VALIDATION_ERROR', 400, 'A search term is required');
  }
  const query = value.trim();
  if (query.length < minimum || query.length > 100) {
    throw new HttpError(
      'VALIDATION_ERROR',
      400,
      minimum > 1 ? 'Type at least two characters' : 'Search terms must be between 1 and 100 characters',
    );
  }
  return query;
}

function dailyBudget(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? String(fallback));
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : fallback;
}

async function queryAllowNull(name: string, params: unknown[]): Promise<unknown> {
  const call = operationCall(name, params);
  try {
    const rows = await serviceDatabase().query(call.text, call.params);
    return (rows[0] as { result?: unknown } | undefined)?.result ?? null;
  } catch (error) {
    throw mapDatabaseError(error as { message?: string });
  }
}

async function requireGuestAccess(request: Request, caller: Caller, roomId: string): Promise<string> {
  const guestToken = requireTokenHeader(request, 'x-room-guest-token');
  const access = (await queryAllowNull('room_access_check', [roomId, caller.userId, guestToken])) as {
    status?: string;
  } | null;
  if (access === null) {
    throw new HttpError('UNAUTHORIZED', 401, 'A valid room token is required');
  }
  if (access.status === 'ended') {
    throw new HttpError('ROOM_ENDED', 409, 'This room has ended');
  }
  return guestToken;
}

async function enforceLimit(name: string, params: unknown[], message: string): Promise<void> {
  const result = (await queryAllowNull(name, params)) as { allowed?: boolean } | null;
  if (result?.allowed !== true) {
    throw new HttpError('RATE_LIMITED', 429, message);
  }
}

async function readSearchCache(key: string): Promise<SearchResult[] | null> {
  return (await queryAllowNull('youtube_search_cache_get', [key])) as SearchResult[] | null;
}

async function writeSearchCache(key: string, results: SearchResult[]): Promise<void> {
  try {
    await queryAllowNull('youtube_search_cache_put', [key, results, CACHE_TTL_SECONDS]);
  } catch {
    // The search result is still useful when the cache write loses a race.
  }
}

export async function youtubeSearch(request: Request, caller: Caller): Promise<Response> {
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  const query = requireQuery(body.query);
  await requireGuestAccess(request, caller, roomId);

  const apiKey = process.env.YOUTUBE_API_KEY ?? '';
  if (apiKey.length === 0) {
    return jsonResponse({
      available: false,
      results: [],
      message: 'Search is not configured. Paste a YouTube link instead.',
    });
  }

  await enforceLimit('consume_rate_limit', [
    caller.userId,
    'youtube-search-member',
    MEMBER_SEARCH_LIMIT,
    SEARCH_WINDOW_SECONDS,
  ], 'Search is busy. Try again in a moment.');

  const cacheKey = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const cached = await readSearchCache(cacheKey);
  if (cached !== null) {
    return jsonResponse({ available: true, results: cached });
  }

  await enforceLimit('consume_daily_rate_limit', [
    'user:' + caller.userId,
    'youtube-search-day',
    USER_DAILY_SEARCH_LIMIT,
  ], "You have reached today's search limit. Paste a link or try tomorrow.");

  const roomDaily = await queryAllowNull('consume_daily_rate_limit', [
    'room:' + roomId,
    'youtube-search-day',
    ROOM_DAILY_SEARCH_LIMIT,
  ]) as { allowed?: boolean } | null;
  if (roomDaily?.allowed !== true) {
    return jsonResponse({
      available: false,
      results: [],
      message: 'This room has reached its search limit for today. Paste a YouTube link instead.',
    });
  }

  const daily = await queryAllowNull('consume_daily_rate_limit', [
    'global',
    'youtube-search-day',
    dailyBudget('YOUTUBE_DAILY_SEARCH_BUDGET', DEFAULT_DAILY_SEARCH_BUDGET),
  ]) as { allowed?: boolean } | null;
  if (daily?.allowed !== true) {
    return jsonResponse({
      available: false,
      results: [],
      message: 'Search is resting for today. Paste a YouTube link instead.',
    });
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
  await writeSearchCache(cacheKey, results);
  return jsonResponse({ available: true, results });
}

export async function youtubePopular(request: Request, caller: Caller): Promise<Response> {
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  await requireGuestAccess(request, caller, roomId);

  const apiKey = process.env.YOUTUBE_API_KEY ?? '';
  if (apiKey.length === 0) {
    return jsonResponse({
      available: false,
      results: [],
      message: 'Suggestions are not configured. Paste a YouTube link instead.',
    });
  }

  await enforceLimit('consume_rate_limit', [
    caller.userId,
    'youtube-popular-member',
    30,
    60,
  ], 'Suggestions are busy. Try again shortly.');

  if (popularCached !== null && Date.now() - popularCached.at < SEARCH_CACHE_TTL_MS) {
    return jsonResponse({ available: true, results: popularCached.results });
  }

  await enforceLimit('consume_daily_rate_limit', [
    'global',
    'youtube-popular-day',
    dailyBudget('YOUTUBE_DAILY_POPULAR_BUDGET', DEFAULT_DAILY_POPULAR_BUDGET),
  ], 'The music chart is unavailable right now');

  const target = 'https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&videoCategoryId=10&maxResults=12&regionCode=US&key=' +
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
  popularCached = { at: Date.now(), results };
  return jsonResponse({ available: true, results });
}

async function fetchSuggestions(query: string): Promise<string[]> {
  const cached = suggestCache.get(query);
  if (cached !== undefined && Date.now() - cached.at < SUGGEST_CACHE_TTL_MS) {
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
  if (!response.ok) return [];

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return [];
  }

  const suggestions = parseSuggestions(payload);
  suggestCache.set(query, { at: Date.now(), suggestions });
  return suggestions;
}

export async function youtubeSuggest(request: Request, caller: Caller): Promise<Response> {
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  const query = requireQuery(body.query, 2);
  await requireGuestAccess(request, caller, roomId);

  await enforceLimit('consume_rate_limit', [
    caller.userId,
    'youtube-suggest-member',
    60,
    60,
  ], 'Suggestions are busy. Keep typing or paste a link.');

  const daily = await queryAllowNull('consume_daily_rate_limit', [
    'global',
    'youtube-suggest-day',
    3000,
  ]) as { allowed?: boolean } | null;
  if (daily?.allowed !== true) {
    return jsonResponse({ suggestions: [] });
  }

  const suggestions = await fetchSuggestions(query);
  return jsonResponse({ suggestions });
}
