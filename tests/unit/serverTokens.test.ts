import { describe, expect, it } from 'vitest';
import { normalizeDisplayName, readJsonObject } from '../../server/operations/tokens';

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', { method: 'POST', headers, body });
}

describe('server display name normalization', () => {
  it('strips bidi overrides, zero-width marks and control characters', () => {
    expect(normalizeDisplayName('A\u202E\u200FB\u200B\u2066C\u0007')).toBe('ABC');
    expect(normalizeDisplayName('\u202EAna\u202C')).toBe('Ana');
  });

  it('keeps legitimate accented, CJK and emoji text', () => {
    expect(normalizeDisplayName('Zoë 山田 🎤')).toBe('Zoë 山田 🎤');
  });

  it('refuses a name that is only formatting characters', () => {
    expect(() => normalizeDisplayName('\u202E\u200B\u0000')).toThrow(/display name/i);
  });

  it('still collapses whitespace and caps at 32 characters', () => {
    expect(normalizeDisplayName('  Ana   Maria  ')).toBe('Ana Maria');
    expect(normalizeDisplayName('a'.repeat(40))).toHaveLength(32);
  });
});

describe('the server request body limit', () => {
  it('parses a normal JSON body', async () => {
    await expect(readJsonObject(post('{"roomId":"r1"}'))).resolves.toEqual({ roomId: 'r1' });
  });

  it('rejects a declared content length over the streaming cap', async () => {
    await expect(readJsonObject(post('{}', { 'content-length': '20000' })))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: /too large/i });
  });

  it('rejects an oversized body while streaming, before it is fully buffered', async () => {
    const body = JSON.stringify({ name: 'a'.repeat(20000) });
    expect(post(body).headers.get('content-length')).toBeNull();

    await expect(readJsonObject(post(body)))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: /too large/i });
  });

  it('keeps accepting multi-byte text that fits the character limit', async () => {
    const name = '🎤'.repeat(1500);
    const parsed = await readJsonObject(post(JSON.stringify({ name })));

    expect((parsed.name as string).length).toBe(3000);
  });

  it('still enforces the 4096 character limit after decoding', async () => {
    await expect(readJsonObject(post(JSON.stringify({ name: 'a'.repeat(4097) }))))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: /too large/i });
  });
});
