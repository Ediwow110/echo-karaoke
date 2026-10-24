import { describe, expect, it } from 'vitest';
import { requireRoomId } from '../../server/operations/room';

const valid = '3a1ee27f-a539-4190-9250-bdc14ff631e0';

describe('room operation identifiers', () => {
  it('accepts a UUID and rejects a hyphen-shaped string', () => {
    expect(requireRoomId(valid)).toBe(valid);
    expect(() => requireRoomId('-'.repeat(36))).toThrow('A room identifier is required');
  });
});
