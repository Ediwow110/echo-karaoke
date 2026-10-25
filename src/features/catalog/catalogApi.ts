import type { EdgeApi } from '../../lib/edgeApi';
import { loadGuestToken, loadHostToken } from '../rooms/tokenStore';
import { addSong } from '../queue/queueApi';

export type CatalogSong = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
};

export type CatalogPage = { total: number; items: CatalogSong[] };

export const CATALOG_CHANNEL_LABELS: { id: string; label: string }[] = [
  { id: '@musisikaraoke', label: 'Musisi Karaoke' },
  { id: '@singking', label: 'Sing King' },
  { id: '@vinylktv', label: 'Vinyl KTV' },
  { id: '@titojaymusicofficial', label: 'Tito Jay' },
];

function tokensFor(roomId: string): { hostToken?: string; guestToken?: string } {
  const hostToken = loadHostToken(roomId);
  if (hostToken !== null) return { hostToken };
  const guestToken = loadGuestToken(roomId);
  return guestToken === null ? {} : { guestToken };
}

export async function readCatalogPage(
  api: EdgeApi,
  roomId: string,
  params: { query?: string; channel?: string; offset?: number; limit?: number } = {},
): Promise<CatalogPage> {
  return api.invoke<CatalogPage>('catalog-page', {
    roomId,
    query: params.query ?? '',
    channel: params.channel ?? '',
    offset: params.offset ?? 0,
    limit: params.limit ?? 30,
  }, tokensFor(roomId));
}

export async function queueCatalogSong(api: EdgeApi, roomId: string, videoId: string): Promise<void> {
  await addSong(api, roomId, videoId);
}

export type CatalogSyncResult = {
  available: boolean;
  added: number;
  skipped: number;
  unresolved?: string[];
  unreachable?: string[];
  message?: string;
};

// The function is allowed to work for the sync's own 8-second budget and then
// drain the page it is on, so the default 10s abort would report a refresh that
// actually succeeded as "the room service could not be reached" — and invite a
// second press. Pinned above that budget by tests/unit/catalogSyncTimeout.test.ts.
export const CATALOG_SYNC_TIMEOUT_MS = 20_000;

export async function runCatalogSync(api: EdgeApi, roomId: string): Promise<CatalogSyncResult> {
  return api.invoke<CatalogSyncResult>('catalog-sync', { roomId }, {
    hostToken: loadHostToken(roomId) ?? undefined,
  }, { timeoutMs: CATALOG_SYNC_TIMEOUT_MS });
}
