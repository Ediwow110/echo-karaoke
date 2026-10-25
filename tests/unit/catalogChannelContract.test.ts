import { describe, expect, it } from 'vitest';
import { CATALOG_CHANNELS } from '../../server/operations/catalogSync';
import { CATALOG_CHANNEL_LABELS } from '../../src/features/catalog/catalogApi';

// The sync stores its cursor under the handle, and the songbook filters by that
// same id. Two hand-maintained lists drift, and a chip whose id does not match a
// synced channel silently returns no songs instead of failing loudly.
describe('catalog channel contract', () => {
  it('offers exactly the channels the sync fills, in the same order', () => {
    expect(CATALOG_CHANNEL_LABELS.map((channel) => channel.id)).toEqual(CATALOG_CHANNELS);
  });

  it('labels every channel with something a host can read', () => {
    for (const channel of CATALOG_CHANNEL_LABELS) {
      expect(channel.label.trim().length).toBeGreaterThan(0);
      expect(channel.id.startsWith('@')).toBe(true);
    }
  });
});
