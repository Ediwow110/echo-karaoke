import { describe, expect, it } from 'vitest';
import { normalizeDisplayName } from '../../src/features/rooms/displayName';

describe('display names', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeDisplayName('  Ana   Maria  ')).toBe('Ana Maria');
  });

  it('falls back to a guest name when empty', () => {
    expect(normalizeDisplayName('   ', 42)).toBe('Guest 42');
    expect(normalizeDisplayName('', 7)).toBe('Guest 07');
  });

  it('uses a two digit guest suffix', () => {
    expect(normalizeDisplayName('', 5)).toBe('Guest 05');
    expect(normalizeDisplayName('', 99)).toBe('Guest 99');
  });

  it('caps the name at thirty two code points', () => {
    const long = 'a'.repeat(50);
    const result = normalizeDisplayName(long);
    expect(Array.from(result)).toHaveLength(32);
  });

  it('counts Unicode as code points, not bytes', () => {
    const name = '\u{1F3A4}'.repeat(40);
    const result = normalizeDisplayName(name);
    expect(Array.from(result)).toHaveLength(32);
    expect(result).toBe('\u{1F3A4}'.repeat(32));
  });

  it('removes control characters', () => {
    expect(normalizeDisplayName('Li\u0000sa\u001f')).toBe('Lisa');
  });

  it('keeps non Latin names intact', () => {
    expect(normalizeDisplayName('  \u5c71\u7530   \u592a\u90ce ')).toBe('\u5c71\u7530 \u592a\u90ce');
  });
});
