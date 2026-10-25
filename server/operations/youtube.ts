import { operationCall, serviceDatabase } from '../db/client.js';
import { HttpError, jsonResponse, logFailure, mapDatabaseError } from './errors.js';
import { readJsonObject } from './tokens.js';
import { requireRoomId, type Caller } from './room.js';
import { requireRoomAccess } from './catalogAccess.js';

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
const DEFAULT_DAILY_POPULAR_BUDGET = 6;
const POPULAR_QUERY = 'popular karaoke songs';
const POPULAR_FETCH_LIMIT = 20;
const POPULAR_RESULT_LIMIT = 8;
const POPULAR_CACHE_KEY = '__popular_karaoke_v2';
const POPULAR_CACHE_TTL_SECONDS = 12 * 60 * 60;
const POPULAR_CACHE_TTL_MS = POPULAR_CACHE_TTL_SECONDS * 1000;
const COMPILATION_PATTERN = /\b(medley|non-?stop|compilation|playlist|full album|1 hour|one hour)\b/i;
const SUGGEST_CACHE_TTL_MS = 60_000;
const SUGGEST_CACHE_MAX = 500;

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

type Snippet = {
  title?: unknown;
  channelTitle?: unknown;
  thumbnails?: { medium?: { url?: unknown }; high?: { url?: unknown }; default?: { url?: unknown } };
};

function mapItem(videoId: unknown, snippet: Snippet | undefined): SearchResult | null {
  if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId)) return null;
  const title = text(snippet?.title, 500);
  if (title === null) return null;
  const thumbnails = snippet?.thumbnails;
  const thumbnail = text(thumbnails?.medium?.url, 500)
    ?? text(thumbnails?.high?.url, 500)
    ?? text(thumbnails?.default?.url, 500);
  return {
    videoId,
    title: decodeEntities(title),
    channelTitle: text(snippet?.channelTitle, 200),
    thumbnailUrl: thumbnail,
    durationSeconds: null,
  };
}

export function mapSearchResponse(payload: unknown, limit = MAX_RESULTS): SearchResult[] {
  if (payload === null || typeof payload !== 'object') return [];
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  const mapped: SearchResult[] = [];
  for (const raw of items) {
    const item = raw as { id?: { videoId?: unknown }; snippet?: Snippet } | null;
    const result = mapItem(item?.id?.videoId, item?.snippet);
    if (result !== null) mapped.push(result);
    if (mapped.length === limit) break;
  }
  return mapped;
}

export function buildPopularSearchUrl(apiKey: string): string {
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoCategoryId: '10',
    videoEmbeddable: 'true',
    order: 'relevance',
    maxResults: String(POPULAR_FETCH_LIMIT),
    regionCode: 'US',
    relevanceLanguage: 'en',
    key: apiKey,
    q: POPULAR_QUERY,
  });
  return 'https://www.googleapis.com/youtube/v3/search?' + params.toString();
}

export function selectPopularResults(payload: unknown): SearchResult[] {
  return mapSearchResponse(payload, POPULAR_FETCH_LIMIT)
    .filter((song) => !COMPILATION_PATTERN.test(song.title));
}

export function pickPopularCards(
  pool: SearchResult[],
  limit = POPULAR_RESULT_LIMIT,
): SearchResult[] {
  if (pool.length <= limit) {
    return [...pool];
  }
  const shuffled = [...pool];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled.slice(0, limit);
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
    throw mapDatabaseError(error as { message?: string }, (error as { code?: string }).code);
  }
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

// This is a fallback, never an unbounded copy of YouTube search. The catalog
// RPC also filters expired entries, but independently reject rows from any
// older database function that does not return an observed freshness date.
export function mapFreshCatalogResults(value: unknown, now = Date.now()): SearchResult[] {
  const items = value !== null && typeof value === 'object'
    ? (value as { items?: unknown }).items : null;
  if (!Array.isArray(items)) return [];
  const cutoff = now - 28 * 24 * 60 * 60 * 1000;
  return items.flatMap((item): SearchResult[] => {
    if (item === null || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const checked = typeof row.syncedAt === 'string' ? Date.parse(row.syncedAt) : NaN;
    if (!Number.isFinite(checked) || checked <= cutoff || checked > now + 60_000) return [];
    const videoId = row.videoId;
    const title = text(row.title, 500);
    if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId) || title === null) return [];
    return [{
      videoId, title,
      channelTitle: text(row.channelTitle, 200),
      thumbnailUrl: text(row.thumbnailUrl, 500),
      durationSeconds: null,
    }];
  }).slice(0, MAX_RESULTS);
}

const UNDEFINED_FUNCTION = '42883';

