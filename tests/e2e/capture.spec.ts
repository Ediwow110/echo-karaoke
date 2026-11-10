import { expect, test } from '@playwright/test';
import { resolveE2EBaseURL } from '../../scripts/e2e-target.mjs';

const BASE = resolveE2EBaseURL();

// Capture the ECHO look for review.
test('capture screens', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(BASE + '/');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/screens/create-room.png', fullPage: true });

  await page.getByText('Room details').click();
  await page.getByLabel('Room name').fill('After Hours');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByRole('button', { name: 'Launch TV' }).click();
  await page.waitForURL(/\/host\/party$/, { timeout: 20000 });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'test-results/screens/tv-stage.png', fullPage: true });

  await page.getByRole('button', { name: 'Switch to computer' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/screens/host-computer.png', fullPage: true });

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
