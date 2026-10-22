import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('queue metadata rate limiting', () => {
  it('checks the member minute limit before consuming the shared daily budget', () => {
    const source = readFileSync('supabase/functions/queue-command/index.ts', 'utf8');
    const member = source.indexOf("'queue-metadata', 10, 60");
    const daily = source.indexOf("'queue-metadata-day'");
    const lookup = source.indexOf('fetchVideoMetadata(videoId)');

    expect(member).toBeGreaterThan(-1);
    expect(daily).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(-1);
    expect(member).toBeLessThan(daily);
    expect(daily).toBeLessThan(lookup);
  });
});
