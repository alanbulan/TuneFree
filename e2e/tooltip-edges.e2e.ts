import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 900, height: 640 }, { width: 1200, height: 800 }]) {
  test(`tooltips retain natural width at all four corners at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem('tunefree_desktop_show_pet', 'false'));
    await page.goto('/');
    const button = page.locator('.lyric-toggle-btn');
    await button.evaluate((element) => { element.style.position = 'fixed'; element.style.zIndex = '2100'; });
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await button.evaluate((element, position) => {
        element.style.top = position.startsWith('top') ? '2px' : 'auto';
        element.style.bottom = position.startsWith('bottom') ? '2px' : 'auto';
        element.style.left = position.endsWith('left') ? '2px' : 'auto';
        element.style.right = position.endsWith('right') ? '2px' : 'auto';
      }, corner);
      await button.hover();
      const tooltip = page.getByRole('tooltip');
      await expect(tooltip).toBeVisible();
      const rect = await tooltip.boundingBox();
      expect(rect).not.toBeNull();
      expect(rect!.width).toBeGreaterThan(160);
      expect(rect!.height).toBeLessThan(55);
      expect(rect!.x).toBeGreaterThanOrEqual(7);
      expect(rect!.y).toBeGreaterThanOrEqual(7);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width - 7);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height - 7);
    }
    expect(await page.pageErrors()).toEqual([]);
  });
}
