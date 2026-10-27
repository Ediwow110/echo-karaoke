import { expect, test, type Page } from '@playwright/test';

const ROOM = '3a1ee27f-a539-4190-9250-bdc14ff631e0';
const TOKEN = 'z'.repeat(43);
const queue = [
  {
    songId: 's1',
    videoId: 'dQw4w9WgXcQ',
    title: 'Afterglow',
    channelTitle: 'Luna Vale',
    thumbnailUrl: null,
    durationSeconds: 222,
    status: 'playing',
    position: 1,
    memberId: 'm1',
    addedBy: 'Ana',
    voteCount: 0,
  },
  {
    songId: 's2',
    videoId: 'abc123XYZ_-',
    title: 'Midnight City',
    channelTitle: 'M83',
    thumbnailUrl: null,
    durationSeconds: 243,
    status: 'queued',
    position: 2,
    memberId: 'm2',
    addedBy: 'Jamie',
    voteCount: 0,
  },
];

function room(hostOnline: boolean) {
  return {
    roomId: ROOM,
    status: 'live',
    room: {
      id: ROOM,
      code: 'ABCDEFGHJKMNPQRS',
      name: 'Mock Night',
      status: 'live',
      guestControlLocked: false,
      guestPlaybackLocked: true,
      createdAt: '2026-10-18T00:00:00Z',
    },
    viewer: { memberId: 'm2', displayName: 'Jamie', role: 'guest' },
    roster: [
      { memberId: 'm1', displayName: 'Ana', role: 'host', online: hostOnline },
      { memberId: 'm2', displayName: 'Jamie', role: 'guest', online: true },
    ],
    queue,
    playback: {
      currentSongId: 's1',
      currentVideoId: 'dQw4w9WgXcQ',
      positionSeconds: 10,
      durationSeconds: 222,
      isPlaying: hostOnline,
      updatedAt: new Date().toISOString(),
    },
    events: [],
  };
}

const results = [1, 2, 3, 4].map((index) => ({
  videoId: 'vid0000000' + index,
  title: 'A very long karaoke title that should reflow ' + index,
  channelTitle: 'Channel ' + index,
  thumbnailUrl: null,
  durationSeconds: null,
}));

async function mockApi(
  page: Page,
  hostOnline = true,
  commands: Array<{ action?: string }> = [],
  failHost: () => boolean = () => false,
  popularResults: unknown[] | null = null,
  catalogQueries: string[] = [],
  syncs: number[] = [],
): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    let status = 200;
    if (path.endsWith('/api/auth/token')) body = { token: 'mock-jwt' };
    else if (path.endsWith('/api/touch-member')) body = { memberId: 'm2' };
    else if (path.endsWith('/api/host-room-read') && failHost()) {
      status = 401;
      body = { error: { code: 'UNAUTHORIZED', message: 'Your room pass is no longer valid. Return home and join the room again.' } };
    } else if (path.endsWith('/api/guest-room-read') || path.endsWith('/api/host-room-read')) body = room(hostOnline);
    else if (path.endsWith('/api/youtube-search')) body = { available: true, results };
    else if (path.endsWith('/api/youtube-popular')) {
      body = popularResults === null
        ? { available: false, results: [], message: 'off' }
        : { available: true, results: popularResults };
    }
    else if (path.endsWith('/api/catalog-sync')) {
      syncs.push(Date.now());
      body = { available: true, added: 0, skipped: 4 };
    }
    else if (path.endsWith('/api/catalog-page')) {
      const query = (route.request().postDataJSON() as { query?: string }).query ?? '';
      catalogQueries.push(query);
      const items = Array.from({ length: 30 }, (_, index) => ({
        videoId: 'video' + String(index).padStart(6, '0'),
        title: index === 0 ? 'Halo - Beyonce (Karaoke)' : 'Song ' + index + ' (Karaoke)',
        channelTitle: 'Musisi Karaoke',
        thumbnailUrl: null,
        publishedAt: '2025-01-02T00:00:00Z',
      }));
      const filtered = query === 'halo' ? items.slice(0, 1) : items;
      body = { total: filtered.length, items: filtered };
    }
    else if (path.endsWith('/api/queue-command')) {
      const command = route.request().postDataJSON() as { action?: string; videoId?: string };
      commands.push(command);
      body = {
        songId: 's3',
        videoId: command.videoId ?? 'video000000',
        title: 'Halo - Beyonce (Karaoke)',
        channelTitle: 'Musisi Karaoke',
        thumbnailUrl: null,
        durationSeconds: null,
        status: 'queued',
        position: 3,
        memberId: 'm1',
        addedBy: 'Ana',
        voteCount: 0,
      };
    }
    else if (path.endsWith('/api/playback-report')) body = room(hostOnline).playback;
    else if (path.endsWith('/api/playback-command')) {
      commands.push(route.request().postDataJSON() as { action?: string });
      body = { roomId: ROOM, status: 'live', playback: room(hostOnline).playback };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.addInitScript(([roomId, token]) => {
    localStorage.setItem('karaoke.guest.' + roomId, token);
    localStorage.setItem('karaoke.host.' + roomId, token);
  }, [ROOM, TOKEN]);
}

