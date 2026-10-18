import { describe, expect, it } from 'vitest';
import {
  CROCKFORD_ALPHABET,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from '../../src/features/rooms/roomCode';

describe('room codes', () => {
  it('uses only Crockford Base32 symbols', () => {
    expect(CROCKFORD_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
    for (const excluded of ['I', 'L', 'O', 'U']) {
      expect(CROCKFORD_ALPHABET).not.toContain(excluded);
    }
  });

  it('generates sixteen symbol codes', () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(16);
    expect(isValidRoomCode(code)).toBe(true);
  });

  it('generates distinct codes across repeated calls', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateRoomCode()));
    expect(codes.size).toBe(200);
  });

  it('normalizes typed codes to the stored form', () => {
    expect(normalizeRoomCode(' abcd-efgh jkmn pqrs ')).toBe('ABCDEFGHJKMNPQRS');
    expect(normalizeRoomCode('O0')).toBe('00');
    expect(normalizeRoomCode('il1')).toBe('111');
  });

  it('rejects codes that are not sixteen valid symbols', () => {
    expect(isValidRoomCode('')).toBe(false);
    expect(isValidRoomCode('ABC')).toBe(false);
    expect(isValidRoomCode('ABCDEFGHJKMNPQRST')).toBe(false);
    expect(isValidRoomCode('ABCDEFGHJKMNPQRU')).toBe(false);
  });

  it('accepts ambiguous characters only after normalization', () => {
    expect(isValidRoomCode('ABCDEFGHJKMNPQRI')).toBe(false);
    expect(isValidRoomCode(normalizeRoomCode('ABCDEFGHJKMNPQRI'))).toBe(true);
  });
});
