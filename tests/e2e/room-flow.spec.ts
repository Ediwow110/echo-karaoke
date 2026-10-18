import { expect, test } from '@playwright/test';

// These tests drive the real SPA against the local Supabase stack.
// Start: npx supabase start, npx supabase functions serve, npm run dev

async function createRoom(page: import('@playwright/test').Page, hostName: string) {
  await page.goto('/');
  await page.getByLabel(/host name/i).fill(hostName);
  await page.getByRole('button', { name: /create room/i }).click();
  await expect(page.getByText(/host screen/i)).toBeVisible();
}

async function readRoomCode(page: import('@playwright/test').Page): Promise<string> {
  const code = page.locator('.join-code');
  await expect(code).toBeVisible();
  return (await code.textContent())?.trim() ?? '';
}

test('host creates a room and a guest joins from another browser', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await createRoom(host, 'Host Ana');
  const code = await readRoomCode(host);
  expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);

  await guest.goto('/join/' + code);
  await guest.getByLabel(/your name/i).fill('Guest Sam');
  await guest.getByRole('button', { name: /join room/i }).click();

  await expect(guest.getByRole('heading', { name: 'Guest Sam' })).toBeVisible();
  await expect(guest.getByText(/room code/i)).toContainText(code);

  // The host sees both singers in the roster.
  await expect(host.getByText('Guest Sam')).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});

test('a guest adds a song and the host sees it queued', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await createRoom(host, 'Host Ben');
  const code = await readRoomCode(host);

  await guest.goto('/join/' + code);
  await guest.getByLabel(/your name/i).fill('Guest Kim');
  await guest.getByRole('button', { name: /join room/i }).click();
  await expect(guest.getByRole('heading', { name: 'Guest Kim' })).toBeVisible();

  await guest.getByLabel(/paste a youtube link/i).fill('https://youtu.be/dQw4w9WgXcQ');
  await guest.getByRole('button', { name: /add to queue/i }).click();

  await expect(guest.getByRole('status')).toContainText(/in the queue/i, { timeout: 20000 });
  await expect(host.getByText(/never gonna give you up/i)).toBeVisible({ timeout: 20000 });

  await hostContext.close();
  await guestContext.close();
});

test('the host can lock guests and the remote explains why controls stop', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await createRoom(host, 'Host Cleo');
  const code = await readRoomCode(host);

  await guest.goto('/join/' + code);
  await guest.getByLabel(/your name/i).fill('Guest Dee');
  await guest.getByRole('button', { name: /join room/i }).click();
  await expect(guest.getByRole('heading', { name: 'Guest Dee' })).toBeVisible();

  await host.getByRole('button', { name: 'Lock guest controls', exact: true }).click();
  await expect(host.getByText(/guest controls are locked/i)).toBeVisible();
  await expect(guest.getByText(/guest controls are locked/i)).toBeVisible({ timeout: 15000 });

  await expect(guest.getByRole('button', { name: /^skip$/i })).toBeDisabled();

  await host.getByRole('button', { name: 'Unlock guest controls', exact: true }).click();
  await expect(guest.getByRole('button', { name: /^skip$/i })).toBeEnabled({ timeout: 15000 });

  await hostContext.close();
  await guestContext.close();
});

test('an unknown room code reports that the room does not exist', async ({ page }) => {
  await page.goto('/join/AAAAAAAABBBBBBBB');
  await page.getByLabel(/your name/i).fill('Lost Singer');
  await page.getByRole('button', { name: /join room/i }).click();

  await expect(page.getByRole('alert')).toContainText(/no room uses that code/i);
});
test('typing shows YouTube songs and adding lands on the queue', async ({ page }) => {
  await createRoom(page, 'Host Eve');

  // Both add paths are offered on the host screen: live search and paste.
  await expect(page.getByLabel(/find a song on youtube/i)).toBeVisible();
  await expect(page.getByLabel(/paste a youtube link/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /view queue/i })).toBeVisible();

  // Typing pulls real YouTube suggestions without an API key.
  await page.getByLabel(/find a song on youtube/i).fill('dancing queen');
  const suggestions = page.getByLabel(/song suggestions/i).getByRole('button');
  await expect(suggestions.first()).toBeVisible({ timeout: 20000 });
  expect(await suggestions.count()).toBeGreaterThan(2);

  // Choosing one asks for the songs behind that term.
  await suggestions.first().click();
  await expect(page.getByRole('button', { name: /show songs/i })).toBeEnabled();

  // Adding by link still works and drops the singer on the queue.
  await page.getByLabel(/paste a youtube link/i).fill('https://youtu.be/dQw4w9WgXcQ');
  await page.getByRole('button', { name: /add to queue/i }).click();
  await expect(page.getByText(/is in the queue/i)).toBeVisible({ timeout: 20000 });

  await page.getByRole('button', { name: /view queue/i }).click();
  const queue = page.locator('#song-queue');
  await expect(queue).toBeVisible();
  await expect(queue.getByText(/never gonna give you up/i)).toBeVisible({ timeout: 20000 });
});

test('the wireless remote offers search and the shared queue', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await createRoom(host, 'Host Fay');
  const code = await readRoomCode(host);

  await guest.goto('/join/' + code);
  await guest.getByLabel(/your name/i).fill('Guest Gil');
  await guest.getByRole('button', { name: /join room/i }).click();
  await expect(guest.getByRole('heading', { name: 'Guest Gil' })).toBeVisible();

  // The remote can search YouTube and reach the shared queue.
  await expect(guest.getByLabel(/find a song on youtube/i)).toBeVisible();
  await expect(guest.getByRole('button', { name: /view queue/i })).toBeVisible();
  await expect(guest.locator('#song-queue')).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});