async function openGuestSearch(page: Page): Promise<void> {
  await page.goto('/room/' + ROOM, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Search' }).click();
  await page.locator('#song-search').fill('mock');
  await page.waitForSelector('ul[aria-label="Songs"] li');
}

test('a refused start leaves the host on the page that can retry it', async ({ page }) => {
  // Both the auto-play effect and the Start button used to navigate as soon as
  // the command was sent, so a refused play put the host in front of a silent
  // room with nothing to press. The command must be attempted, and the page
  // that offers the retry must still be the one on screen.
  await mockApi(page);
  const stopped = {
    ...room(false),
    queue: queue.map((song) => ({ ...song, status: 'queued' })),
    playback: {
      currentSongId: null,
      currentVideoId: null,
      positionSeconds: 0,
      durationSeconds: null,
      isPlaying: false,
      updatedAt: null,
    },
  };
  const answer = (body: unknown) => async (route: import('@playwright/test').Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  };
  await page.route('**/api/guest-room-read', answer(stopped));
  await page.route('**/api/host-room-read', answer(stopped));
  let attempts = 0;
  await page.route('**/api/playback-command', async (route) => {
    attempts += 1;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'SEARCH_UNAVAILABLE', message: 'Playback is unavailable right now' } }),
    });
  });

  await page.goto('/room/' + ROOM + '/host', { waitUntil: 'networkidle' });

  await expect(page.getByText('kara-echo song search')).toBeVisible();
  const before = attempts;
  await page.getByRole('button', { name: 'Start the session' }).click();
  await expect.poll(() => attempts).toBeGreaterThan(before);
  await expect(page.getByText('kara-echo song search')).toBeVisible();
});

async function stubYouTube(page: Page, state: number, currentTime: number): Promise<void> {
  await page.addInitScript(([playerState, clock]) => {
    (window as unknown as { YT: unknown }).YT = {
      PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
      Player: function StubPlayer(_mount: HTMLElement, options: { events?: { onReady?: () => void } }) {
        const stub = {
          loadVideoById: () => undefined,
          playVideo: () => undefined,
          pauseVideo: () => undefined,
          seekTo: () => undefined,
          getCurrentTime: () => clock,
          getDuration: () => 222,
          getPlayerState: () => playerState,
          setVolume: () => undefined,
          getVolume: () => 100,
          destroy: () => undefined,
        };
        window.setTimeout(() => options.events?.onReady?.(), 0);
        return stub;
      },
    };
  }, [state, currentTime]);
}

async function collectReports(page: Page): Promise<Array<{ positionSeconds?: number }>> {
  const reports: Array<{ positionSeconds?: number }> = [];
  await page.route('**/api/playback-report', async (route) => {
    reports.push(route.request().postDataJSON() as { positionSeconds?: number });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(room(true).playback),
    });
  });
  return reports;
}

test('a playing video still reports its position', async ({ page }) => {
  // The control for the gate below: it proves the stubbed player is wired and
  // that reports flow at all, so an empty result there means the guard worked.
  await mockApi(page);
  await stubYouTube(page, 1, 100);
  const reports = await collectReports(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/room/' + ROOM + '/host/stage', { waitUntil: 'networkidle' });
  await expect.poll(
    () => reports.filter((report) => report.positionSeconds === 100).length,
    { timeout: 6000 },
  ).toBeGreaterThan(0);
});

test('a buffering video never reports a position the room has not reached', async ({ page }) => {
  // YouTube answers 0 for the clock until the video starts, while already
  // knowing its duration, and the server stores whatever position it is given.
  // Reporting that 0 would rewind every phone to the start of the song.
  await mockApi(page);
  await stubYouTube(page, 3, 0);
  const reports = await collectReports(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/room/' + ROOM + '/host/stage', { waitUntil: 'networkidle' });
  // Past the 2.6 s early report and the first 1 s ticks, before the 12 s one.
  await page.waitForTimeout(4000);

  expect(reports.filter((report) => report.positionSeconds === 0)).toEqual([]);
});

test('a failed songbook search is not reported as no matches', async ({ page }) => {
  // An empty first page is a real answer, so the list marks itself loaded. A
  // later search that fails is not a search that matched nothing, and saying
  // both at once blames the catalog for an outage.
  await mockApi(page);
  await page.route('**/api/catalog-page', async (route) => {
    const body = route.request().postDataJSON() as { query?: string };
    if ((body.query ?? '') === '') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 0, items: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'The songbook could not load.' } }),
    });
  });

  await page.goto('/room/' + ROOM + '/songbook', { waitUntil: 'networkidle' });
  await expect(page.getByText(/the songbook is warming up/i)).toBeVisible();

  await page.getByPlaceholder('Search title or artist').fill('halo');
  await expect(page.getByRole('alert')).toContainText('could not load');
  await expect(page.getByText('No song matches that search.')).toHaveCount(0);
});

