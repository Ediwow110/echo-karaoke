export type VideoMetadata = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

type OEmbedPayload = {
  title?: unknown;
  author_name?: unknown;
  thumbnail_url?: unknown;
};

export function isValidVideoId(value: unknown): value is string {
  return typeof value === 'string' && VIDEO_ID.test(value);
}

export async function fetchVideoMetadata(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VideoMetadata | null> {
  if (!isValidVideoId(videoId)) {
    return null;
  }

  const target = 'https://www.youtube.com/oembed?format=json&url=' +
    encodeURIComponent('https://www.youtube.com/watch?v=' + videoId);

  let response: Response;
  try {
    response = await fetchImpl(target, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  let payload: OEmbedPayload;
  try {
    payload = (await response.json()) as OEmbedPayload;
  } catch {
    return null;
  }

  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (title.length === 0) {
    return null;
  }

  return {
    videoId,
    title: title.slice(0, 500),
    channelTitle: typeof payload.author_name === 'string' ? payload.author_name.slice(0, 200) : null,
    thumbnailUrl: typeof payload.thumbnail_url === 'string' ? payload.thumbnail_url.slice(0, 500) : null,
    durationSeconds: null,
  };
}

export type SearchResult = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
};

type Thumbnail = { url?: unknown };
type SearchItem = {
  id?: { videoId?: unknown };
  snippet?: {
    title?: unknown;
    channelTitle?: unknown;
    thumbnails?: { medium?: Thumbnail; default?: Thumbnail; high?: Thumbnail };
  };
};

const MAX_RESULTS = 10;

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
  if (payload === null || typeof payload !== 'object') {
    return [];
  }

  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    return [];
  }

  const mapped: SearchResult[] = [];
  for (const raw of items) {
    const item = raw as SearchItem | null;
    const videoId = item?.id?.videoId;
    if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId)) {
      continue;
    }
    const title = text(item?.snippet?.title, 500);
    if (title === null) {
      continue;
    }

    const thumbnails = item?.snippet?.thumbnails;
    const thumbnail =
      text(thumbnails?.medium?.url, 500) ??
      text(thumbnails?.high?.url, 500) ??
      text(thumbnails?.default?.url, 500);

    mapped.push({
      videoId,
      title: decodeEntities(title),
      channelTitle: text(item?.snippet?.channelTitle, 200),
      thumbnailUrl: thumbnail,
      durationSeconds: null,
    });

    if (mapped.length === MAX_RESULTS) {
      break;
    }
  }

  return mapped;
}

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
