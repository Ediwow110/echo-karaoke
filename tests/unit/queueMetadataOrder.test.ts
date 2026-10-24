import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('server queue metadata rate limiting', () => {
  it('preflights and checks both daily tiers before the outbound lookup', () => {
    const source = readFileSync('server/operations/queue.ts', 'utf8');
    const preflight = source.indexOf("'queue_add_preflight'");
    const member = source.indexOf("'queue-metadata', 10, 60");
    const room = source.indexOf("'room:' + roomId");
    const daily = source.indexOf("'queue-metadata-day'");
    const lookup = source.indexOf('fetchVideoMetadata(videoId)');

    expect(preflight).toBeGreaterThan(-1);
    expect(member).toBeGreaterThan(-1);
    expect(room).toBeGreaterThan(-1);
    expect(daily).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(member);
    expect(member).toBeLessThan(room);
    expect(room).toBeLessThan(daily);
    expect(daily).toBeLessThan(lookup);
  });
});