test('a seek on a player that never started is still reported when it can land', async ({ page }) => {
  // The control for the gate below: a ready player confirms the seek and the
  // room must hear about it, so an empty result there means the guard worked.
  await mockApi(page);
  await stubYouTube(page, 1, 100);
  const reports = await collectReports(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/room/' + ROOM + '/host/stage', { waitUntil: 'networkidle' });
  const back = page.getByRole('button', { name: 'Back 10 seconds' }).first();
  await expect(back).toBeEnabled();
  await back.click();

  await expect.poll(
    () => reports.filter((report) => report.positionSeconds === 90).length,
    { timeout: 6000 },
  ).toBeGreaterThan(0);
});

test('a seek the player cannot confirm is never reported', async ({ page }) => {
  // A player that never handed over its controls drops the seek, so reporting
  // one would move every phone to a place this video never reached.
  await mockApi(page);
  await stubYouTube(page, -1, 100);
  const reports = await collectReports(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/room/' + ROOM + '/host/stage', { waitUntil: 'networkidle' });
  const back = page.getByRole('button', { name: 'Back 10 seconds' }).first();
  await expect(back).toBeEnabled();
  await back.click();
  await page.waitForTimeout(1000);

  expect(reports.filter((report) => report.positionSeconds === 90)).toEqual([]);
});

test('a failed songbook search never claims nothing matched', async ({ page }) => {
  // Once a search has legitimately matched nothing, a later search that fails
  // used to render "No song matches that search" under the alert saying the
  // request never completed -- blaming the catalog for an outage.
  await mockApi(page);
  let calls = 0;
  await page.route('**/api/catalog-page', async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 0, items: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'The songbook could not load' } }),
    });
  });

  await page.goto('/room/' + ROOM + '/host/songbook', { waitUntil: 'networkidle' });
  await expect(page.getByText(/the songbook is warming up/i)).toBeVisible();

  await page.getByLabel('Search the songbook').fill('halo');

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText(/no song matches that search/i)).toHaveCount(0);
});

test('a promoted guest keeps claiming the host pass until it lands', async ({ page }) => {
  // The transfer revokes the outgoing host's pass, so a claim that fails once
  // leaves the room with no host pass at all. The poll never changes this
  // effect's inputs, so without a retry nothing would ever try again.
  await mockApi(page);
  // mockApi seeds a host pass as well; this screen must start without one or
  // the claim is correctly skipped.
  await page.addInitScript(([roomId]) => {
    localStorage.removeItem('karaoke.host.' + roomId);
  }, [ROOM]);
  const promoted = {
    ...room(false),
    viewer: { memberId: 'm2', displayName: 'Jamie', role: 'host' },
  };
  await page.route('**/api/guest-room-read', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(promoted) });
  });
  let claims = 0;
  await page.route('**/api/claim-host', async (route) => {
    claims += 1;
    if (claims === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'The host pass could not be claimed' } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hostToken: 'h'.repeat(43) }),
    });
  });

  await page.goto('/room/' + ROOM, { waitUntil: 'networkidle' });

  await expect(page.getByText('You are the host now')).toBeVisible({ timeout: 15000 });
  expect(claims).toBeGreaterThan(1);
});

test('the stage says Ready on an idle room, never Autoplay on', async ({ page }) => {
  // The dot and its words used to share a catch-all that promised live
  // autoplay whenever nothing was wrong -- so an empty stage claimed playback
  // was running. "Ready" is the claim the data supports.
  await mockApi(page);
  const idle = {
    ...room(false),
    queue: [],
    playback: {
      currentSongId: null,
      currentVideoId: null,
      positionSeconds: 0,
      durationSeconds: null,
      isPlaying: false,
      updatedAt: null,
    },
  };
  await page.route('**/api/host-room-read', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(idle) });
  });
  // The status pill lives in the transport row, which is hidden below sm.
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/room/' + ROOM + '/host/stage', { waitUntil: 'networkidle' });

  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await expect(page.getByText('Autoplay on')).toHaveCount(0);
});

test('a failed handover keeps the confirmation open', async ({ page }) => {
  // transferRoom swallows its own error, so the dialog must be closed by the
  // reported outcome rather than by the await returning. Closing it anyway
  // leaves the host at a rebuilt list with a fading toast.
  await mockApi(page);
  await page.route('**/api/transfer-host', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'The room could not be transferred' } }),
    });
  });

  await page.goto('/room/' + ROOM + '/host/settings', { waitUntil: 'networkidle' });
  await page.getByLabel('Hand the room to Jamie').click();
  await page.getByRole('button', { name: 'Hand it over' }).click();

  await expect(page.getByText('The room could not be transferred.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hand it over' })).toBeVisible();
});

test('an empty room answer is reported as a failure, never as the host ending the room', async ({ page }) => {
  // The API client used to hand back a 200 with no body as if it were the room,
  // and "no room state" is the one state this screen renders as the host having
  // closed the room -- a claim the response never made.
  await mockApi(page);
  await page.route('**/api/guest-room-read', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '' });
  });

  await page.goto('/room/' + ROOM, { waitUntil: 'networkidle' });

  await expect(page.getByRole('alert')).toContainText('empty answer');
  await expect(page.getByText('This room has ended.')).toHaveCount(0);
});

