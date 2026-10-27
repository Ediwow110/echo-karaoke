import { HttpError, jsonResponse, logFailure } from './errors.js';
import { generateToken, readJsonObject } from './tokens.js';
import { requireRoomId, type Caller } from './room.js';
import { operationCall, serviceDatabase } from '../db/client.js';
import { requireHostAccess } from './catalogAccess.js';

export type CatalogRow = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
};

export const CATALOG_CHANNELS = [
  '@musisikaraoke',
  '@singking',
  '@vinylktv',
  '@titojaymusicofficial',
];

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const MAX_PAGES_PER_CHANNEL = 3;
const PAGE_SIZE = 50;
const DAILY_UNIT_CAP = 40;
const THROTTLE_MS = 6 * 60 * 60 * 1000;
export const TIME_BUDGET_MS = 8000;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function paragraph(value: unknown, limit: number): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? decodeEntities(value.trim()).slice(0, limit)
    : null;
}

export function mapPlaylistItems(payload: unknown): CatalogRow[] {
  const items = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const rows: CatalogRow[] = [];
  for (const raw of items) {
    if (raw === null || typeof raw !== 'object') continue;
    const item = raw as {
      snippet?: { title?: unknown; channelTitle?: unknown; publishedAt?: unknown; thumbnails?: Record<string, { url?: unknown }> };
      contentDetails?: { videoId?: unknown };
    };
    const videoId = item.contentDetails?.videoId;
    if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId)) continue;
    const title = paragraph(item.snippet?.title, 500);
    if (title === null) continue;
    const thumbs = item.snippet?.thumbnails ?? {};
    const thumb = [thumbs.medium?.url, thumbs.high?.url, thumbs.default?.url]
      .find((value): value is string => typeof value === 'string') ?? null;
    rows.push({
      videoId,
      title,
      channelTitle: paragraph(item.snippet?.channelTitle, 120),
      thumbnailUrl: thumb,
      publishedAt: typeof item.snippet?.publishedAt === 'string' ? item.snippet.publishedAt : null,
    });
  }
  return rows;
}

export function readNextToken(payload: unknown): string | null {
  const token = (payload as { nextPageToken?: unknown } | null)?.nextPageToken;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

function playlistUrl(playlistId: string, pageToken: string | null, apiKey: string): string {
  const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
  url.searchParams.set('part', 'snippet,contentDetails');
  url.searchParams.set('maxResults', String(PAGE_SIZE));
  url.searchParams.set('playlistId', playlistId);
  if (pageToken !== null) url.searchParams.set('pageToken', pageToken);
  url.searchParams.set('key', apiKey);
  return url.toString();
}

function channelUrl(handle: string, apiKey: string): string {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'contentDetails');
  url.searchParams.set('forHandle', handle);
  url.searchParams.set('key', apiKey);
  return url.toString();
}

type UpstreamPage =
  | { state: 'ok'; payload: unknown }
  | { state: 'http-error' }
  | { state: 'stopped' };

function isAbortError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

async function fetchUpstream(url: string, timeoutMs: number, request: Request): Promise<UpstreamPage> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { state: 'http-error' };
    return { state: 'ok', payload: await response.json() };
  } catch (error) {
    if (!isAbortError(error)) throw error;
    // The budget or the platform cancelled a slow upstream call after quota
    // was spent. Keep the rows already synced instead of failing the request.
    logFailure('catalog-sync', error, 500, request);
    return { state: 'stopped' };
  }
}

type Cursor = {
  channelId: string;
  uploadsPlaylistId: string;
  nextPageToken: string | null;
  exhaustedAt: string | null;
  lastSyncedAt: string | null;
};

/**
 * Ask the daily limiter, and fail loudly when the limiter itself cannot answer.
 * Its only return shape is a jsonb object with `allowed`, so a swallowed error
 * used to be indistinguishable from a refusal — and a database failure was
 * reported to the host as "paused for today", a false cause they would believe
 * until the Pacific-day reset.
 */
async function quotaAllows(name: string, params: unknown[]): Promise<boolean> {
  const call = operationCall(name, params);
  const rows = await serviceDatabase().query(call.text, call.params);
  const result = (rows[0] as { result?: unknown } | undefined)?.result;
  if (result === null || typeof result !== 'object') {
    throw new HttpError('INTERNAL_ERROR', 500, 'The songbook budget could not be checked. Try again.');
  }
  return (result as { allowed?: unknown }).allowed === true;
}

/**
 * Claim the right to walk the catalog. The holder is a fresh random token per
 * request, so a walk resumed across requests renews its own lease and nobody else
 * can release it. A lease that cannot be read is a failure, not a free pass: the
 * guard is only worth having if a broken one stops the walk rather than excusing it.
 */
