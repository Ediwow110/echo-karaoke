import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = 'supabase/migrations';

// The newest migration that schedules the sweep wins; the window there is the
// one the production database actually enforces.
function sweepMinutes(): number {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .reverse();
  for (const file of files) {
    const sql = readFileSync(MIGRATIONS + '/' + file, 'utf8');
    const match = sql.match(
      /cleanup_abandoned_rooms\(\s*now\(\)\s*-\s*interval\s*'(\d+) minutes'/,
    );
    if (match !== null) {
      return Number(match[1]);
    }
  }
  throw new Error('the abandoned-room sweep interval could not be found');
}

function source(path: string): string {
  // JSX wraps prose across lines; compare against the rendered words.
  return readFileSync(path, 'utf8').replace(/\s+/g, ' ');
}

describe('room lifetime copy', () => {
  it('quotes the real abandoned-room window instead of promising the room outlives the host', () => {
    // The sweep deletes a room once no member has been seen for the window,
    // so "stays live until the host ends it" is a promise the database does
    // not keep: a closed tab loses the room after the window, not never.
    const minutes = sweepMinutes();
    expect(minutes).toBe(30); // control: the parse found the live cron argument

    const phrase = 'nobody has been online for ' + minutes + ' minutes';
    expect(source('src/app/HostSettingsPage.tsx')).toContain(phrase);
    expect(source('src/features/rooms/InviteCard.tsx')).toContain(phrase);
  });
});
