import { expect, test, type Page } from '@playwright/test';
import { openScreen } from './screen';

// The phone remote and the host screens, proven against the running app. These
// are the paths that had no browser cover: the guest remote at the width a guest
// actually holds it at, and the settings that can still close a room.

// Firefox surfaces the YouTube frame's own cross-origin errors as page errors on
// this page; no app code in src/ touches another frame's objects, and a page
// error carries no URL, so the message is the only handle on it.
const IGNORED_FRAME_ERRORS = /Permission denied to access property|downloadable font|A network error occurred|\/api\/[a-z-]+ due to access control checks/;

function collectPageErrors(page: Page): string[] {
  const noise: string[] = [];
  page.on('pageerror', (error) => {
    if (IGNORED_FRAME_ERRORS.test(error.message)) return;
    noise.push('pageerror: ' + error.message.slice(0, 140));
  });
  return noise;
}

const ROOM = '3a1ee27f-a539-4190-9250-bdc14ff631e0';
const CODE = 'ABCDEFGHJKMNPQRS';

type Scenario = {
  /** The host has turned guest requests off. */
  locked?: boolean;
  /** The host ended the room; every read then answers 'ended'. */
  ended?: boolean;
  /** The viewer's own second on the queued song, mutated by vote-command. */
  vote?: { voted: boolean; count: number };
  /** Every host-command action the app sent. */
  hostActions?: string[];
  /** Makes the host read fail, standing in for a transient blip. */
  hostReadFails?: boolean;
  /** How many heartbeats the app sent. */
  beats?: number;
};

function hostView(scenario: Scenario) {
  if (scenario.ended === true) {
    return { roomId: ROOM, status: 'ended', endedAt: new Date().toISOString() };
  }
  return {
    roomId: ROOM, status: 'live',
    room: { id: ROOM, code: CODE, name: 'Mock Night', status: 'live', guestControlLocked: false, guestPlaybackLocked: true, admissionsLocked: false, createdAt: '2026-10-18T00:00:00Z' },
    viewer: { memberId: 'm1', displayName: 'Ana', role: 'host' },
    roster: [
      { memberId: 'm1', displayName: 'Ana', role: 'host', online: true },
      { memberId: 'm2', displayName: 'Jamie', role: 'guest', online: true },
    ],
    queue: [{ songId: 's1', videoId: 'dQw4w9WgXcQ', title: 'Afterglow', channelTitle: 'Luna Vale', thumbnailUrl: null, durationSeconds: 222, status: 'playing', position: 1, memberId: 'm1', addedBy: 'Ana', voteCount: 0 }],
    playback: { currentSongId: 's1', currentVideoId: 'dQw4w9WgXcQ', positionSeconds: 10, durationSeconds: 222, isPlaying: true, updatedAt: new Date().toISOString() },
    events: [],
  };
}

function guestView(scenario: Scenario) {
  if (scenario.ended === true) {
    return { roomId: ROOM, status: 'ended', endedAt: new Date().toISOString() };
  }
  return {
    roomId: ROOM, status: 'live',
    room: { id: ROOM, code: CODE, name: 'Mock Night', status: 'live', guestControlLocked: scenario.locked === true, guestPlaybackLocked: true, admissionsLocked: false, createdAt: '2026-10-18T00:00:00Z' },
    viewer: { memberId: 'm2', displayName: 'Jamie', role: 'guest' },
    roster: [
      { memberId: 'm1', displayName: 'Ana', role: 'host', online: true },
      { memberId: 'm2', displayName: 'Jamie', role: 'guest', online: true },
    ],
    queue: [
      { songId: 's1', videoId: 'dQw4w9WgXcQ', title: 'Afterglow', channelTitle: 'Luna Vale', thumbnailUrl: null, durationSeconds: 222, status: 'playing', position: 1, memberId: 'm1', addedBy: 'Ana', voteCount: 0, votedByViewer: false },
      { songId: 's2', videoId: 'abc123XYZ_-', title: 'Midnight City', channelTitle: 'M83', thumbnailUrl: null, durationSeconds: 243, status: 'queued', position: 2, memberId: 'm1', addedBy: 'Ana', voteCount: scenario.vote?.count ?? 0, votedByViewer: scenario.vote?.voted ?? false },
    ],
    playback: { currentSongId: 's1', currentVideoId: 'dQw4w9WgXcQ', positionSeconds: 10, durationSeconds: 222, isPlaying: true, updatedAt: new Date().toISOString() },
    events: [],
  };
}

