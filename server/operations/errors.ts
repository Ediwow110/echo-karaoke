export class HttpError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const ERROR_MAP: Record<string, { status: number; message: string }> = {
  UNAUTHORIZED: { status: 401, message: 'A valid room token is required' },
  ROOM_NOT_FOUND: { status: 404, message: 'No room uses that code' },
  ROOM_ENDED: { status: 409, message: 'This room has ended' },
  ROOM_FULL: { status: 409, message: 'This room is full' },
  HOST_ALREADY_IN_ROOM: { status: 409, message: 'This browser is already hosting this room. Open the host screen instead of joining.' },
  GUEST_CONTROLS_LOCKED: { status: 403, message: 'The host locked guest controls' },
  VALIDATION_ERROR: { status: 400, message: 'The request is invalid' },
  RATE_LIMITED: { status: 429, message: 'Slow down: five songs per minute' },
  ROOM_CREATE_RATE_LIMITED: { status: 429, message: 'Too many rooms created from this session. Try again in an hour.' },
  FORBIDDEN: { status: 403, message: 'That action is not allowed for this room' },
  METADATA_UNAVAILABLE: { status: 422, message: 'That video could not be read' },
  DUPLICATE_SONG: { status: 409, message: 'That song is already in the queue' },
  SONG_PLAYING: { status: 409, message: 'Skip the current song before removing it' },
};

export function mapDatabaseError(error: { message?: string } | null): HttpError {
  const raw = error?.message ?? '';
  if (raw.includes('queue_songs_active_video_key')) {
    return new HttpError('DUPLICATE_SONG', 409, ERROR_MAP.DUPLICATE_SONG.message);
  }
  for (const code of Object.keys(ERROR_MAP).sort((a, b) => b.length - a.length)) {
    if (raw.includes(code)) {
      const mapped = ERROR_MAP[code];
      return new HttpError(code, mapped.status, mapped.message);
    }
  }
  return new HttpError('INTERNAL_ERROR', 500, 'The request could not be completed');
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

export function handleThrown(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
  }
  return jsonResponse(
    { error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed' } },
    500,
  );
}

export function logFailure(
  operation: string,
  error: unknown,
  status = 500,
  request?: Request,
): void {
  const code = error instanceof HttpError
    ? error.code
    : typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'INTERNAL_ERROR';
  const name = error instanceof Error ? error.name : 'UnknownError';
  console[status >= 500 ? 'error' : 'warn'](JSON.stringify({
    level: status >= 500 ? 'error' : 'warn',
    operation,
    status,
    code,
    name,
    requestId: request?.headers.get('x-vercel-id') ?? null,
  }));
}