async function freshCatalogFallback(query: string): Promise<SearchResult[]> {
  try {
    const rows = await queryAllowNull('karaoke_catalog_page', [query, '', 0, MAX_RESULTS]);
    return mapFreshCatalogResults(rows);
  } catch (error) {
    // Only "not migrated yet" is a staged-rollout state. Anything else — above
    // all a denied grant (42501) — must surface, because answering "the
    // songbook has nothing" is how a broken deployment hides from its users.
    if ((error as { sqlState?: string }).sqlState === UNDEFINED_FUNCTION) return [];
    throw error;
  }
}

async function localSearchOrUnavailable(query: string, message: string): Promise<Response> {
  const results = await freshCatalogFallback(query);
  if (results.length > 0) {
    return jsonResponse({
      available: true, results, source: 'songbook',
      message: 'YouTube search is unavailable. Showing recent songbook entries instead.',
    });
  }
  return jsonResponse({ available: false, results: [], message });
}

async function writeSearchCache(
  key: string,
  results: SearchResult[],
  ttlSeconds = CACHE_TTL_SECONDS,
): Promise<void> {
  try {
    // The driver encodes a JS array as a Postgres array; send JSON text so the
    // jsonb parameter is parsed instead of rejected.
    await queryAllowNull('youtube_search_cache_put', [key, JSON.stringify(results), ttlSeconds]);
  } catch (error) {
    // The result is still useful when the cache write loses a race, but a
    // rejected TTL or missing grant must not stay invisible.
    logFailure('youtube-search/cache-write', error, 500);
  }
}

export async function youtubeSearch(request: Request, caller: Caller): Promise<Response> {
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  const query = requireQuery(body.query);
  await requireRoomAccess(request, caller, roomId);

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

  const apiKey = process.env.YOUTUBE_API_KEY ?? '';
  if (apiKey.length === 0) {
    return localSearchOrUnavailable(query, 'Search is not configured. Ask the host to enable YouTube search.');
  }

  // Peek at the shared limits before charging the caller's personal day. A
  // room that is already out, or a depleted global pool, must not cost a user
  // one of their thirty searches.
  const roomPeek = await queryAllowNull('peek_daily_rate_limit', [
    'room:' + roomId,
    'youtube-search-day',
    ROOM_DAILY_SEARCH_LIMIT,
  ]) as { allowed?: boolean } | null;
  if (roomPeek?.allowed !== true) {
    return localSearchOrUnavailable(query, 'This room has reached its search limit for today. Try again tomorrow.');
  }

  const globalPeek = await queryAllowNull('peek_daily_rate_limit', [
    'global',
    'youtube-search-day',
    dailyBudget('YOUTUBE_DAILY_SEARCH_BUDGET', DEFAULT_DAILY_SEARCH_BUDGET),
  ]) as { allowed?: boolean } | null;
  if (globalPeek?.allowed !== true) {
    return localSearchOrUnavailable(query, 'Search is resting for today. Try again tomorrow.');
  }

  const userPeek = await queryAllowNull('peek_daily_rate_limit', [
    'user:' + caller.userId,
    'youtube-search-day',
    USER_DAILY_SEARCH_LIMIT,
  ]) as { allowed?: boolean } | null;
  if (userPeek?.allowed !== true) {
    throw new HttpError('RATE_LIMITED', 429, "You have reached today's search limit. Try again tomorrow.");
  }

  const charged: string[] = [];
  const refundCharged = async (): Promise<void> => {
    if (charged.length === 0) return;
    const results = await Promise.allSettled(charged.map((subject) => (
      queryAllowNull('refund_daily_rate_limit', [subject, 'youtube-search-day'])
    )));
    for (const result of results) {
      if (result.status === 'rejected') {
        logFailure('youtube-search/refund', result.reason, 500, request);
      }
    }
  };

  const userDaily = await queryAllowNull('consume_daily_rate_limit', [
    'user:' + caller.userId,
    'youtube-search-day',
    USER_DAILY_SEARCH_LIMIT,
  ]) as { allowed?: boolean } | null;
  charged.push('user:' + caller.userId);
  if (userDaily?.allowed !== true) {
    await refundCharged();
    throw new HttpError('RATE_LIMITED', 429, "You have reached today's search limit. Try again tomorrow.");
  }

  const roomDaily = await queryAllowNull('consume_daily_rate_limit', [
    'room:' + roomId,
    'youtube-search-day',
    ROOM_DAILY_SEARCH_LIMIT,
  ]) as { allowed?: boolean } | null;
  charged.push('room:' + roomId);
  if (roomDaily?.allowed !== true) {
    await refundCharged();
    return jsonResponse({
      available: false,
      results: [],
      message: 'This room has reached its search limit for today. Try again tomorrow.',
    });
  }

  const daily = await queryAllowNull('consume_daily_rate_limit', [
    'global',
    'youtube-search-day',
    dailyBudget('YOUTUBE_DAILY_SEARCH_BUDGET', DEFAULT_DAILY_SEARCH_BUDGET),
  ]) as { allowed?: boolean } | null;
  charged.push('global');
  if (daily?.allowed !== true) {
    await refundCharged();
    return jsonResponse({
      available: false,
      results: [],
      message: 'Search is resting for today. Try again tomorrow.',
    });
  }

  const target = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&videoSyndicated=true&maxResults=10&key=' +
    encodeURIComponent(apiKey) + '&q=' + encodeURIComponent(query);

  let upstream: Response;
  try {
    upstream = await fetch(target, { signal: AbortSignal.timeout(6000) });
  } catch {
    await refundCharged();
    throw new HttpError('SEARCH_UNAVAILABLE', 503, 'YouTube search is unavailable right now');
  }
  if (!upstream.ok) {
    await refundCharged();
    throw new HttpError('SEARCH_UNAVAILABLE', 503, 'YouTube search is unavailable right now');
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    await refundCharged();
    throw new HttpError('SEARCH_UNAVAILABLE', 503, 'YouTube search returned an unreadable response');
  }

  const results = mapSearchResponse(payload);
  await writeSearchCache(cacheKey, results);
  return jsonResponse({ available: true, results });
}