async function mock(page: Page, scenario: Scenario, role: 'host' | 'guest', refusal?: { op: string; status: number; code: string }) {
  await page.route('**/api/**', async (route) => {
    const op = new URL(route.request().url()).pathname.replace('/api/', '');
    if (refusal !== undefined && refusal.op === op) {
      // The server's own words for this code, which is not the app's voice.
      const serverMessage = refusal.code === 'GUEST_CONTROLS_LOCKED'
        ? 'The host locked guest controls'
        : refusal.code === 'RATE_LIMITED'
          ? 'Too many votes. Give it a moment.'
          : 'That song is already in the queue';
      await route.fulfill({ status: refusal.status, contentType: 'application/json', body: JSON.stringify({ error: { code: refusal.code, message: serverMessage } }) });
      return;
    }
    let payload: unknown = {};
    if (op === 'auth/token') payload = { token: 'mock-jwt' };
    else if (op === 'touch-member') {
      scenario.beats = (scenario.beats ?? 0) + 1;
      payload = { memberId: role === 'host' ? 'm1' : 'm2' };
    }
    else if (op === 'host-room-read' && scenario.hostReadFails === true) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'The room service is having a moment' } }) });
      return;
    }
    else if (op === 'host-room-read') payload = hostView(scenario);
    else if (op === 'guest-room-read') payload = guestView(scenario);
    else if (op === 'vote-command') {
      let body: Record<string, unknown> = {};
      try {
        body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      } catch {
        // Only the song matters here.
      }
      if (scenario.vote !== undefined) {
        scenario.vote.voted = !scenario.vote.voted;
        scenario.vote.count += scenario.vote.voted ? 1 : -1;
      }
      payload = { songId: body.songId, voteCount: scenario.vote?.count ?? 0, votedByViewer: scenario.vote?.voted ?? false };
    }
    else if (op === 'host-command') {
      let body: Record<string, unknown> = {};
      try {
        body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      } catch {
        // Only the action matters here.
      }
      if (body.action === 'end') scenario.ended = true;
      scenario.hostActions?.push(String(body.action));
      payload = { ok: true };
    }
    else if (op === 'join-room') payload = {
      roomId: ROOM, roomCode: CODE, roomName: 'Mock Night', memberId: 'm2',
      displayName: 'Jamie', role: 'guest', guestToken: 'g'.repeat(43),
    };
    else if (op === 'catalog-page') payload = { total: 2, items: [
      { videoId: 'v0', title: 'Halo - Beyonce (Karaoke)', channelTitle: 'Musisi Karaoke', thumbnailUrl: null, publishedAt: '2025-01-02T00:00:00Z' },
      { videoId: 'v1', title: 'A very long songbook title that should reflow on a phone', channelTitle: 'Musisi Karaoke', thumbnailUrl: null, publishedAt: '2025-01-02T00:00:00Z' },
    ] };
    else if (op === 'youtube-popular') payload = { available: false, results: [], message: 'off' };
    else if (op === 'youtube-search') payload = { available: true, results: [{ videoId: 'vid000000001', title: 'Halo (Karaoke)', channelTitle: 'MC', thumbnailUrl: null, durationSeconds: null }] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.addInitScript(([roomId, code, role]) => {
    localStorage.setItem('karaoke.sessions', JSON.stringify([{ roomId, code, roomName: 'Mock Night', hostName: 'Ana', role: 'host', lastSeenAt: new Date().toISOString() }]));
    localStorage.setItem('karaoke.last-room', JSON.stringify({ roomId, role: 'host' }));
    // Only the pass this role would really hold. sendQueueCommand prefers the
    // host token when both are present, so seeding both made a guest-refusal
    // test exercise the host credential instead.
    if (role === 'host') {
      localStorage.setItem('karaoke.host.' + roomId, 'z'.repeat(43));
    } else {
      localStorage.setItem('karaoke.guest.' + roomId, 'z'.repeat(43));
    }
  }, [ROOM, CODE, role]);
}

