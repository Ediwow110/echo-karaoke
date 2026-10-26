import { expect, test, type Browser, type Page } from '@playwright/test';

// These tests drive the real SPA and the same-origin Vercel Function.
// Start: npx vercel dev, then set E2E_BASE_URL only for a different origin.

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

async function createRoom(page: Page, roomName = 'After Hours', hostName = 'Alex'): Promise<{ code: string; joinUrl: string }> {
  await page.goto(BASE + '/');
  await page.getByLabel('Room name').fill(roomName);
  await page.getByLabel('Your name').fill(hostName);
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.waitForURL(/\/host$/, { timeout: 20000 });
  await expect(page.getByRole('heading', { level: 1, name: roomName })).toBeVisible();

  const qr = page.locator('img[data-join-url]').first();
  await expect(qr).toHaveAttribute('data-join-url', /\/join\/[0-9A-Z]{16}$/, { timeout: 20000 });
  const joinUrl = await qr.getAttribute('data-join-url');
  if (joinUrl === null) {
    throw new Error('The room QR did not carry a join URL');
  }
  return { code: joinUrl.split('/').pop() ?? '', joinUrl };
}

async function joinRoom(browser: Browser, code: string, guestName: string, viewport = { width: 390, height: 844 }): Promise<Page> {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 640, deviceScaleFactor: 1 });
  const guest = await context.newPage();
  await guest.goto(BASE + '/join/' + code);
  await guest.getByLabel('Your name').fill(guestName);
  await guest.getByRole('button', { name: 'Join room' }).click();
  await guest.waitForURL(/\/room\/[0-9a-f-]{36}$/, { timeout: 20000 });
  return guest;
}

function roomIdFromUrl(url: string): string {
  return url.split('/room/')[1]?.split(/[/?#]/)[0] ?? '';
}

async function searchForSong(page: Page) {
  const search = page.getByLabel('Find a song on YouTube');
  await expect(search).toBeVisible();
  await expect(page.getByLabel('Add by YouTube link')).toHaveCount(0);
  await search.fill('Rick Astley Never Gonna Give You Up');
  const result = page.getByRole('list', { name: 'Songs', exact: true })
    .getByRole('listitem').filter({ hasText: /never gonna give you up/i }).first();
  await expect(result).toBeVisible({ timeout: 20000 });
  return result.getByRole('button', { name: /^Add /i });
}

async function undersizedControls(page: Page): Promise<Array<{ label: string; width: number; height: number }>> {
  return page.evaluate(() => {
    const visible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    return [...document.querySelectorAll('button, input, textarea, select, a[href], [role="button"]')]
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 44),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter((entry) => entry.width < 44 || entry.height < 44);
  });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function clippedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    return [...document.querySelectorAll('button, a[href], input, [role="button"]')]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { rect, label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 44) };
      })
      .filter(({ rect }) => rect.width > 0 && rect.height > 0 && (rect.right > viewport + 1 || rect.left < -1))
      .map(({ label }) => label);
  });
}

