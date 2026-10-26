import { describe, expect, it } from 'vitest';
import { onlineGuestCount, presenceSummary } from '../../src/lib/format';

const member = (role: 'host' | 'guest', online: boolean) => ({ role, online });

const roster = (...online: boolean[]) => online.map((flag) => ({ online: flag }));

describe('presenceSummary', () => {
  it('counts everyone when nobody has drifted off', () => {
    expect(presenceSummary(roster(true, true, true))).toBe('3 people');
    expect(presenceSummary(roster(true))).toBe('1 person');
  });

  it('names the away members instead of claiming them as present', () => {
    // The roster keeps everyone who joined while the room lives. The rows under
    // this count already say "Away", so a total that folds them in contradicts
    // the list printed a few pixels below it.
    expect(presenceSummary(roster(true, true, false, false, false))).toBe('2 here · 3 away');
  });

  it('says nobody is here when every heartbeat has lapsed', () => {
    expect(presenceSummary(roster(false, false))).toBe('0 here · 2 away');
  });

  it('counts an empty room as nobody, not nobody-nobody', () => {
    expect(presenceSummary([])).toBe('0 people');
  });
});

describe('onlineGuestCount', () => {
  it('never counts the host as a guest', () => {
    // Room settings used to pass the whole roster to a chip that reads "N in",
    // so it claimed one more person than the party screen beside it.
    expect(onlineGuestCount([member('host', true), member('guest', true)])).toBe(1);
  });

  it('drops a guest whose phone stopped heartbeating', () => {
    expect(onlineGuestCount([member('host', true), member('guest', true), member('guest', false)])).toBe(1);
  });

  it('counts nobody when no one is here', () => {
    expect(onlineGuestCount([])).toBe(0);
    expect(onlineGuestCount([member('host', true), member('guest', false)])).toBe(0);
  });
});