export async function youtubePopular(request: Request, caller: Caller): Promise<Response> {
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  await requireRoomAccess(request, caller, roomId);

  const apiKey = process.env.YOUTUBE_API_KEY ?? '';
  if (apiKey.length === 0) {
    return jsonResponse({
      available: false,
      results: [],
      message: 'Karaoke picks are not configured. Ask the host to enable YouTube search.',
    });
  }

  await enforceLimit('consume_rate_limit', [
    caller.userId,
    'youtube-popular-member',
    30,
    60,
  ], 'Karaoke picks are busy. Try again shortly.');

  if (popularCached !== null && Date.now() - popularCached.at < POPULAR_CACHE_TTL_MS) {
    return jsonResponse({ available: true, results: pickPopularCards(popularCached.results) });
  }

  const persisted = await readSearchCache(POPULAR_CACHE_KEY);
  if (persisted !== null && persisted.length > 0) {
    popularCached = { at: Date.now(), results: persisted };
    return jsonResponse({ available: true, results: pickPopularCards(persisted) });
  }

  const daily = await queryAllowNull('consume_daily_rate_limit', [
    'global',
    'youtube-popular-day',
    dailyBudget('YOUTUBE_DAILY_POPULAR_BUDGET', DEFAULT_DAILY_POPULAR_BUDGET),
  ]) as { allowed?: boolean } | null;
  if (daily?.allowed !== true) {
    throw new HttpError('RATE_LIMITED', 429, 'Karaoke picks are resting right now');
  }

  const refund = async (): Promise<void> => {
    try {
      await queryAllowNull('refund_daily_rate_limit', ['global', 'youtube-popular-day']);
    } catch (error) {
      logFailure('youtube-popular/refund', error, 500, request);
    }
  };

  const target = buildPopularSearchUrl(apiKey);

  let response: Response;
  try {
    response = await fetch(target, { signal: AbortSignal.timeout(6000) });
  } catch {
    await refund();
    throw new HttpError('SEARCH_UNAVAILABLE', 503, 'Karaoke picks are unavailable right now');
  }
  if (!response.ok) {
    await refund();
    throw new HttpError('SEARCH_UNAVAILABLE', 503, 'Karaoke picks are unavailable right now');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    await refund();
    throw new HttpError('SEARCH_UNAVAILABLE', 503, 'Karaoke picks returned an unreadable response');
  }

  const pool = selectPopularResults(payload);
  if (pool.length > 0) {
    await writeSearchCache(POPULAR_CACHE_KEY, pool, POPULAR_CACHE_TTL_SECONDS);
    popularCached = { at: Date.now(), results: pool };
  }
  return jsonResponse({ available: true, results: pickPopularCards(pool) });
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
  if (!suggestCache.has(query) && suggestCache.size >= SUGGEST_CACHE_MAX) {
    const oldest = suggestCache.keys().next().value;
    if (oldest !== undefined) suggestCache.delete(oldest);
  }
  suggestCache.set(query, { at: Date.now(), suggestions });
  return suggestions;
}

export async function youtubeSuggest(request: Request, caller: Caller): Promise<Response> {
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  const query = requireQuery(body.query, 2);
  await requireRoomAccess(request, caller, roomId);

  await enforceLimit('consume_rate_limit', [
    caller.userId,
    'youtube-suggest-member',
    60,
    60,
  ], 'Suggestions are busy. Try again in a moment.');

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
