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

  await expect(guest.getByRole('status')).toContainText(/added/i, { timeout: 20000 });
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
