import { describe, expect, it } from 'vitest';
import {
  MAX_OFFSET as CLIENT_MAX_OFFSET,
  PAGE_SIZE,
  offersMoreRows,
} from '../../src/features/catalog/SongbookList';
import { MAX_LIMIT, MAX_OFFSET as SERVER_MAX_OFFSET } from '../../server/operations/catalogBrowse';

// The songbook's paging stop depends on two numbers that live in different
// processes: the client's ceiling for offering another page, and the operation's
// clamp on the offset it will honour. Nothing shared them, so drifting one open
// re-opens the bug the other exists to prevent — a Load more that replays the
// same rows forever.
describe('songbook paging cap', () => {
  it('stops paging at the offset the operation clamps at', () => {
    expect(SERVER_MAX_OFFSET).toBeGreaterThan(0);
    expect(CLIENT_MAX_OFFSET).toBe(SERVER_MAX_OFFSET);
  });

  it('asks for no more rows per page than the operation will return', () => {
    // A PAGE_SIZE above the server's limit comes back short, which reads as the
    // end of the catalog and hides Load more while thousands of songs remain.
    expect(PAGE_SIZE).toBeGreaterThan(0);
    expect(PAGE_SIZE).toBeLessThanOrEqual(MAX_LIMIT);
  });

  it('offers the last page that fits and refuses the first one that does not', () => {
    expect(offersMoreRows(PAGE_SIZE, CLIENT_MAX_OFFSET - PAGE_SIZE)).toBe(true);
    expect(offersMoreRows(PAGE_SIZE, CLIENT_MAX_OFFSET)).toBe(false);
    expect(offersMoreRows(PAGE_SIZE, CLIENT_MAX_OFFSET - 1)).toBe(false);
  });

  it('stops on a short page, which is what a clamped limit looks like', () => {
    expect(offersMoreRows(PAGE_SIZE - 1, 0)).toBe(false);
    expect(offersMoreRows(0, 0)).toBe(false);
  });

  it('walks a deep catalog without ever requesting a clamped offset', () => {
    const requested: number[] = [];
    let offset = 0;
    for (let step = 0; step < 1_000; step += 1) {
      requested.push(offset);
      if (!offersMoreRows(PAGE_SIZE, offset + PAGE_SIZE)) break;
      offset += PAGE_SIZE;
    }
    expect(requested.length, 'paging never stopped').toBeLessThan(1_000);
    expect(Math.max(...requested) + PAGE_SIZE).toBeLessThanOrEqual(SERVER_MAX_OFFSET);
  });
});
