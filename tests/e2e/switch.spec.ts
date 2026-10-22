import { expect, test } from '@playwright/test';

test('the switch thumb stays inside its track in both states', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('switch').first();
  await expect(toggle).toBeVisible();

  const measure = () => toggle.evaluate((element) => {
    const track = element.getBoundingClientRect();
    const thumbElement = element.querySelector('span[aria-hidden="true"]');
    if (thumbElement === null) {
      throw new Error('the switch thumb is missing');
    }
    const thumb = thumbElement.getBoundingClientRect();
    return {
      left: thumb.left - track.left,
      right: track.right - thumb.right,
      top: thumb.top - track.top,
      bottom: track.bottom - thumb.bottom,
    };
  });

  for (let state = 0; state < 2; state += 1) {
    const settled = await measure();
    expect(settled.left).toBeGreaterThanOrEqual(3.5);
    expect(settled.right).toBeGreaterThanOrEqual(3.5);
    expect(settled.top).toBeGreaterThanOrEqual(3.5);
    expect(settled.bottom).toBeGreaterThanOrEqual(3.5);

    await toggle.click();
    await page.waitForTimeout(60);
    const mid = await measure();
    expect(mid.left).toBeGreaterThanOrEqual(0);
    expect(mid.right).toBeGreaterThanOrEqual(0);
    expect(mid.top).toBeGreaterThanOrEqual(0);
    expect(mid.bottom).toBeGreaterThanOrEqual(0);

    await page.waitForTimeout(160);
  }
});
