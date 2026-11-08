import { describe, expect, it } from 'vitest';
import { sweepIntervalSeconds } from '../../server/operations/sweep';

describe('room sweep interval', () => {
  it('defaults to five minutes', () => {
    expect(sweepIntervalSeconds({})).toBe(300);
  });

  it('allows zero for deterministic tests', () => {
    expect(sweepIntervalSeconds({ ROOM_SWEEP_INTERVAL_SECONDS: '0' })).toBe(0);
  });

  it('treats an empty value as the default', () => {
    expect(sweepIntervalSeconds({ ROOM_SWEEP_INTERVAL_SECONDS: '   ' })).toBe(300);
  });

  it('refuses invalid or out-of-range values', () => {
    expect(sweepIntervalSeconds({ ROOM_SWEEP_INTERVAL_SECONDS: '-1' })).toBe(300);
    expect(sweepIntervalSeconds({ ROOM_SWEEP_INTERVAL_SECONDS: '86401' })).toBe(300);
    expect(sweepIntervalSeconds({ ROOM_SWEEP_INTERVAL_SECONDS: 'nope' })).toBe(300);
  });
});
