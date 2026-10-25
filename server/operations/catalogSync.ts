import { HttpError, jsonResponse } from './errors.js';
import { readJsonObject } from './tokens.js';
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
  '@karaoketv',
  '@vinylktv',
  '@titojaymusic',
];

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const MAX_PAGES_PER_CHANNEL = 3;
const PAGE_SIZE = 50;
const DAILY_UNIT_CAP = 40;
const THROTTLE_MS = 6 * 60 * 60 * 1000;
const TIME_BUDGET_MS = 8000;

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

type Cursor = {
  channelId: string;
  uploadsPlaylistId: string;
  nextPageToken: string | null;
  exhaustedAt: string | null;
  lastSyncedAt: string | null;
};

async function queryAllowNull(name: string, params: unknown[]): Promise<unknown> {
  try {
    const call = operationCall(name, params);
    const rows = await serviceDatabase().query(call.text, call.params);
    return (rows[0] as { result?: unknown } | undefined)?.result ?? null;
  } catch {
    return null;
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

  const started = Date.now();
  const cursors = await loadCursors();
  const byChannel = new Map(cursors.map((row) => [row.channelId, row]));
  let added = 0;
  let skipped = 0;

  for (const handle of CATALOG_CHANNELS) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    let cursor = byChannel.get(handle);
    if (cursor !== undefined && cursor.lastSyncedAt !== null
      && Date.now() - Date.parse(cursor.lastSyncedAt) < THROTTLE_MS) {
      skipped += 1;
      continue;
    }

    let playlistId = cursor?.uploadsPlaylistId ?? null;
    if (playlistId === null) {
      const spent = await queryAllowNull('consume_daily_rate_limit', ['global', 'karaoke-catalog-day', DAILY_UNIT_CAP]);
      if ((spent as { allowed?: boolean } | null)?.allowed !== true) break;
      const remaining = TIME_BUDGET_MS - (Date.now() - started);
      if (remaining <= 0) break;
      const response = await fetch(channelUrl(handle, apiKey), {
        signal: AbortSignal.timeout(Math.min(5000, Math.max(250, remaining))),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const items = (payload as { items?: { contentDetails?: { relatedPlaylists?: { uploads?: unknown } } }[] }).items ?? [];
      const uploads = items[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (typeof uploads !== 'string') continue;
      playlistId = uploads;
      await saveCursor(handle, playlistId, null, false);
    }

    let token = cursor?.nextPageToken ?? null;
    for (let page = 0; page < MAX_PAGES_PER_CHANNEL; page += 1) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const spent = await queryAllowNull('consume_daily_rate_limit', ['global', 'karaoke-catalog-day', DAILY_UNIT_CAP]);
      if ((spent as { allowed?: boolean } | null)?.allowed !== true) {
        return jsonResponse({ available: true, added, skipped, message: 'Songbook refresh paused for today' });
      }
      const remaining = TIME_BUDGET_MS - (Date.now() - started);
      if (remaining <= 0) break;
      const response = await fetch(playlistUrl(playlistId, token, apiKey), {
        signal: AbortSignal.timeout(Math.min(5000, Math.max(250, remaining))),
      });
      if (!response.ok) break;
      const payload = await response.json();
      const rows = mapPlaylistItems(payload);
      await upsertRows(handle, rows);
      added += rows.length;
      const next = readNextToken(payload);
      await saveCursor(handle, playlistId, next, next === null);
      if (next === null) break;
      token = next;
    }
  }

  return jsonResponse({ available: true, added, skipped });
}
