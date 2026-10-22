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

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
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
