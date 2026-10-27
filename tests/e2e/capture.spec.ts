import { expect, test } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

// Capture the ECHO look for review.
test('capture screens', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(BASE + '/');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/screens/create-room.png', fullPage: true });

  await page.getByLabel('Room name').fill('After Hours');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.waitForURL(/\/host$/, { timeout: 20000 });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'test-results/screens/discover.png', fullPage: true });

  const hostId = page.url().split('/room/')[1]?.split('/')[0] ?? '';
  await page.goto(BASE + '/room/' + hostId + '/host/queue');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/screens/host-queue.png', fullPage: true });

  await page.goto(BASE + '/room/' + hostId + '/host/settings');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/screens/host-settings.png', fullPage: true });

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const qr = page.locator('img[data-join-url]').first();
  await expect(qr).toHaveAttribute('data-join-url', /\/join\//);
  const joinUrl = await qr.getAttribute('data-join-url');
  if (joinUrl !== null) {
    await page.goto(joinUrl);
    await page.waitForTimeout(500);
    await phone.goto(joinUrl);
    await phone.waitForTimeout(500);
    await phone.screenshot({ path: 'test-results/screens/join-phone.png', fullPage: true });
  }
});
