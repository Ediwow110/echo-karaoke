import { expect, test, type Page } from '@playwright/test';

// Moderation and the phone remote, proven against the running app. These are
// the paths that had no browser cover before: the door a host opens, the
// waiting screen that promises to open by itself, and the guest remote at the
// width a guest actually holds it at.

const ROOM = '3a1ee27f-a539-4190-9250-bdc14ff631e0';
const CODE = 'ABCDEFGHJKMNPQRS';

type Scenario = {
  /** Flipped mid-test to stand in for the host admitting a waiting guest. */
  admitted: boolean;
  /** The host has turned guest requests off. */
  locked?: boolean;
  /** The host ended the room; every read then answers 'ended'. */
  ended?: boolean;
  /** The viewer's own second on the queued song, mutated by vote-command. */
  vote?: { voted: boolean; count: number };
  approvedMemberIds: unknown[];
};

function hostView(scenario: Scenario) {
  if (scenario.ended === true) {
    return { roomId: ROOM, status: 'ended', endedAt: new Date().toISOString() };
  }
  return {
    roomId: ROOM, status: 'live',
    room: { id: ROOM, code: CODE, name: 'Mock Night', status: 'live', guestControlLocked: false, guestPlaybackLocked: true, requireApproval: true, admissionsLocked: false, createdAt: '2026-10-18T00:00:00Z' },
    viewer: { memberId: 'm1', displayName: 'Ana', role: 'host', status: 'active' },
    roster: [
      { memberId: 'm1', displayName: 'Ana', role: 'host', online: true },
      { memberId: 'm2', displayName: 'Jamie', role: 'guest', online: true },
    ],
    door: scenario.admitted ? [] : [{ memberId: 'm3', displayName: 'Sam', requestedAt: new Date().toISOString() }],
    queue: [{ songId: 's1', videoId: 'dQw4w9WgXcQ', title: 'Afterglow', channelTitle: 'Luna Vale', thumbnailUrl: null, durationSeconds: 222, status: 'playing', position: 1, memberId: 'm1', addedBy: 'Ana', voteCount: 0 }],
    playback: { currentSongId: 's1', currentVideoId: 'dQw4w9WgXcQ', positionSeconds: 10, durationSeconds: 222, isPlaying: true, updatedAt: new Date().toISOString() },
    events: [],
  };
}

function guestView(scenario: Scenario) {
  if (scenario.ended === true) {
    return { roomId: ROOM, status: 'ended', endedAt: new Date().toISOString() };
  }
  if (!scenario.admitted) {
    // A waiting guest learns the room name and who hosts it. Nothing else:
    // no code, no roster, no queue, no playback.
    return {
      roomId: ROOM, status: 'waiting',
      room: { id: ROOM, name: 'Mock Night', hostName: 'Ana' },
      viewer: { memberId: 'm2', displayName: 'Jamie', role: 'guest', status: 'pending' },
    };
  }
  return {
    roomId: ROOM, status: 'live',
    room: { id: ROOM, code: CODE, name: 'Mock Night', status: 'live', guestControlLocked: scenario.locked === true, guestPlaybackLocked: true, requireApproval: true, admissionsLocked: false, createdAt: '2026-10-18T00:00:00Z' },
    viewer: { memberId: 'm2', displayName: 'Jamie', role: 'guest', status: 'active' },
    roster: [
      { memberId: 'm1', displayName: 'Ana', role: 'host', online: true },
      { memberId: 'm2', displayName: 'Jamie', role: 'guest', online: true },
    ],
    door: [],
    queue: [
      { songId: 's1', videoId: 'dQw4w9WgXcQ', title: 'Afterglow', channelTitle: 'Luna Vale', thumbnailUrl: null, durationSeconds: 222, status: 'playing', position: 1, memberId: 'm1', addedBy: 'Ana', voteCount: 0, votedByViewer: false },
      { songId: 's2', videoId: 'abc123XYZ_-', title: 'Midnight City', channelTitle: 'M83', thumbnailUrl: null, durationSeconds: 243, status: 'queued', position: 2, memberId: 'm1', addedBy: 'Ana', voteCount: scenario.vote?.count ?? 0, votedByViewer: scenario.vote?.voted ?? false },
    ],
    playback: { currentSongId: 's1', currentVideoId: 'dQw4w9WgXcQ', positionSeconds: 10, durationSeconds: 222, isPlaying: true, updatedAt: new Date().toISOString() },
    events: [],
  };
}