async function takeCatalogLease(holder: string): Promise<boolean> {
  const call = operationCall('karaoke_catalog_lease_take', [holder]);
  const rows = await serviceDatabase().query(call.text, call.params);
  const result = (rows[0] as { result?: unknown } | undefined)?.result;
  if (result === null || typeof result !== 'object') {
    throw new HttpError('INTERNAL_ERROR', 500, 'The songbook refresh could not be checked. Try again.');
  }
  return (result as { acquired?: unknown }).acquired === true;
}

/**
 * Give the claim back. A failed release is not worth an error the caller cannot act
 * on: the lease expires on its own four minutes later, which is the same outcome
 * with a shorter wait than a failed refresh response.
 */
async function releaseCatalogLease(holder: string): Promise<void> {
  const call = operationCall('karaoke_catalog_lease_release', [holder]);
  try {
    await serviceDatabase().query(call.text, call.params);
  } catch (caught) {
    logFailure('catalog lease release', caught);
  }
}

async function loadCursors(): Promise<Cursor[]> {
  const call = operationCall('karaoke_catalog_cursors', []);
  const rows = await serviceDatabase().query(call.text, call.params);
  return ((rows[0] as { result?: Cursor[] } | undefined)?.result ?? []) as Cursor[];
}

async function saveCursor(
  channelId: string,
  playlistId: string,
  token: string | null,
  exhausted: boolean,
): Promise<void> {
  const call = operationCall('karaoke_catalog_cursor_save', [channelId, playlistId, token, exhausted]);
  await serviceDatabase().query(call.text, call.params);
}

async function upsertRows(channelId: string, rows: CatalogRow[]): Promise<void> {
  if (rows.length === 0) return;
  const call = operationCall('karaoke_catalog_upsert', [channelId, JSON.stringify(rows)]);
  await serviceDatabase().query(call.text, call.params);
}

type HandleLookup
  = | { state: 'ok'; playlistId: string }
    | { state: 'unreachable' }
    | { state: 'unresolved' }
    | { state: 'out-of-budget' }
    | { state: 'stopped' };

/** Resolve a handle to its uploads playlist, buying exactly one quota unit. */
async function lookupUploadsPlaylist(
  handle: string,
  apiKey: string,
  request: Request,
  started: number,
): Promise<HandleLookup> {
  if (!(await quotaAllows('consume_daily_rate_limit', ['global', 'karaoke-catalog-day', DAILY_UNIT_CAP]))) {
    return { state: 'out-of-budget' };
  }
  const remaining = TIME_BUDGET_MS - (Date.now() - started);
  if (remaining <= 0) return { state: 'out-of-budget' };
  const upstream = await fetchUpstream(
    channelUrl(handle, apiKey),
    Math.min(5000, Math.max(250, remaining)),
    request,
  );
  if (upstream.state === 'stopped') return { state: 'stopped' };
  if (upstream.state === 'http-error') return { state: 'unreachable' };
  const items = (upstream.payload as { items?: { contentDetails?: { relatedPlaylists?: { uploads?: unknown } } }[] }).items ?? [];
  const uploads = items[0]?.contentDetails?.relatedPlaylists?.uploads;
  return typeof uploads === 'string' ? { state: 'ok', playlistId: uploads } : { state: 'unresolved' };
}

export async function catalogSync(request: Request, caller: Caller): Promise<Response> {
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  const hostToken = request.headers.get('x-room-host-token');
  if (hostToken === null || hostToken.length === 0) {
    throw new HttpError('FORBIDDEN', 403, 'Only the host can refresh the songbook');
  }
  // Reuse the room-bound check the other operations use.
  await requireHostAccess(caller, roomId, hostToken);

  const apiKey = process.env.YOUTUBE_API_KEY ?? '';
  if (apiKey.length === 0) {
    return jsonResponse({ available: false, added: 0, message: 'YouTube is not configured' });
  }

  // One walk at a time, because the catalog is global: a second host pressing
  // Refresh would fetch the same four channels again and spend about half the
  // daily units on work already under way.
  const holder = generateToken();
  if (!(await takeCatalogLease(holder))) {
    throw new HttpError('CATALOG_REFRESH_RUNNING', 409, 'The songbook is already being refreshed');
  }
  try {
    return await walkCatalog(apiKey, request);
  } finally {
    await releaseCatalogLease(holder);
  }
}