test('host player uses a visible minimum-sized desktop frame and parks it on mobile queue', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/room/' + ROOM + '/host/queue', { waitUntil: 'networkidle' });
  const player = page.locator('[data-host-player]');
  await expect(player).toBeVisible();
  const desktop = await player.boundingBox();
  expect(desktop).not.toBeNull();
  expect(desktop!.width).toBeGreaterThanOrEqual(200);
  expect(desktop!.height).toBeGreaterThanOrEqual(200);
  const videoArea = await player.locator('[data-youtube-frame]').boundingBox();
  expect(videoArea).not.toBeNull();
  expect(videoArea!.width).toBeGreaterThanOrEqual(200);
  expect(videoArea!.height).toBeGreaterThanOrEqual(200);
  // The handle must be outside the video, not covering its top edge.
  expect(videoArea!.y).toBeGreaterThanOrEqual(desktop!.y + 40);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(player).toHaveCSS('opacity', '0');
  await expect(player).toHaveAttribute('aria-hidden', 'true');
});

test('host can refresh a populated songbook without losing existing songs', async ({ page }) => {
  const syncs: number[] = [];
  await mockApi(page, true, [], () => false, null, [], syncs);
  await page.goto('/room/' + ROOM + '/host/songbook', { waitUntil: 'networkidle' });
  await expect(page.getByText('Halo - Beyonce (Karaoke)')).toBeVisible();
  const refresh = page.getByRole('button', { name: 'Refresh the songbook' });
  await expect(refresh).toBeVisible();
  await refresh.click();
  // Without this the test passed on a click that did nothing: the row and the
  // button look the same whether or not a sync was ever sent.
  await expect.poll(() => syncs.length, 'the refresh never reached the server').toBeGreaterThan(0);
  await expect(page.getByText('Halo - Beyonce (Karaoke)')).toBeVisible();
  await expect(refresh).toBeEnabled();
});

async function undersized(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('button, input, a[href], [role="button"]')]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
    })
    .map((element) => ({
      label: (element.getAttribute('aria-label') || element.textContent || element.tagName).trim().replace(/\s+/g, ' ').slice(0, 50),
      width: Math.round(element.getBoundingClientRect().width),
      height: Math.round(element.getBoundingClientRect().height),
    })));
}

async function clipped(page: Page) {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    return [...document.querySelectorAll('button, a[href], input, [role="button"]')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.right > viewport + 1 || rect.left < -1);
      })
      .map((element) => (element.getAttribute('aria-label') || element.textContent || element.tagName).trim().slice(0, 50));
  });
}

test('home uses the shorter edge for the device class', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 2, name: /good company/i })).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: /join the room/i })).toBeVisible();
});

test('host creation warns and blocks automatic retries after an uncertain server response', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/api/auth/token')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'mock-jwt' }) });
      return;
    }
    if (path.endsWith('/api/create-room')) {
      attempts += 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Server unavailable' },
      }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByLabel('Your name').fill('Alex');
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page.getByRole('alert')).toContainText('may have been created');
  await expect(page.getByRole('button', { name: 'Create room' })).toBeDisabled();
  await page.getByLabel('Room name').fill('Different room');
  expect(attempts).toBe(1);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('alert')).toContainText('may have been created');
  await expect(page.getByRole('button', { name: 'Create room' })).toBeDisabled();
  expect(attempts).toBe(1);
  await page.getByRole('button', { name: 'Create another room anyway' }).click();
  expect(attempts).toBe(1);
  await page.getByLabel('Your name').fill('Alex');
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page.getByRole('alert')).toContainText('may have been created');
  expect(attempts).toBe(2);
});

test('the create action opens the create form and keeps the hosted room one click away', async ({ page }) => {
  await mockApi(page);
  // The host session the browser still holds a pass for, the way the app
  // remembers it after the host screen opened the room.
  await page.addInitScript(([roomId, code]) => {
    localStorage.setItem('karaoke.sessions', JSON.stringify([{
      roomId,
      code,
      roomName: 'Mock Night',
      hostName: 'Ana',
      role: 'host',
      lastSeenAt: new Date().toISOString(),
    }]));
    localStorage.setItem('karaoke.last-room', JSON.stringify({ roomId, role: 'host' }));
  }, [ROOM, 'ABCDEFGHJKMNPQRS']);
  // A short window is where the create action used to answer with the phone
  // join screen instead of the form that creates a room.
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/room/' + ROOM + '/host', { waitUntil: 'networkidle' });

  await page.getByRole('link', { name: 'Create room' }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByLabel('Room name')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create room' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /join the room/i })).toHaveCount(0);
  await expect(page.getByLabel('Room code')).toHaveCount(0);

  const back = page.getByRole('link', { name: 'Back to the room' });
  await expect(back).toHaveAttribute('href', '/room/' + ROOM + '/host');

  // On a wide window the create screen carries the sidebar the host arrived
  // from, so the room they still commands has to stay in it. It used to
  // collapse to a single "Create room" link beside a "Your next session" card.
  await page.setViewportSize({ width: 1440, height: 900 });
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: 'Room queue' }))
    .toHaveAttribute('href', '/room/' + ROOM + '/host/queue');
  await expect(nav.getByRole('link', { name: 'Discover' }))
    .toHaveAttribute('href', '/room/' + ROOM + '/host');
  await expect(page.getByText('Your next session')).toHaveCount(0);
  await expect(page.getByText("You're hosting this room.")).toBeVisible();

  await back.click();
  await expect(page).toHaveURL(new RegExp('/room/' + ROOM + '/host$'));
  await expect(page.getByRole('heading', { level: 1, name: 'Mock Night' })).toBeVisible();
});

