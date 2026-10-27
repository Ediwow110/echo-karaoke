import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HIDDEN_HEARTBEAT_MS, VISIBLE_HEARTBEAT_MS } from '../../src/features/rooms/useRoomData';
import { HEARTBEAT_MS as HOST_HEARTBEAT_MS } from '../../src/features/rooms/useHostedRoom';

/**
 * The presence window the read functions use to decide whether a member is
 * "online". Read from the newest migration that projects it, so a change on
 * either side of the boundary has to be deliberate.
 */
function presenceWindowSeconds(): number {
  const dir = 'supabase/migrations';
  let seconds: number | null = null;
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
    const text = readFileSync(dir + '/' + file, 'utf8');
    const match = /'online',\s*m\.last_seen_at > now\(\) - interval '(\d+) seconds'/.exec(text);
    if (match !== null) {
      seconds = Number(match[1]);
    }
  }
  if (seconds === null) {
    throw new Error('no presence window found in the migrations');
  }
  return seconds;
}

describe('heartbeats stay inside the presence window', () => {
  it('finds the projection it is measuring', () => {
    // A positive control for the parse above: a missing or renamed projection
    // must fail loudly instead of comparing against nothing.
    expect(presenceWindowSeconds()).toBe(30);
  });

  it('keeps every heartbeat comfortably inside the window', () => {
    // A heartbeat that drifts past the window makes a member who is present
    // read as away: guests see "the host screen is offline" mid-song, and the
    // roster moves people to the Away rows while they are still in the room.
    const windowMs = presenceWindowSeconds() * 1000;

    expect(VISIBLE_HEARTBEAT_MS).toBeLessThan(windowMs);
    expect(HIDDEN_HEARTBEAT_MS).toBeLessThan(windowMs);
    expect(HOST_HEARTBEAT_MS).toBeLessThan(windowMs);
  });
});
