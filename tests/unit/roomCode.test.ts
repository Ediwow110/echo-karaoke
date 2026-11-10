import { describe, expect, it } from 'vitest';
import {
  CROCKFORD_ALPHABET,
  isValidRoomCode,
  normalizeRoomCode,
} from '../../src/features/rooms/roomCode';
import { groupRoomCode } from '../../src/lib/format';

describe('room codes', () => {
  it('uses only Crockford Base32 symbols', () => {
    expect(CROCKFORD_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
    for (const excluded of ['I', 'L', 'O', 'U']) {
      expect(CROCKFORD_ALPHABET).not.toContain(excluded);
    }
  });

  it('normalizes typed codes to the stored form', () => {
    expect(normalizeRoomCode(' abcd-efgh jkmn pqrs ')).toBe('ABCDEFGHJKMNPQRS');
    expect(normalizeRoomCode('O0')).toBe('00');
    expect(normalizeRoomCode('il1')).toBe('111');
  });

  it('accepts new six-character codes and legacy sixteen-character rooms', () => {
    expect(isValidRoomCode('ABC123')).toBe(true);
    expect(isValidRoomCode('ABCDEFGHJKMNPQRS')).toBe(true);
  });

  it('rejects lengths and symbols that cannot be a room code', () => {
    for (const value of ['', 'ABC12', 'ABC1234', 'ABCDEFGHJKMNPQR', 'ABCDEFGHJKMNPQRST']) {
      expect(isValidRoomCode(value), value).toBe(false);
    }
    expect(isValidRoomCode('ABCDEFGHJKMNPQRU')).toBe(false);
  });

  it('accepts ambiguous characters only after normalization', () => {
    expect(isValidRoomCode('ABCDEFGHJKMNPQRI')).toBe(false);
    expect(isValidRoomCode(normalizeRoomCode('ABCDEFGHJKMNPQRI'))).toBe(true);
    expect(isValidRoomCode('ABC12O')).toBe(false);
    expect(isValidRoomCode(normalizeRoomCode('ABC12O'))).toBe(true);
  });

  it('groups six characters in threes and legacy codes in fours', () => {
    expect(groupRoomCode('ABC123')).toBe('ABC 123');
    expect(groupRoomCode('ABCDEFGHJKMNPQRS')).toBe('ABCD EFGH JKMN PQRS');
  });
});