// The bug that started this: a control named "Create room" that went
// somewhere else. Every sidebar label promises a destination, so each one is
// clicked and its landing checked, with no console error allowed in passing.
test('every host sidebar destination lands where its label says', async ({ page }) => {
  const noise: string[] = [];
  const note = (text: string) => noise.push(text);
  await mockApi(page);
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location();
    if (location.url.length === 0) {
      note('console: ' + message.text().slice(0, 140));
      return;
    }
    // The player is a YouTube frame and answers to YouTube's own policies --
    // it logs a compute-pressure violation on some Chrome builds. This gate is
    // about the app's console, so only same-origin messages count.
    try {
      if (new URL(location.url).origin === new URL(page.url()).origin) {
        note('console: ' + message.text().slice(0, 140));
      }
    } catch {
      note('console: ' + message.text().slice(0, 140));
    }
  });
  page.on('pageerror', (error) => note('pageerror: ' + error.message.slice(0, 140)));
  await page.setViewportSize({ width: 1440, height: 900 });

  const destinations: Array<{ label: string; path: string }> = [
    { label: 'Discover', path: '/room/' + ROOM + '/host' },
    { label: 'Song library', path: '/room/' + ROOM + '/host/library' },
    { label: 'Songbook', path: '/room/' + ROOM + '/host/songbook' },
    { label: 'Room queue', path: '/room/' + ROOM + '/host/queue' },
    { label: 'Favorites', path: '/room/' + ROOM + '/host/favorites' },
    { label: 'Recently sung', path: '/room/' + ROOM + '/host/recent' },
    { label: 'Create room', path: '/create' },
    { label: 'Room settings', path: '/room/' + ROOM + '/host/settings' },
  ];

  for (const destination of destinations) {
    await page.goto('/room/' + ROOM + '/host', { waitUntil: 'networkidle' });
    const link = page.getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: destination.label, exact: true });
    await expect(link, destination.label + ' is missing from the sidebar').toBeVisible();
    await link.click();
    await expect(page, destination.label + ' landed elsewhere')
      .toHaveURL((url) => url.pathname === destination.path);
  }
  expect(noise).toEqual([]);
});

// The party view is the screen a room actually watches, and RouteFocus only
// announces a screen that has a heading inside <main>. A playing song used to
// leave the view with none, so the route change announced nothing at all.
test('the party view names the playing song as its heading', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/room/' + ROOM + '/host/party', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Leave party view' })).toBeVisible();
  await expect(page.locator('main h1')).toContainText('Afterglow');
  // The transport still shows the same song; the heading must not replace it.
  await expect(page.getByText('Afterglow', { exact: true })).toHaveCount(2);
});

// Nothing in the suite drove a room by keyboard before. A control you can reach
// but not see is worse than one you cannot reach, so every tab stop on the
// screens a host and a guest live in has to paint a focus indicator.
test('every keyboard tab stop shows where focus landed', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const path of [
    '/room/' + ROOM + '/host',
    '/room/' + ROOM + '/host/queue',
    '/room/' + ROOM + '/host/settings',
    '/room/' + ROOM,
  ]) {
    await page.goto(path, { waitUntil: 'networkidle' });
    const blind: string[] = [];
    for (let press = 0; press < 24; press += 1) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (el === null || el === document.body) return null;
        const style = getComputedStyle(el);
        return {
          label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 34),
          tag: el.tagName,
          outlined: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
          shadowed: style.boxShadow !== 'none',
        };
      });
      if (focused === null) continue;
      // The player is a YouTube frame. Its focus ring is drawn by YouTube and no
      // stylesheet in this app can add to it or take it away.
      if (focused.tag === 'IFRAME') continue;
      if (!focused.outlined && !focused.shadowed) blind.push(focused.label + ' <' + focused.tag + '>');
    }
    expect(blind, path + ' has tab stops with no visible focus indicator').toEqual([]);
  }
});

// The store is unit-tested and the nav reaches the page, but nothing proved the
// heart of it: pressing the heart on a library card actually saves the song,
// remembers it across a reload, and shows up on the favorites page.
test('a favorited song survives a reload and reaches the favorites page', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  // The host screen records the room's songs locally; the library reads them back.
  await page.goto('/room/' + ROOM + '/host', { waitUntil: 'networkidle' });
  await page.goto('/room/' + ROOM + '/host/library', { waitUntil: 'networkidle' });

  const save = page.getByRole('button', { name: 'Save Afterglow to favorites' });
  await expect(save, 'the library never listed a song the room has queued').toBeVisible();
  await save.click();
  await expect(page.getByRole('button', { name: 'Remove Afterglow from favorites' })).toBeVisible();

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Remove Afterglow from favorites' }), 'the favorite did not survive a reload')
    .toBeVisible();

  await page.goto('/room/' + ROOM + '/host/favorites', { waitUntil: 'networkidle' });
  await expect(page.getByText('Afterglow').first(), 'the favorites page never showed the saved song').toBeVisible();
});