test('a scanned join link prefills the code and lands the guest in the room', async ({ page }) => {
  const scenario: Scenario = {};
  await mock(page, scenario, 'guest');
  await page.setViewportSize({ width: 390, height: 844 });
  await openScreen(page, '/join/' + CODE);

  await expect(page.getByLabel('Room code')).toHaveValue(/ABCD/);
  await page.getByLabel('Your name').fill('Jamie');
  await page.getByRole('button', { name: 'Join room' }).click();
  await expect(page).toHaveURL(new RegExp('/room/' + ROOM + '$'));
  await expect(page.getByRole('heading', { name: 'The room queue.' })).toBeVisible();
});

// The search tab tells a guest why its controls are greyed out when the host
// turns requests off. The songbook tab greyed its own out and said nothing.
test('a locked songbook says why its controls are off', async ({ page }) => {
  const scenario: Scenario = { locked: true };
  await mock(page, scenario, 'guest');
  await page.setViewportSize({ width: 390, height: 844 });
  await openScreen(page, '/room/' + ROOM + '/songbook');

  await expect(page.getByRole('heading', { name: 'Karaoke songbook' })).toBeVisible();
  await expect(page.getByText('The host turned off new requests.')).toBeVisible();
  const firstAdd = page.getByRole('button', { name: /add halo/i }).first();
  await expect(firstAdd).toBeVisible();
  await expect(firstAdd).toBeDisabled();
});

// A refusal reaches a guest as the server's sentence, which is not the app's.
// The search tab maps it; the songbook tab printed "The host locked guest
// controls" where every other screen says "The host turned off guest requests."
test('a refused add reads in the app voice from the songbook too', async ({ page }) => {
  const scenario: Scenario = {};
  await mock(page, scenario, 'guest', { op: 'queue-command', status: 403, code: 'GUEST_CONTROLS_LOCKED' });
  await page.setViewportSize({ width: 390, height: 844 });
  await openScreen(page, '/room/' + ROOM + '/songbook');

  const add = page.getByRole('button', { name: /add halo/i }).first();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByText('The host turned off guest requests.')).toBeVisible();
  await expect(page.getByText('The host locked guest controls')).toHaveCount(0);
});

// Ending the room is the one action that cannot be undone, and the host used to
// get no word of it: the screen simply became the landing page.
test('a host who ends the room is told that it ended', async ({ page }) => {
  const scenario: Scenario = {};
  await mock(page, scenario, 'host');
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScreen(page, '/room/' + ROOM + '/host/party');

  await page.getByRole('button', { name: 'End room', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^end the room$/i }).click();

  await expect(page).toHaveURL((url) => url.pathname === '/');
  expect(scenario.ended, 'the end command never reached the server').toBe(true);
  await expect(page.getByText('Mock Night has ended.')).toBeVisible();
  // The ended room must not come back as a way "back to the room".
  await expect(page.getByRole('link', { name: 'Back to the room' })).toHaveCount(0);
});

// The stage header is where the host actually is, so ending must not require a
// trip to settings. The dialog is what keeps a stray TV remote press from
// killing the party.
test('a host can end the room from the stage header', async ({ page }) => {
  const scenario: Scenario = { hostActions: [] };
  await mock(page, scenario, 'host');
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScreen(page, '/room/' + ROOM + '/host/party');

  await page.getByRole('button', { name: 'End room', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/every remote loses access/i)).toBeVisible();
  await dialog.getByRole('button', { name: 'End the room' }).click();

  await expect(page).toHaveURL((url) => url.pathname === '/');
  expect(scenario.ended, 'the end command never reached the server').toBe(true);
  await expect(page.getByText('Mock Night has ended.')).toBeVisible();
});