async function walkCatalog(apiKey: string, request: Request): Promise<Response> {
  // Purge aged provider metadata before the next fetch. This RPC is installed
  // by forward-only migration 0033 and must be deployed before this server code.
  const retire = operationCall('karaoke_catalog_retire_stale', []);
  await serviceDatabase().query(retire.text, retire.params);

  const started = Date.now();
  const cursors = await loadCursors();
  const byChannel = new Map(cursors.map((row) => [row.channelId, row]));
  let added = 0;
  let skipped = 0;
  let stoppedEarly = false;
  const unresolved: string[] = [];
  const unreachable: string[] = [];

  channels: for (const handle of CATALOG_CHANNELS) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    let cursor = byChannel.get(handle);
    // The six-hour throttle means "this channel is up to date", so it may only
    // apply to a walk that finished. cursor_save stamps last_synced_at on every
    // page, and the time budget or a bad page can cut a walk short with a page
    // token still pending — throttling that would hide the rest of a channel's
    // songs for six hours behind a skip count.
    if (cursor !== undefined && cursor.lastSyncedAt !== null
      && cursor.nextPageToken === null
      && Date.now() - Date.parse(cursor.lastSyncedAt) < THROTTLE_MS) {
      skipped += 1;
      continue;
    }

    let playlistId = cursor?.uploadsPlaylistId ?? null;
    const fromStoredCursor = playlistId !== null;
    if (playlistId === null) {
      const lookup = await lookupUploadsPlaylist(handle, apiKey, request, started);
      if (lookup.state === 'stopped') {
        stoppedEarly = true;
        break channels;
      }
      if (lookup.state === 'out-of-budget') break;
      if (lookup.state === 'unreachable') {
        // Transient, and it self-heals on the next refresh because no cursor was
        // written — but say so, or "added 0" reads as an empty songbook during a
        // YouTube outage.
        unreachable.push(handle);
        continue;
      }
      if (lookup.state === 'unresolved') {
        // A handle that names no channel is a configuration fact, not a
        // transient failure: the catalog would silently stay one channel short.
        unresolved.push(handle);
        continue;
      }
      playlistId = lookup.playlistId;
      await saveCursor(handle, playlistId, null, false);
    }

    let token = cursor?.nextPageToken ?? null;
    let reconnected = false;
    // The page counter advances only on a served page, so a recovery retry
    // re-asks the same page instead of skipping it.
    for (let page = 0; page < MAX_PAGES_PER_CHANNEL; ) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      if (!(await quotaAllows('consume_daily_rate_limit', ['global', 'karaoke-catalog-day', DAILY_UNIT_CAP]))) {
        return jsonResponse({
          available: true, added, skipped, unresolved, unreachable,
          message: 'Songbook refresh paused for today',
        });
      }
      const remaining = TIME_BUDGET_MS - (Date.now() - started);
      if (remaining <= 0) break;
      const upstream = await fetchUpstream(
        playlistUrl(playlistId, token, apiKey),
        Math.min(5000, Math.max(250, remaining)),
        request,
      );
      if (upstream.state === 'stopped') {
        stoppedEarly = true;
        break channels;
      }
      if (upstream.state === 'http-error') {
        // A cursor can outlive its channel. A renamed or deleted uploads
        // playlist would otherwise be trusted forever and that channel would
        // stop contributing rows in silence, so re-resolve the handle once.
        if (!reconnected && fromStoredCursor && page === 0) {
          reconnected = true;
          const lookup = await lookupUploadsPlaylist(handle, apiKey, request, started);
          if (lookup.state === 'stopped') {
            stoppedEarly = true;
            break channels;
          }
          if (lookup.state === 'out-of-budget') {
            // The page was already paid for; the re-resolve was not. Say the
            // budget ran out instead of blaming a channel that never refused us.
            return jsonResponse({
              available: true, added, skipped, unresolved, unreachable,
              message: 'Songbook refresh paused for today',
            });
          }
          if (lookup.state === 'ok' && lookup.playlistId !== playlistId) {
            playlistId = lookup.playlistId;
            token = null;
            await saveCursor(handle, playlistId, null, false);
            continue;
          }
          if (lookup.state === 'unresolved') unresolved.push(handle);
          if (lookup.state === 'unreachable') unreachable.push(handle);
        }
        // A page cut short is transient and the saved token resumes it next run,
        // but silence here would let a half-filled channel read as a full one.
        if (!unreachable.includes(handle) && !unresolved.includes(handle)) {
          unreachable.push(handle);
        }
        break;
      }
      const rows = mapPlaylistItems(upstream.payload);
      await upsertRows(handle, rows);
      added += rows.length;
      const next = readNextToken(upstream.payload);
      await saveCursor(handle, playlistId, next, next === null);
      if (next === null) break;
      token = next;
      page += 1;
    }
  }

  const notes = [
    stoppedEarly ? 'Songbook refresh stopped early' : null,
    unresolved.length === 0
      ? null
      : 'Songbook refresh could not find: ' + unresolved.join(', '),
    unreachable.length === 0
      ? null
      : 'Songbook refresh could not reach: ' + unreachable.join(', '),
  ].filter((note): note is string => note !== null);

  return jsonResponse({
    available: true,
    added,
    skipped,
    unresolved,
    unreachable,
    ...(notes.length === 0 ? {} : { message: notes.join('. ') }),
  });
}
