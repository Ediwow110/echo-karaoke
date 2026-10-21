import { expect, test } from '@playwright/test';

// Capture the dark premium look for review.
test('capture screens', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto('/');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/screens/landing.png', fullPage: true });

  await page.getByLabel(/host name/i).fill('Showcase Host');
  await page.getByRole('button', { name: /create room/i }).click();
  await expect(page.getByText(/host screen/i)).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/screens/host-normal.png', fullPage: true });

  await page.getByRole('button', { name: 'Theater' }).click();
  await expect(page.locator('main.room-theater')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/screens/host-theater.png', fullPage: true });
});
