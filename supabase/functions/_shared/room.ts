import { createClient } from 'npm:@supabase/supabase-js@2';

export type EdgeError = {
  code: string;
  status: number;
  message: string;
};

const ERROR_MAP: Record<string, { status: number; message: string }> = {
  UNAUTHORIZED: { status: 401, message: 'A valid room token is required' },
  ROOM_NOT_FOUND: { status: 404, message: 'No room uses that code' },
  ROOM_ENDED: { status: 409, message: 'This room has ended' },
  GUEST_CONTROLS_LOCKED: { status: 403, message: 'The host locked guest controls' },
  VALIDATION_ERROR: { status: 400, message: 'The request is invalid' },
};

export class HttpError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const allowOrigin = allowed.length === 0
    ? (origin ?? '*')
    : (origin !== null && allowed.includes(origin) ? origin : allowed[0]);

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-room-guest-token, x-room-host-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function jsonResponse(
  body: unknown,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
    },
  });
}

export function optionsResponse(origin: string | null): Response {
  return new Response('ok', { status: 204, headers: corsHeaders(origin) });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value.length === 0) {
    throw new HttpError('SERVER_MISCONFIGURED', 500, 'The server is not configured');
  }
  return value;
}

export function serviceClient() {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Caller = {
  userId: string;
  accessToken: string;
};

export async function requireAnonymousCaller(req: Request): Promise<Caller> {
  const header = req.headers.get('Authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    throw new HttpError('UNAUTHORIZED', 401, 'A signed-in session is required');
  }

  const accessToken = header.slice('bearer '.length).trim();
  if (accessToken.length === 0) {
    throw new HttpError('UNAUTHORIZED', 401, 'A signed-in session is required');
  }

  const authClient = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: 'Bearer ' + accessToken } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await authClient.auth.getUser();
  if (error !== null || data.user === null) {
    throw new HttpError('UNAUTHORIZED', 401, 'The session is not valid');
  }
  if (data.user.is_anonymous !== true) {
    throw new HttpError('FORBIDDEN', 403, 'Only anonymous guest sessions may use this endpoint');
  }

  return { userId: data.user.id, accessToken };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateRoomCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) {
    code += CROCKFORD[byte % CROCKFORD.length];
  }
  return code;
}

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError('VALIDATION_ERROR', 400, 'A display name is required');
  }
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    throw new HttpError('VALIDATION_ERROR', 400, 'A display name is required');
  }
  return Array.from(trimmed).slice(0, 32).join('').trim();
}

export function requireRoomId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(value)) {
    throw new HttpError('VALIDATION_ERROR', 400, 'A room identifier is required');
  }
  return value;
}

export function requireTokenHeader(req: Request, name: string): string {
  const value = req.headers.get(name);
  if (value === null || value.trim().length < 32) {
    throw new HttpError('UNAUTHORIZED', 401, 'A valid room token is required');
  }
  return value.trim();
}

export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 4096) {
    throw new HttpError('VALIDATION_ERROR', 400, 'The request body is too large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError('VALIDATION_ERROR', 400, 'The request body must be JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError('VALIDATION_ERROR', 400, 'The request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function mapDatabaseError(error: { message?: string } | null): HttpError {
  const raw = error?.message ?? '';
  for (const code of Object.keys(ERROR_MAP)) {
    if (raw.includes(code)) {
      const mapped = ERROR_MAP[code];
      return new HttpError(code, mapped.status, mapped.message);
    }
  }
  return new HttpError('INTERNAL_ERROR', 500, 'The request could not be completed');
}

export function handleThrown(error: unknown, origin: string | null): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, error.status, origin);
  }
  return jsonResponse(
    { error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed' } },
    500,
    origin,
  );
}