// Cancelling the stage dialog must leave the party exactly as it was.
test('cancelling the stage end dialog keeps the room open', async ({ page }) => {
  const scenario: Scenario = { hostActions: [] };
  await mock(page, scenario, 'host');
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScreen(page, '/room/' + ROOM + '/host/party');

  await page.getByRole('button', { name: 'End room', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Keep it open' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page).toHaveURL(/\/host\/party$/);
  expect(scenario.hostActions).not.toContain('end');
});

// A guest holding a phone does not reload when the party ends. The four-second
// read is the only thing that can tell them, and the pass stays valid long
// enough to ask, so the room has to close in front of them.
test('an open guest tab learns the room ended without reloading', async ({ page, browser }) => {
  const scenario: Scenario = {};
  const host = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await mock(page, scenario, 'guest');
  await mock(host, scenario, 'host');
  await page.setViewportSize({ width: 390, height: 844 });
  await openScreen(page, '/room/' + ROOM);
  await expect(page.getByRole('heading', { name: 'The room queue.' })).toBeVisible();

  await openScreen(host, '/room/' + ROOM + '/host/party');
  await host.getByRole('button', { name: 'End room', exact: true }).click();
  await host.getByRole('dialog').getByRole('button', { name: /^end the room$/i }).click();

  await expect(page.getByRole('heading', { name: 'This room has ended.' })).toBeVisible({ timeout: 15_000 });
  await host.close();
});

// Voting is the capability the server has always had and no screen ever
// offered. The row has to show the count, take a second, and read the pressed
// state back from the server rather than trusting the click.
test('a guest can second a song and the row remembers it', async ({ page }) => {
  const vote = { voted: false, count: 2 };
  const scenario: Scenario = { vote };
  await mock(page, scenario, 'guest');
  await page.setViewportSize({ width: 390, height: 844 });
  await openScreen(page, '/room/' + ROOM);

  const second = page.getByRole('button', { name: 'Second Midnight City' });
  await expect(second).toBeVisible();
  await expect(second).toHaveAttribute('aria-pressed', 'false');
  await expect(second).toHaveText('2');
  // The label overrides the contents, so the count has to be in it or a screen
  // reader never hears the number a sighted guest sees.
  await expect(second).toHaveAccessibleName('Second Midnight City, 2 votes');

  await second.click();

  const taken = page.getByRole('button', { name: 'Take back your vote for Midnight City' });
  await expect(taken).toHaveAttribute('aria-pressed', 'true');
  await expect(taken).toHaveText('3');
  expect(vote, 'the vote never reached the room').toEqual({ voted: true, count: 3 });

  await taken.click();
  await expect(page.getByRole('button', { name: 'Second Midnight City' })).toHaveAttribute('aria-pressed', 'false');
  expect(vote).toEqual({ voted: false, count: 2 });
});

// The invite chip reads "N in" beside the QR. It lives on the stage now, so the
// only screens that can show it are the TV stage and the party layout, and both
// must count guests rather than the whole roster.
test('the invite chip says the same head-count on every host screen', async ({ page }) => {
  const scenario: Scenario = {};
  await mock(page, scenario, 'host');
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const path of [
    '/room/' + ROOM + '/host',
    '/room/' + ROOM + '/host/queue',
    '/room/' + ROOM + '/host/party',
  ]) {
    await openScreen(page, path);
    // The mock roster is one host plus one guest, both heartbeating. Screens
    // that carry no chip are fine; ones that do must agree.
    const chips = await page.getByText(/^\d+ in$/i).allInnerTexts();
    // The chip is styled uppercase, and innerText reports what is painted.
    expect(chips.every((chip) => chip.toLowerCase() === '1 in'), path + ' chips: ' + JSON.stringify(chips)).toBe(true);
  }
  // The claim is only worth anything if at least one screen renders it.
  await openScreen(page, '/room/' + ROOM + '/host/party');
  await expect(page.getByText('1 in').first()).toBeVisible();
});

// "Queue · N" appeared on two screens a room looks at together, computed from
// two different sets: the phones counted every row including the playing song,
// the TV counted only what is waiting. Same words, different numbers, one
// glance apart.
test('the party strip names the count it actually shows', async ({ page }) => {
  const scenario: Scenario = {};
  await mock(page, scenario, 'host');
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScreen(page, '/room/' + ROOM + '/host/party');

  // The mock queue is one song playing and none waiting. The strip beside the
  // "UP NEXT" label used to read "Queue · 0" while every phone in the room read
  // "Queue · 1" for the same moment.
  await expect(page.getByText('Queue ·')).toHaveCount(0);
  await expect(page.getByText(/up next ·/i).first()).toBeVisible();
});

// The console redesign spec names this control (Trash, "Clear queue") and the
// server has answered the action since 0014, but no screen ever sent it.
test('the host can clear the queue from the queue page', async ({ page }) => {
  const scenario: Scenario = { hostActions: [] };
  await mock(page, scenario, 'host');
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScreen(page, '/room/' + ROOM + '/host/queue');

  await page.getByRole('button', { name: 'Clear queue' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog, 'no confirmation before an irreversible action').toBeVisible();
  // The SQL deletes every row, the playing one included, and stops playback.
  await expect(dialog.getByText(/including the one playing/i)).toBeVisible();
  await dialog.getByRole('button', { name: 'Clear queue' }).click();

  await expect.poll(() => scenario.hostActions).toContain('clear_queue');
  await expect(dialog).toBeHidden();
});

// Counting a vote is a request; a failed one landed in a toast hard-wired to
// the success tone, so a refusal was announced with a green tick.
test('a refused vote is announced as an error, not a success', async ({ page }) => {
  const scenario: Scenario = {};
  await mock(page, scenario, 'guest', { op: 'vote-command', status: 429, code: 'RATE_LIMITED' });
  await page.setViewportSize({ width: 390, height: 844 });
  await openScreen(page, '/room/' + ROOM);

  await page.getByRole('button', { name: 'Second Midnight City' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('That vote could not be counted.');
  await expect(alert).toContainText('That is a lot of votes at once');
});

// The server refuses a locked guest's vote outright, so an enabled control is a
// button that can only fail.
test('a locked room does not offer an enabled vote', async ({ page }) => {
  const scenario: Scenario = { locked: true };
  await mock(page, scenario, 'guest');
  await page.setViewportSize({ width: 390, height: 844 });
  await openScreen(page, '/room/' + ROOM);

  const vote = page.getByRole('button', { name: /Second Midnight City/ });
  await expect(vote).toBeVisible();
  await expect(vote).toBeDisabled();
});

// The offer to return to a hosted room was decided by one read at mount. A blip
// removed the only way back until a reload, and a room that ended while the host
// sat on this screen stayed offered.
test('a blip does not take away the way back to the room', async ({ page }) => {
  const scenario: Scenario = { hostReadFails: true };
  await mock(page, scenario, 'host');
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScreen(page, '/create');
  await expect(page.getByRole('link', { name: 'Back to the room' })).toHaveCount(0);

  scenario.hostReadFails = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('link', { name: 'Back to the room' }), 'the offer never recovered')
    .toBeVisible();
});

test('a room that ends while the host sits here stops being offered', async ({ page }) => {
  const scenario: Scenario = {};
  await mock(page, scenario, 'host');
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScreen(page, '/create');
  await expect(page.getByRole('link', { name: 'Back to the room' })).toBeVisible();

  scenario.ended = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('link', { name: 'Back to the room' }), 'a dead room was still offered')
    .toHaveCount(0);
});

// The room's only heartbeat is the host screen's. A host who stepped out to this
// screen is still hosting, so offering "Back to the room" while nothing kept the
// room alive let the sweep take it out from under the guests.
test('the create screen keeps the hosted room alive while it offers the way back', async ({ page }) => {
  const scenario: Scenario = { beats: 0 };
  await mock(page, scenario, 'host');
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScreen(page, '/create');
  await expect(page.getByRole('link', { name: 'Back to the room' })).toBeVisible();
  await expect.poll(() => scenario.beats ?? 0, 'the room was left without a heartbeat').toBeGreaterThan(0);
});

const GUEST_SCREENS = [
  ['queue', '/room/' + ROOM],
  ['songbook', '/room/' + ROOM + '/songbook'],
  ['search', '/room/' + ROOM + '/search'],
] as const;

for (const [name, path] of GUEST_SCREENS) {
  test('guest remote keeps 44px targets and fits a phone: ' + name, async ({ page }) => {
    const scenario: Scenario = {};
    const noise = collectPageErrors(page);
    await mock(page, scenario, 'guest');
    await page.setViewportSize({ width: 390, height: 844 });
    await openScreen(page, path);
    await page.waitForTimeout(600);

    expect(noise).toEqual([]);
    expect(await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth > root.clientWidth + 1 ? root.scrollWidth + ' > ' + root.clientWidth : '';
    }), name + ' scrolls sideways').toBe('');
    expect(await page.evaluate(() => [...document.querySelectorAll('button, input, a[href], [role="button"]')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none'
          && element.getAttribute('aria-hidden') !== 'true'
          && (rect.width < 44 || rect.height < 44);
      })
      .map((element) => (element.getAttribute('aria-label') || element.textContent || element.tagName).trim().slice(0, 40)
        + ' ' + Math.round(element.getBoundingClientRect().width) + 'x' + Math.round(element.getBoundingClientRect().height))),
    name + ' has targets under 44px').toEqual([]);
  });
}