async function mock(page: Page, scenario: Scenario, role: 'host' | 'guest', joinStatus: 'joined' | 'waiting' = 'joined', refusal?: { op: string; status: number; code: string }) {
  await page.route('**/api/**', async (route) => {
    const op = new URL(route.request().url()).pathname.replace('/api/', '');
    if (refusal !== undefined && refusal.op === op) {
      // The server's own words for this code, which is not the app's voice.
      const serverMessage = refusal.code === 'GUEST_CONTROLS_LOCKED'
        ? 'The host locked guest controls'
        : 'That song is already in the queue';
      await route.fulfill({ status: refusal.status, contentType: 'application/json', body: JSON.stringify({ error: { code: refusal.code, message: serverMessage } }) });
      return;
    }
    let payload: unknown = {};
    if (op === 'auth/token') payload = { token: 'mock-jwt' };
    else if (op === 'touch-member') payload = { memberId: role === 'host' ? 'm1' : 'm2' };
    else if (op === 'host-room-read') payload = hostView(scenario);
    else if (op === 'guest-room-read') payload = guestView(scenario);
    else if (op === 'approve-member' || op === 'reject-member') {
      let body: Record<string, unknown> = {};
      try {
        body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      } catch {
        // The auth bootstrap posts a form body; only room operations matter.
      }
      if (op === 'approve-member') {
        scenario.approvedMemberIds.push(body.memberId);
        scenario.admitted = true;
      }
      payload = { door: [] };
    }
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
      payload = { ok: true };
    }
    else if (op === 'join-room') payload = {
      roomId: ROOM, roomCode: CODE, roomName: 'Mock Night', memberId: 'm2',
      displayName: 'Jamie', role: 'guest', guestToken: 'g'.repeat(43), status: joinStatus,
    };
    else if (op === 'catalog-page') payload = { total: 2, items: [
      { videoId: 'v0', title: 'Halo - Beyonce (Karaoke)', channelTitle: 'Musisi Karaoke', thumbnailUrl: null, publishedAt: '2025-01-02T00:00:00Z' },
      { videoId: 'v1', title: 'A very long songbook title that should reflow on a phone', channelTitle: 'Musisi Karaoke', thumbnailUrl: null, publishedAt: '2025-01-02T00:00:00Z' },
    ] };
    else if (op === 'youtube-popular') payload = { available: false, results: [], message: 'off' };
    else if (op === 'youtube-search') payload = { available: true, results: [{ videoId: 'vid000000001', title: 'Halo (Karaoke)', channelTitle: 'MC', thumbnailUrl: null, durationSeconds: null }] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.addInitScript(([roomId, code]) => {
    localStorage.setItem('karaoke.sessions', JSON.stringify([{ roomId, code, roomName: 'Mock Night', hostName: 'Ana', role: 'host', lastSeenAt: new Date().toISOString() }]));
    localStorage.setItem('karaoke.last-room', JSON.stringify({ roomId, role: 'host' }));
    localStorage.setItem('karaoke.host.' + roomId, 'z'.repeat(43));
    localStorage.setItem('karaoke.guest.' + roomId, 'z'.repeat(43));
  }, [ROOM, CODE]);
}

test('the host admits a waiting guest from room settings and the door clears', async ({ page }) => {
  const scenario: Scenario = { admitted: false, approvedMemberIds: [] };
  const noise: string[] = [];
  await mock(page, scenario, 'host');
  page.on('pageerror', (error) => noise.push('pageerror: ' + error.message.slice(0, 140)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/room/' + ROOM + '/host/settings', { waitUntil: 'networkidle' });

  const letIn = page.getByRole('button', { name: 'Let Sam in' });
  await expect(letIn, 'the door never offered the waiting guest').toBeVisible();
  await expect(page.getByText('1 at the door')).toBeVisible();

  await letIn.click();
  await expect(page.getByText('Nobody is waiting at the door.')).toBeVisible();
  await expect(page.getByText('1 at the door')).toHaveCount(0);
  expect(scenario.approvedMemberIds).toEqual(['m3']);
  expect(noise).toEqual([]);
});

test('a waiting guest sees nothing of the room until the host admits them', async ({ page }) => {
  const scenario: Scenario = { admitted: false, approvedMemberIds: [] };
  await mock(page, scenario, 'guest', 'waiting');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/join/' + CODE, { waitUntil: 'networkidle' });
  await page.getByLabel('Your name').fill('Jamie');
  await page.getByRole('button', { name: 'Join room' }).click();

  await expect(page.getByText('Waiting at the door')).toBeVisible();
  await expect(page.getByText(CODE)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^queue/i })).toHaveCount(0);
});

test('the waiting screen opens by itself once the host admits the guest', async ({ page }) => {
  const scenario: Scenario = { admitted: false, approvedMemberIds: [] };
  await mock(page, scenario, 'guest', 'waiting');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/join/' + CODE, { waitUntil: 'networkidle' });
  await page.getByLabel('Your name').fill('Jamie');
  await page.getByRole('button', { name: 'Join room' }).click();
  await expect(page.getByText('Waiting at the door')).toBeVisible();

  // The copy on that screen promises it opens without the guest doing anything.
  scenario.admitted = true;
  await expect(page.getByRole('heading', { name: 'The room queue.' }), 'the waiting screen never opened')
    .toBeVisible({ timeout: 15_000 });
});

test('a scanned join link prefills the code and lands the guest in the room', async ({ page }) => {
  const scenario: Scenario = { admitted: true, approvedMemberIds: [] };
  await mock(page, scenario, 'guest');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/join/' + CODE, { waitUntil: 'networkidle' });

  await expect(page.getByLabel('Room code')).toHaveValue(/ABCD/);
  await page.getByLabel('Your name').fill('Jamie');
  await page.getByRole('button', { name: 'Join room' }).click();
  await expect(page).toHaveURL(new RegExp('/room/' + ROOM + '$'));
  await expect(page.getByRole('heading', { name: 'The room queue.' })).toBeVisible();
});

// The search tab tells a guest why its controls are greyed out when the host
// turns requests off. The songbook tab greyed its own out and said nothing.
test('a locked songbook says why its controls are off', async ({ page }) => {
  const scenario: Scenario = { admitted: true, locked: true, approvedMemberIds: [] };
  await mock(page, scenario, 'guest');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/room/' + ROOM + '/songbook', { waitUntil: 'networkidle' });

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
  const scenario: Scenario = { admitted: true, approvedMemberIds: [] };
  await mock(page, scenario, 'guest', 'joined', { op: 'queue-command', status: 403, code: 'GUEST_CONTROLS_LOCKED' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/room/' + ROOM + '/songbook', { waitUntil: 'networkidle' });

  const add = page.getByRole('button', { name: /add halo/i }).first();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByText('The host turned off guest requests.')).toBeVisible();
  await expect(page.getByText('The host locked guest controls')).toHaveCount(0);
});

// Ending the room is the one action that cannot be undone, and the host used to
// get no word of it: the screen simply became the landing page.
test('a host who ends the room is told that it ended', async ({ page }) => {
  const scenario: Scenario = { admitted: true, approvedMemberIds: [] };
  await mock(page, scenario, 'host');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/room/' + ROOM + '/host/settings', { waitUntil: 'networkidle' });

  await page.getByRole('button', { name: /leave & end room/i }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^end the room$/i }).click();

  await expect(page).toHaveURL((url) => url.pathname === '/');
  expect(scenario.ended, 'the end command never reached the server').toBe(true);
  await expect(page.getByText('Mock Night has ended.')).toBeVisible();
  // The ended room must not come back as a way "back to the room".
  await expect(page.getByRole('link', { name: 'Back to the room' })).toHaveCount(0);
});

// A guest holding a phone does not reload when the party ends. The four-second
// read is the only thing that can tell them, and the pass stays valid long
// enough to ask, so the room has to close in front of them.
test('an open guest tab learns the room ended without reloading', async ({ page, browser }) => {
  const scenario: Scenario = { admitted: true, approvedMemberIds: [] };
  const host = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await mock(page, scenario, 'guest');
  await mock(host, scenario, 'host');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/room/' + ROOM, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'The room queue.' })).toBeVisible();

  await host.goto('/room/' + ROOM + '/host/settings', { waitUntil: 'networkidle' });
  await host.getByRole('button', { name: /leave & end room/i }).click();
  await host.getByRole('dialog').getByRole('button', { name: /^end the room$/i }).click();

  await expect(page.getByRole('heading', { name: 'This room has ended.' })).toBeVisible({ timeout: 15_000 });
  await host.close();
});

// Voting is the capability the server has always had and no screen ever
// offered. The row has to show the count, take a second, and read the pressed
// state back from the server rather than trusting the click.
test('a guest can second a song and the row remembers it', async ({ page }) => {
  const vote = { voted: false, count: 2 };
  const scenario: Scenario = { admitted: true, approvedMemberIds: [], vote };
  await mock(page, scenario, 'guest');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/room/' + ROOM, { waitUntil: 'networkidle' });

  const second = page.getByRole('button', { name: 'Second Midnight City' });
  await expect(second).toBeVisible();
  await expect(second).toHaveAttribute('aria-pressed', 'false');
  await expect(second).toHaveText('2');

  await second.click();

  const taken = page.getByRole('button', { name: 'Take back your vote for Midnight City' });
  await expect(taken).toHaveAttribute('aria-pressed', 'true');
  await expect(taken).toHaveText('3');
  expect(vote, 'the vote never reached the room').toEqual({ voted: true, count: 3 });

  await taken.click();
  await expect(page.getByRole('button', { name: 'Second Midnight City' })).toHaveAttribute('aria-pressed', 'false');
  expect(vote).toEqual({ voted: false, count: 2 });
});

const GUEST_SCREENS = [
  ['queue', '/room/' + ROOM],
  ['songbook', '/room/' + ROOM + '/songbook'],
  ['search', '/room/' + ROOM + '/search'],
] as const;

for (const [name, path] of GUEST_SCREENS) {
  test('guest remote keeps 44px targets and fits a phone: ' + name, async ({ page }) => {
    const scenario: Scenario = { admitted: true, approvedMemberIds: [] };
    const noise: string[] = [];
    await mock(page, scenario, 'guest');
    page.on('pageerror', (error) => noise.push('pageerror: ' + error.message.slice(0, 140)));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path, { waitUntil: 'networkidle' });
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