// The QR is how a room full of phones gets in, and a decorative one once passed
// through review unnoticed. Nothing here proved it is an encoded image.
test('the invite QR is a real encoded image', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/room/' + ROOM + '/host', { waitUntil: 'networkidle' });

  const src = await page.getByRole('img', { name: /QR code to join Mock Night/i }).first().getAttribute('src');
  expect(src ?? '', 'the invite card rendered no QR').toMatch(/^data:image\/png;base64,/);
  expect((src ?? '').length, 'the QR image is too small to hold a join link').toBeGreaterThan(2000);
});

// The other thing a host notices without looking for it: the room going quiet
// while everyone is still singing, and coming back by itself.
test('the host screen reports a dropped room and recovers on its own', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/room/' + ROOM + '/host', { waitUntil: 'networkidle' });

  await page.route('**/api/host-room-read', async (route) => { await route.abort('connectionrefused'); });
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText('Reconnecting').first(), 'the host was never told the room went quiet')
    .toBeVisible({ timeout: 25_000 });

  await page.unroute('**/api/host-room-read');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('Reconnecting')).toHaveCount(0, { timeout: 25_000 });
  await expect(page.getByText('Connection restored.'), 'the recovery went unannounced').toBeVisible();
});

// The roster keeps everyone who joined while the room lives, and the rows under
// the head-count label the drifted-off ones "Away". A total that folded them in
// contradicted the list a few pixels below it.
test('the host header counts only the people still here', async ({ page }) => {
  await mockApi(page, false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/room/' + ROOM + '/host', { waitUntil: 'networkidle' });

  await expect(page.getByText('1 here · 1 away')).toBeVisible();
  await expect(page.getByText('2 people')).toHaveCount(0);
});

// WCAG 2.5.8 sets the floor for a pointer target at 24x24 CSS px. The host
// screen's "compact is fine" convention was written for a big screen, but four
// prose links measured 17px tall at every width, including on a phone where a
// host opens their own room. Links and buttons only: the stage's seek slider is
// a different shape and is not being claimed as fixed here.
test('no host link or button is smaller than the 24px target floor', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });

  for (const path of [
    '/room/' + ROOM + '/host',
    '/room/' + ROOM + '/host/queue',
    '/room/' + ROOM + '/host/stage',
    '/room/' + ROOM + '/host/settings',
  ]) {
    await page.goto(path, { waitUntil: 'networkidle' });
    const tiny = await page.evaluate(() => [...document.querySelectorAll('a[href], button')]
      .map((el) => ({
        label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30),
        rect: el.getBoundingClientRect(),
      }))
      .filter(({ label, rect }) => label.length > 0
        && rect.width > 0 && rect.height > 0
        && (rect.width < 24 || rect.height < 24))
      .map(({ label, rect }) => label + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height)));
    expect(tiny, path + ' has targets under 24px').toEqual([]);
  }
});

test('guest search keeps 44px controls and reflows at 200% text', async ({ page }) => {
  await mockApi(page);
  await openGuestSearch(page);

  expect(await undersized(page)).toEqual([]);
  expect(await clipped(page)).toEqual([]);
  await expect(page.getByRole('button', { name: /^add a very long karaoke title/i }).first()).toBeVisible();

  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.waitForTimeout(250);
  expect(await clipped(page)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.locator('#song-search').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle);
  expect(outline).not.toBe('none');
});

test('guest songbook keeps 44px controls and reflows at 200% text', async ({ page }) => {
  // The plan binds guest phone controls to >=44px with no overflow at 200% text,
  // and this screen adds a filter box, five chips and a row of Add buttons per
  // song. Assert the rendered rows first: an empty shell passes a sizing sweep.
  const catalogQueries: string[] = [];
  await mockApi(page, true, [], () => false, null, catalogQueries);
  await page.goto('/room/' + ROOM + '/songbook', { waitUntil: 'networkidle' });

  await expect(page.getByRole('heading', { name: 'Karaoke songbook' })).toBeVisible();
  const rows = page.locator('ul[aria-label="Songbook songs"] li');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(5);

  const chips = page.getByRole('group', { name: 'Filter by channel' }).locator('button');
  expect(await chips.count()).toBe(5);

  expect(await undersized(page)).toEqual([]);
  expect(await clipped(page)).toEqual([]);

  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.waitForTimeout(250);

  expect(await undersized(page)).toEqual([]);
  expect(await clipped(page)).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // A chip is the one control that can silently drop below 44px by shrinking to
  // its text, so drive one and keep asserting the screen is still usable.
  await chips.nth(1).click();
  await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
  expect(await clipped(page)).toEqual([]);

  // "All" is the only way back to an unfiltered songbook, and its reset was
  // previously unproven: a chip that stayed pressed would filter silently.
  await chips.first().click();
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'false');
});

