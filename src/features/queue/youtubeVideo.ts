const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const PATH_PREFIXES = new Set(['embed', 'shorts', 'v', 'live']);

function validId(candidate: string | null): string | null {
  if (candidate === null) {
    return null;
  }
  return VIDEO_ID.test(candidate) ? candidate : null;
}

function fromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    return null;
  }

  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  const isShortHost = host === 'youtu.be' || host === 'www.youtu.be';

  if (isShortHost) {
    if (segments.length !== 1) {
      return null;
    }
    return validId(segments[0]);
  }

  if (segments.length === 0) {
    return null;
  }

  if (segments[0] === 'watch') {
    if (segments.length !== 1) {
      return null;
    }
    return validId(url.searchParams.get('v'));
  }

  if (PATH_PREFIXES.has(segments[0])) {
    if (segments.length !== 2) {
      return null;
    }
    return validId(segments[1]);
  }

  return null;
}

export function parseYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.includes('://')) {
    return fromUrl(trimmed);
  }

  return validId(trimmed);
}
