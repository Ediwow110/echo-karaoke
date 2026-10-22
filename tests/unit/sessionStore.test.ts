import { beforeEach, describe, expect, it } from 'vitest';
import { getHostSessionByCode, rememberSession } from '../../src/features/rooms/sessionStore';

describe('room session lookup', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('finds the host session by a formatted room code', () => {
    rememberSession({
      roomId: 'room-a',
      code: 'CD53QS0NZ0SQS0N1',
      roomName: 'Room A',
      hostName: 'Host A',
      role: 'host',
    });

    expect(getHostSessionByCode('cd53 qs0n z0sq s0n1')?.roomId).toBe('room-a');
    expect(getHostSessionByCode('CD53-QS0N-Z0SQ-S0N1')?.roomId).toBe('room-a');
  });

  it('ignores guest sessions with the same code', () => {
    rememberSession({
      roomId: 'room-a',
      code: 'CD53QS0NZ0SQS0N1',
      roomName: 'Room A',
      hostName: 'Host A',
      role: 'guest',
    });

    expect(getHostSessionByCode('CD53QS0NZ0SQS0N1')).toBeNull();
  });

  it('returns null for a room this browser has not hosted', () => {
    expect(getHostSessionByCode('CD53QS0NZ0SQS0N1')).toBeNull();
    expect(getHostSessionByCode('')).toBeNull();
  });
});