test('popular karaoke strip slides with previous and next controls', async ({ page }) => {
  const karaoke = Array.from({ length: 8 }, (_, index) => ({
    videoId: 'karaoke' + String(index).padStart(4, '0'),
    title: 'Karaoke Song ' + (index + 1),
    channelTitle: 'Karaoke Channel',
    thumbnailUrl: null,
    durationSeconds: null,
  }));
  await mockApi(page, true, [], () => false, karaoke);
  await page.goto('/room/' + ROOM, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Search' }).click();

  await expect(page.getByText('Popular karaoke')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View more' })).toHaveAttribute('href', '/room/' + ROOM + '/songbook');
  const strip = page.getByRole('list', { name: 'Popular karaoke songs' });
  await expect(strip).toBeVisible();

  const previous = page.getByRole('button', { name: 'Previous popular karaoke songs' });
  const next = page.getByRole('button', { name: 'Next popular karaoke songs' });
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  for (const control of [previous, next]) {
    const box = await control.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const before = await strip.evaluate((element) => element.scrollLeft);
  await next.click();
  await expect.poll(async () => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before);
  await expect(previous).toBeEnabled();

  await previous.click();
  await expect.poll(async () => strip.evaluate((element) => element.scrollLeft)).toBe(0);
  await expect(previous).toBeDisabled();
});

test('host opens the songbook from the karaoke strip and queues a song', async ({ page }) => {
  const popular = [1, 2, 3].map((index) => ({
    videoId: 'popular' + index,
    title: 'Karaoke Song ' + index,
    channelTitle: 'Karaoke Channel',
    thumbnailUrl: null,
    durationSeconds: null,
  }));
  const commands: Array<{ action?: string; videoId?: string; roomId?: string }> = [];
  const catalogQueries: string[] = [];
  await mockApi(page, true, commands, () => false, popular, catalogQueries);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/room/' + ROOM + '/host', { waitUntil: 'networkidle' });

  await page.getByRole('link', { name: 'View more' }).click();
  await expect(page).toHaveURL(new RegExp('/host/songbook$'));
  await expect(page.getByRole('heading', { name: 'Karaoke songbook' })).toBeVisible();

  const rows = page.locator('ul[aria-label="Songbook songs"] li');
  await expect(rows).toHaveCount(30);

  await page.getByLabel('Search the songbook').fill('halo');
  await expect(rows).toHaveCount(1);
  await expect(page.getByText('Halo - Beyonce (Karaoke)')).toBeVisible();
  expect(catalogQueries.at(-1)).toBe('halo');

  await page.getByRole('button', { name: 'Add Halo - Beyonce (Karaoke)' }).click();
  await expect.poll(() => commands.filter((command) => command.action === 'add').length).toBe(1);
  const adds = commands.filter((command) => command.action === 'add');
  expect(adds).toHaveLength(1);
  expect(adds[0]).toMatchObject({ action: 'add', videoId: 'video000000', roomId: ROOM });
});

test('host discover shows one live QR invite in the hero and scrollable vertical song suggestions', async ({ page }) => {
  const popular = Array.from({ length: 8 }, (_, index) => ({
    videoId: 'karaoke' + String(index).padStart(4, '0'),
    title: 'Karaoke Pick ' + (index + 1),
    channelTitle: 'Music Channel',
    thumbnailUrl: null,
    durationSeconds: null,
  }));
  await mockApi(page, true, [], () => false, popular);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/room/' + ROOM + '/host', { waitUntil: 'networkidle' });

  const hero = page.locator('[data-host-hero="room-invite"]');
  await expect(hero.getByRole('region', { name: 'Invite your people' })).toBeVisible();
  await expect(page.getByText('Sing live from YouTube.')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Invite your people' })).toHaveCount(1);
  const list = page.getByRole('list', { name: 'Popular karaoke songs' });
  await expect(list).toHaveAttribute('data-layout', 'vertical');
  await expect.poll(async () => list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await list.focus();
  await page.keyboard.press('End');
  await expect.poll(async () => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('host QR payload points to the actual guest join route with its live room code', async ({ page }) => {
  await mockApi(page);
  await page.goto('/room/' + ROOM + '/host', { waitUntil: 'networkidle' });
  const hero = page.locator('[data-host-hero="room-invite"]');
  const actualJoinUrl = new URL('/join/ABCDEFGHJKMNPQRS', page.url()).toString();
  await expect(hero.locator('img[data-join-url]')).toHaveAttribute('data-join-url', actualJoinUrl);
  await page.goto(actualJoinUrl, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Join the room.' })).toBeVisible();
  await expect(page.getByLabel('Room code')).toHaveValue('ABCDEFGHJKMNPQRS');
  await expect(page.getByLabel('Your name')).toBeVisible();
});

test('host QR hero and vertical suggestions fit phone/tablet widths and 200 percent text', async ({ page }) => {
  const popular = Array.from({ length: 8 }, (_, index) => ({
    videoId: 'karaoke' + String(index).padStart(4, '0'),
    title: 'A long karaoke suggestion title to test narrow screens ' + index,
    channelTitle: 'A karaoke creator',
    thumbnailUrl: null,
    durationSeconds: null,
  }));
  await mockApi(page, true, [], () => false, popular);
  for (const [width, height] of [[390, 844], [768, 1024]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/room/' + ROOM + '/host', { waitUntil: 'networkidle' });
    const hero = page.locator('[data-host-hero="room-invite"]');
    await expect(hero.getByRole('region', { name: 'Invite your people' })).toBeVisible();
    const list = page.getByRole('list', { name: 'Popular karaoke songs' });
    await expect(list).toHaveAttribute('data-layout', 'vertical');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const invite = page.locator('[data-host-hero="room-invite"]');
  await expect(invite.getByRole('region', { name: 'Invite your people' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);
});

test('guest queue does not promise auto-advance while the host is offline', async ({ page }) => {
  await mockApi(page, false);
  await page.goto('/room/' + ROOM, { waitUntil: 'networkidle' });
  await expect(page.getByText(/the host screen is offline/i).first()).toBeVisible();
  await expect(page.getByText(/automatic advance is on/i)).toHaveCount(0);
});

test('host does not pause a playing room while React probes effects', async ({ page }) => {
  const commands: Array<{ action?: string }> = [];
  await mockApi(page, true, commands);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/room/' + ROOM + '/host', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  expect(commands.filter((command) => command.action === 'pause')).toHaveLength(0);
});

test('host pauses the server when its controls disappear', async ({ page }) => {
  const commands: Array<{ action?: string }> = [];
  let fail = false;
  await mockApi(page, true, commands, () => fail);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/room/' + ROOM + '/host', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  fail = true;
  await page.waitForTimeout(6500);
  expect(commands.some((command) => command.action === 'pause')).toBe(true);
});

async function tooltipRect(page: Page, label: string) {
  return page.evaluate((wanted) => {
    const button = [...document.querySelectorAll('button[aria-label]')]
      .find((element) => element.getAttribute('aria-label') === wanted);
    const anchor = button?.closest('.tooltip');
    if (anchor === null || anchor === undefined) return null;
    const style = getComputedStyle(anchor, '::after');
    const box = anchor.getBoundingClientRect();
    const px = (value: string) => Number.parseFloat(value);
    const height = px(style.height);
    const width = px(style.width);
    const top = style.top === 'auto' ? box.bottom - px(style.bottom) - height : box.top + px(style.top);
    const left = style.left === 'auto' ? box.right - px(style.right) - width : box.left + px(style.left);
    return { top, left, bottom: top + height, right: left + width, opacity: Number(style.opacity) };
  }, label);
}

test('host header labels its back control inside the viewport', async ({ page }) => {
  await mockApi(page);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/room/' + ROOM + '/host', { waitUntil: 'networkidle' });
    const button = page.getByRole('button', { name: 'Back to home' });
    await expect(button).toBeVisible();
    await button.hover();
    await expect.poll(async () => (await tooltipRect(page, 'Back to home'))?.opacity).toBe(1);

    const tip = await tooltipRect(page, 'Back to home');
    expect(tip).not.toBeNull();
    expect(tip!.top).toBeGreaterThanOrEqual(0);
    expect(tip!.left).toBeGreaterThanOrEqual(0);
    expect(tip!.bottom).toBeLessThanOrEqual(viewport.height);
    expect(tip!.right).toBeLessThanOrEqual(viewport.width);
  }
});

test('host floating video stays clear of header controls', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/room/' + ROOM + '/host', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: 'Party view' })).toBeVisible();
  await page.waitForSelector('[data-host-player]', { state: 'visible' });
  const geometry = await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('[data-host-player]');
    const party = [...document.querySelectorAll('a')].find((link) => link.textContent?.trim() === 'Party view');
    const frameRect = frame?.getBoundingClientRect();
    const partyRect = party?.getBoundingClientRect();
    if (frameRect === undefined || partyRect === undefined) return null;
    const top = document.elementFromPoint(partyRect.x + partyRect.width / 2, partyRect.y + partyRect.height / 2);
    return {
      overlaps: !(frameRect.right < partyRect.left || frameRect.left > partyRect.right
        || frameRect.bottom < partyRect.top || frameRect.top > partyRect.bottom),
      topIsParty: top === party || party?.contains(top) === true,
    };
  });
  expect(geometry).toEqual({ overlaps: false, topIsParty: true });
});

test('the host console keeps 44 pixel touch targets', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto('/room/' + ROOM + '/host/queue', { waitUntil: 'networkidle' });

  const controls = [
    page.getByLabel('Back 10 seconds'),
    page.getByRole('button', { name: /^(Play|Pause)$/ }),
    page.getByLabel('Skip song'),
    page.getByRole('link', { name: 'Open stage' }),
    page.getByRole('button', { name: /^Second / }).first(),
    page.getByRole('button', { name: /^Move .* up$/ }).first(),
    page.getByRole('button', { name: /^Remove / }).first(),
  ];

  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
