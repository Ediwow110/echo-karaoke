import { expect, test, type Locator } from '@playwright/test';

type Measurement = {
  target: { width: number; height: number };
  insets: { left: number; right: number; top: number; bottom: number };
  contrast: number;
};

function measureSwitch(toggle: Locator): Promise<Measurement> {
  return toggle.evaluate((element) => {
    const trackElement = element.querySelector('[data-switch-track]');
    const thumbElement = element.querySelector('span[aria-hidden="true"]');
    if (trackElement === null || thumbElement === null) {
      throw new Error('the switch track or thumb is missing');
    }

    const target = element.getBoundingClientRect();
    const track = trackElement.getBoundingClientRect();
    const thumb = thumbElement.getBoundingClientRect();

    const rgb = (value: string): [number, number, number] => {
      const parts = value.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    };
    const luminance = ([r, g, b]: [number, number, number]): number => {
      const channel = (value: number): number => {
        const scaled = value / 255;
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ratio = (first: string, second: string): number => {
      const a = luminance(rgb(first));
      const b = luminance(rgb(second));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };

    return {
      target: { width: target.width, height: target.height },
      insets: {
        left: thumb.left - track.left,
        right: track.right - thumb.right,
        top: thumb.top - track.top,
        bottom: track.bottom - thumb.bottom,
      },
      contrast: ratio(getComputedStyle(trackElement).backgroundColor, getComputedStyle(thumbElement).backgroundColor),
    };
  });
}

test('the switch thumb stays inside its track with a clear contrast and hit area', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('switch').first();
  await expect(toggle).toBeVisible();

  for (let state = 0; state < 2; state += 1) {
    const settled = await measureSwitch(toggle);
    expect(settled.target.width).toBeGreaterThanOrEqual(44);
    expect(settled.target.height).toBeGreaterThanOrEqual(44);
    expect(settled.insets.left).toBeGreaterThanOrEqual(3.5);
    expect(settled.insets.right).toBeGreaterThanOrEqual(3.5);
    expect(settled.insets.top).toBeGreaterThanOrEqual(3.5);
    expect(settled.insets.bottom).toBeGreaterThanOrEqual(3.5);
    expect(settled.contrast).toBeGreaterThanOrEqual(3);

    await toggle.click();
    await page.waitForTimeout(60);
    const mid = await measureSwitch(toggle);
    expect(mid.insets.left).toBeGreaterThanOrEqual(0);
    expect(mid.insets.right).toBeGreaterThanOrEqual(0);
    expect(mid.insets.top).toBeGreaterThanOrEqual(0);
    expect(mid.insets.bottom).toBeGreaterThanOrEqual(0);

    await page.waitForTimeout(160);
  }
});
