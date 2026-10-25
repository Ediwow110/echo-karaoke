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
  await mockApi(page);
  await page.goto('/room/' + ROOM + '/host/songbook', { waitUntil: 'networkidle' });
  await expect(page.getByText('Halo - Beyonce (Karaoke)')).toBeVisible();
  const refresh = page.getByRole('button', { name: 'Refresh the songbook' });
  await expect(refresh).toBeVisible();
  await refresh.click();
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
