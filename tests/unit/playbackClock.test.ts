import { describe, expect, it } from 'vitest';
import { estimatePosition } from '../../src/features/playback/playbackClock';

describe('the guest playback clock', () => {
  it('advances from the last reported position while playing', () => {
    const now = Date.parse('2026-10-22T10:00:10.000Z');
    expect(estimatePosition({
      positionSeconds: 30,
      isPlaying: true,
      updatedAt: '2026-10-22T10:00:00.000Z',
    }, now)).toBe(40);
  });

  it('holds the last position while paused', () => {
    expect(estimatePosition({
      positionSeconds: 30,
      isPlaying: false,
      updatedAt: '2026-10-22T10:00:00.000Z',
    }, Date.parse('2026-10-22T10:00:10.000Z'))).toBe(30);
  });

  it('falls back safely when the timestamp is missing or invalid', () => {
    expect(estimatePosition(undefined)).toBe(0);
    expect(estimatePosition({ positionSeconds: 9, isPlaying: true, updatedAt: null })).toBe(9);
    expect(estimatePosition({ positionSeconds: 9, isPlaying: true, updatedAt: 'not a date' })).toBe(9);
  });
});
