import { describe, expect, it } from 'vitest';
import { buildJoinUrl } from '../../src/features/rooms/roomUrl';

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
});