test('the QR encodes the real join URL and a guest can join from it', async ({ page, browser }) => {
  const { code, joinUrl } = await createRoom(page, 'QR Night', 'Host Ana');

  const decoded = await page.evaluate(async () => {
    const image = document.querySelector('img[data-join-url]') as HTMLImageElement | null;
    if (image === null) return null;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (context === null) return null;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    // Vite's dev resolver exposes the locally installed decoder.
    // @ts-expect-error the dev-only module specifier is resolved by Vite at runtime
    const module = await import('/@id/jsqr');
    return module.default(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  });

  expect(decoded).toBe(joinUrl);

  const guest = await joinRoom(browser, code, 'Guest Sam');
  await expect(guest.getByRole('heading', { level: 1, name: 'QR Night' })).toBeVisible();
  await expect(guest.getByText(/hosted by host ana/i)).toBeVisible();
  await expect(guest.getByRole('link', { name: /queue ·/i })).toBeVisible();

  const hostId = roomIdFromUrl(page.url());
  await page.goto(BASE + '/room/' + hostId + '/host/settings');
  await expect(page.getByText('Guest Sam')).toBeVisible({ timeout: 15000 });

  await guest.context().close();
});

test('a host reopening the invite returns to the host screen', async ({ page }) => {
  const { joinUrl } = await createRoom(page, 'Host Guard', 'Host Mia');

  await page.goto(joinUrl);
  await page.getByLabel('Your name').fill('Mia Guest');
  await page.getByRole('button', { name: 'Join room' }).click();

  await page.waitForURL(/\/host$/, { timeout: 20000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Host Guard' })).toBeVisible();
  await expect(page.getByText('Hosted by Host Mia')).toBeVisible();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Room settings' })).toBeVisible();
});

test('a guest adds a song and the host sees it in the queue', async ({ page, browser }) => {
  const { code } = await createRoom(page, 'Queue Night', 'Host Ben');
  const guest = await joinRoom(browser, code, 'Guest Kim');
  const guestRoomId = roomIdFromUrl(guest.url());

  await guest.getByRole('link', { name: 'Search' }).click();
  await (await searchForSong(guest)).click();
  await expect(
    guest.getByRole('status').filter({ hasText: /never gonna give you up/i })
  ).toBeVisible({ timeout: 20000 });

  await guest.getByRole('link', { name: /queue ·/i }).click();
  await expect(guest.getByRole('list', { name: 'Up next' }).getByText(/never gonna give you up/i)).toBeVisible({ timeout: 15000 });
  expect(guestRoomId.length).toBeGreaterThan(0);

  const hostId = roomIdFromUrl(page.url());
  await page.goto(BASE + '/room/' + hostId + '/host/queue');
  await expect(page.locator('#song-queue').getByText(/never gonna give you up/i)).toBeVisible({ timeout: 20000 });

  await guest.context().close();
});

test('the host admits a guest and keeps playback control', async ({ page, browser }) => {
  const { code } = await createRoom(page, 'Rules Night', 'Host Cleo');
  const guest = await joinRoom(browser, code, 'Guest Dee');
  const hostId = roomIdFromUrl(page.url());

  // Every new room moderates entry now, so the guest waits until the host opens it.
  await expect(guest.getByText(/needs to let you in/i)).toBeVisible({ timeout: 15000 });

  await page.goto(BASE + '/room/' + hostId + '/host/settings');
  const approval = page.getByRole('switch', { name: /approve each guest/i });
  const playback = page.getByRole('switch', { name: /guests can pause or resume/i });
  await expect(approval).toBeChecked();
  await expect(playback).not.toBeChecked();
  // Adding songs is not a permission any more, so there is no switch to find.
  await expect(page.getByRole('switch', { name: /guests can add songs/i })).toHaveCount(0);

  await page.getByRole('button', { name: /^Let Guest Dee in$/ }).click();
  await expect(guest.getByText(/shared playlist/i)).toBeVisible({ timeout: 15000 });

  await playback.click();
  await guest.getByRole('link', { name: /queue ·/i }).click();
  await expect(guest.getByText(/you can pause and resume/i)).toBeVisible({ timeout: 15000 });

  await guest.context().close();
});

test('an unknown room code reports that the room does not exist', async ({ page }) => {
  await page.goto(BASE + '/join/AAAAAAAABBBBBBBB');
  await page.getByLabel('Your name').fill('Lost Singer');
  await page.getByRole('button', { name: 'Join room' }).click();
  await expect(page.getByRole('alert')).toContainText(/no room uses that code/i);
});

test('a phone remote joins and shows the shared queue', async ({ page, browser }) => {
  const { code } = await createRoom(page, 'Phone Night', 'Host Fay');
  const guest = await joinRoom(browser, code, 'Guest Gil', { width: 390, height: 844 });

  await expect(guest.getByRole('heading', { level: 1, name: 'Phone Night' })).toBeVisible();
  await expect(guest.getByRole('heading', { name: /the room queue/i })).toBeVisible();
  await expect(guest.getByRole('link', { name: /queue ·/i })).toBeVisible();

  await guest.context().close();
});

test('switching sessions replaces the room and its player', async ({ page }) => {
  await createRoom(page, 'First Session', 'Host One');
  await createRoom(page, 'Second Session', 'Host Two');
  await expect(page.getByRole('heading', { level: 1, name: 'Second Session' })).toBeVisible();
  await page.waitForSelector('[data-host-player] iframe', { timeout: 20000 });
  await page.evaluate(() => {
    (window as unknown as { __secondRoomFrame?: Element | null }).__secondRoomFrame = document.querySelector('[data-host-player] iframe');
  });

  await page.getByRole('link', { name: 'First Session', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'First Session' })).toBeVisible();
  await page.waitForSelector('[data-host-player] iframe', { timeout: 20000 });

  const replaced = await page.evaluate(() => {
    const previous = (window as unknown as { __secondRoomFrame?: Element | null }).__secondRoomFrame;
    return previous !== null && previous !== document.querySelector('[data-host-player] iframe');
  });
  expect(replaced).toBe(true);

  await page.getByRole('link', { name: 'Second Session', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Second Session' })).toBeVisible();
});

test('the phone remote keeps full touch targets and reflows at 200% text', async ({ page, browser }) => {
  const { code } = await createRoom(page, 'Access Night', 'Host Uma');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.waitForTimeout(300);
  expect(await clippedControls(page)).toEqual([]);
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const guest = await joinRoom(browser, code, 'Guest Zoe');
  await guest.getByRole('link', { name: 'Search' }).click();
  await (await searchForSong(guest)).click();
  await guest.getByText(/never gonna give you up.*added/i).waitFor({ timeout: 20000 });
  await guest.getByRole('link', { name: /queue ·/i }).click();
  await guest.getByRole('list', { name: 'Up next' }).waitFor({ timeout: 15000 });

  expect(await undersizedControls(guest)).toEqual([]);
  expect(await horizontalOverflow(guest)).toBeLessThanOrEqual(0);

  await guest.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await guest.waitForTimeout(300);
  expect(await horizontalOverflow(guest)).toBeLessThanOrEqual(0);
  await guest.evaluate(() => { document.documentElement.style.fontSize = ''; });

  const joinContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const joinPage = await joinContext.newPage();
  await joinPage.goto(BASE + '/join/' + code);
  await joinPage.getByRole('heading', { name: 'Join the room.' }).waitFor({ timeout: 20000 });
  expect(await undersizedControls(joinPage)).toEqual([]);
  await joinPage.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await joinPage.waitForTimeout(300);
  expect(await horizontalOverflow(joinPage)).toBeLessThanOrEqual(0);

  await joinContext.close();
  await guest.context().close();
});
