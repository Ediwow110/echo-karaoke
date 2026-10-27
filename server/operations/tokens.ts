import { HttpError } from './errors.js';

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
  return Buffer.from(bytes).toString('base64url');
}

// Bidi overrides and zero-width marks let a name paint over the roster and the
// queue attribution; C0/C1 controls do the same with invisible noise. The client
// strips them, but a direct caller never goes through the client.
const CONTROL_AND_BIDI = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

export function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError('VALIDATION_ERROR', 400, 'A display name is required');
  }
  const trimmed = value.replace(CONTROL_AND_BIDI, '').trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    throw new HttpError('VALIDATION_ERROR', 400, 'A display name is required');
  }
  return Array.from(trimmed).slice(0, 32).join('').trim();
}

export function normalizeRoomName(value: unknown): string {
  if (value === undefined || value === null) {
    return 'Karaoke room';
  }
  if (typeof value !== 'string') {
    throw new HttpError('VALIDATION_ERROR', 400, 'A room name is required');
  }
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    return 'Karaoke room';
  }
  return Array.from(trimmed).slice(0, 48).join('').trim();
}

export function readOptionalBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw new HttpError('VALIDATION_ERROR', 400, 'A permission must be true or false');
  }
  return value;
}

const BODY_CHARACTER_LIMIT = 4096;
// UTF-8 uses at most four bytes per UTF-16 code unit, so this byte ceiling can
// never reject text that fits the character limit, while the stream is bounded
// before the platform has buffered the whole request.
const BODY_BYTE_LIMIT = BODY_CHARACTER_LIMIT * 4;

function bodyTooLarge(): HttpError {
  return new HttpError('VALIDATION_ERROR', 400, 'The request body is too large');
}

async function readBoundedText(request: Request): Promise<string> {
  const body = request.body;
  if (body === null) {
    return '';
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return text + decoder.decode();
      }
      bytes += value.byteLength;
      if (bytes > BODY_BYTE_LIMIT) {
        await reader.cancel().catch(() => undefined);
        throw bodyTooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > BODY_BYTE_LIMIT) {
    throw bodyTooLarge();
  }
  const text = await readBoundedText(request);
  if (text.length > BODY_CHARACTER_LIMIT) {
    throw bodyTooLarge();
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
