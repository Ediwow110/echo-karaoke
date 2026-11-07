import { expect, type Page } from '@playwright/test';

// A goto that only waits for the document to load returns while the lazy route
// chunk is still in flight: measured on the dev server, a room screen had zero
// links and buttons at that moment and one a second later. Tests that then
// measure, or assert a control count of zero, pass without ever having looked
// at the screen.
//
// `networkidle` used to hide this, at a cost: 720 ms per navigation against
// 160 ms for `load`, and it waits for a quiet window that the room screens'
// polling keeps interrupting. RouteFocus stamps the mounted screen's own
// heading with `data-route-focus`, so the specs wait for that instead -- the
// earliest fact that means "this screen is on screen".
export async function openScreen(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'load' });
  await expect(page.locator('[data-route-focus]')).toBeAttached();
}

export async function reloadScreen(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('[data-route-focus]')).toBeAttached();
}
