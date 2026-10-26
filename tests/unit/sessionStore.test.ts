import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetSession,
  getHostedRoom,
  getHostSessionByCode,
  getLastRoom,
  rememberSession,
} from '../../src/features/rooms/sessionStore';
import { clearRoomTokens, saveHostToken } from '../../src/features/rooms/tokenStore';

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

describe('the hosted room a host can come back to', () => {
  beforeEach(() => {
    localStorage.clear();
    // The token store keeps a tab-local copy of every pass, so clearing the
    // storage alone would leave the previous test's pass behind.
    clearRoomTokens('room-a');
  });

  it('offers the hosted room this browser still holds a pass for', () => {
    saveHostToken('room-a', 'host-pass');
    rememberSession({
      roomId: 'room-a',
      code: 'CD53QS0NZ0SQS0N1',
      roomName: 'Room A',
      hostName: 'Host A',
      role: 'host',
    });

    expect(getHostedRoom()?.roomId).toBe('room-a');
  });

  it('offers the most recent hosted room', () => {
    saveHostToken('room-a', 'host-pass');
    saveHostToken('room-b', 'host-pass');
    rememberSession({
      roomId: 'room-a',
      code: 'CD53QS0NZ0SQS0N1',
      roomName: 'Room A',
      hostName: 'Host A',
      role: 'host',
    });
    rememberSession({
      roomId: 'room-b',
      code: 'CD53QS0NZ0SQS0N2',
      roomName: 'Room B',
      hostName: 'Host A',
      role: 'host',
    });

    expect(getHostedRoom()?.roomId).toBe('room-b');
  });

  it('offers nothing when the host pass is gone', () => {
    rememberSession({
      roomId: 'room-a',
      code: 'CD53QS0NZ0SQS0N1',
      roomName: 'Room A',
      hostName: 'Host A',
      role: 'host',
    });

    expect(getHostedRoom()).toBeNull();
  });

  it('offers nothing for a room this browser only joined', () => {
    rememberSession({
      roomId: 'room-b',
      code: 'CD53QS0NZ0SQS0N1',
      roomName: 'Room B',
      hostName: 'Host B',
      role: 'guest',
    });

    expect(getHostedRoom()).toBeNull();
  });

  it('forgets an ended room so it is never offered again', () => {
    saveHostToken('room-a', 'host-pass');
    rememberSession({
      roomId: 'room-a',
      code: 'CD53QS0NZ0SQS0N1',
      roomName: 'Room A',
      hostName: 'Host A',
      role: 'host',
    });

    forgetSession('room-a');

    expect(getHostedRoom()).toBeNull();
    expect(getLastRoom()).toBeNull();
  });
});
