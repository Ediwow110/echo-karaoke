import { expect, test } from '@playwright/test';

// Layout geometry: the room must use the wide screen and the player modes
// must behave like YouTube's normal / theater / fullscreen controls.
test('the room uses the wide screen with player and tools side by side', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByLabel(/host name/i).fill('Layout Host');
  await page.getByRole('button', { name: /create room/i }).click();
  await expect(page.getByText(/host screen/i)).toBeVisible();

  const shell = page.locator('main.room-shell');
  const main = page.locator('.room-main');
  const aside = page.locator('.room-aside');
  const player = page.locator('.player-stage');

  const shellBox = await shell.boundingBox();
  const mainBox = await main.boundingBox();
  const asideBox = await aside.boundingBox();
  const playerBox = await player.boundingBox();

  expect(shellBox).not.toBeNull();
  expect(mainBox).not.toBeNull();
  expect(asideBox).not.toBeNull();
  expect(playerBox).not.toBeNull();

  // Full bleed like YouTube: the shell is the viewport minus slim gutters only.
  expect(shellBox!.width).toBeGreaterThan(1520);
  expect(shellBox!.x).toBeLessThan(30);

  // Tools sit beside the player, not stacked far below it.
  expect(asideBox!.x).toBeGreaterThan(mainBox!.x + mainBox!.width - 8);
  expect(Math.abs(asideBox!.y - mainBox!.y)).toBeLessThan(40);

  // Theater: the player grows and the tools drop below it.
  const normalWidth = playerBox!.width;
  await page.getByRole('button', { name: 'Theater' }).click();
  await expect(page.locator('main.room-theater')).toBeVisible();

  const theaterPlayer = await player.boundingBox();
  const theaterAside = await aside.boundingBox();
  expect(theaterPlayer!.width).toBeGreaterThan(normalWidth + 100);
  expect(theaterAside!.y).toBeGreaterThan(theaterPlayer!.y + theaterPlayer!.height - 8);

  await page.getByRole('button', { name: 'Normal' }).click();
  await expect(page.locator('main.room-theater')).toHaveCount(0);

  // Fullscreen hands the whole panel to the browser and keeps controls reachable.
  await page.getByRole('button', { name: 'Fullscreen' }).click();
  await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Exit fullscreen' }).click();
  await expect(page.getByRole('button', { name: 'Fullscreen' })).toBeVisible({ timeout: 10000 });
});