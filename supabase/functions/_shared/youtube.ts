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
