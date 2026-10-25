import { describe, expect, it } from 'vitest';
import { buildJoinUrl, readJoinCodeFromPath, readRoomIdFromPath } from '../../src/features/rooms/roomUrl';

describe('room urls', () => {
  it('builds an absolute join url', () => {
    expect(buildJoinUrl('https://karaoke.example', 'ABCDEFGHJKMNPQRS')).toBe(
      'https://karaoke.example/join/ABCDEFGHJKMNPQRS',
    );
  });

  it('drops a trailing slash on the origin', () => {
    expect(buildJoinUrl('https://karaoke.example/', 'ABCDEFGHJKMNPQRS')).toBe(
      'https://karaoke.example/join/ABCDEFGHJKMNPQRS',
    );
  });

  it('normalizes the code inside a join path', () => {
    expect(readJoinCodeFromPath('/join/abcd-efgh jkmn pqrs')).toBe('ABCDEFGHJKMNPQRS');
  });

  it('returns null for non join paths', () => {
    expect(readJoinCodeFromPath('/')).toBeNull();
    expect(readJoinCodeFromPath('/join/')).toBeNull();
    expect(readJoinCodeFromPath('/room/x/host')).toBeNull();
  });

  it('rejects malformed percent encoding without crashing', () => {
    expect(() => readJoinCodeFromPath('/join/%E0%A4%A')).not.toThrow();
    expect(readJoinCodeFromPath('/join/%E0%A4%A')).toBeNull();
  });

  it('reads a host room id from the host path', () => {
    expect(readRoomIdFromPath('/room/3a1ee27f-a539-4190-9250-bdc14ff631e0/host')).toBe(
      '3a1ee27f-a539-4190-9250-bdc14ff631e0',
    );
  });

  it('rejects a malformed room id', () => {
    expect(readRoomIdFromPath('/room/not-a-room/host')).toBeNull();
  });

  it('does not crash on malformed encoded room IDs or injected separators', () => {
    expect(() => readRoomIdFromPath('/room/%E0%A4%A/host')).not.toThrow();
    expect(readRoomIdFromPath('/room/%E0%A4%A/host')).toBeNull();
    expect(readRoomIdFromPath('/room/3a1ee27f-a539-4190-9250-bdc14ff631e0%2Fhost')).toBeNull();
  });

  it('reads a guest room id from the guest path', () => {
    expect(readRoomIdFromPath('/room/3a1ee27f-a539-4190-9250-bdc14ff631e0')).toBe(
      '3a1ee27f-a539-4190-9250-bdc14ff631e0',
    );
  });
});
