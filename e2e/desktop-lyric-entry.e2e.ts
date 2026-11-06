import { expect, test } from '@playwright/test';

test('desktop lyric production entry loads its shared chunks and controls', async ({ page }) => {
  await page.goto('/desktop-lyric/index.html');
  const lyrics = page.getByRole('region', { name: '桌面歌词控制区域', exact: true });
  await expect(lyrics).toBeVisible();
  await lyrics.focus();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await expect(lyrics).toHaveCSS('box-shadow', 'none');
  await expect(lyrics).toHaveCSS('outline-style', 'none');
  expect(await page.pageErrors(), 'Desktop lyric entry must not throw uncaught errors').toEqual([]);
});

test('lyric resize frame appears during interaction and disappears after leaving or locking', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/desktop-lyric/index.html');
  const lyrics = page.getByRole('region', { name: '桌面歌词控制区域', exact: true });
  const frameOpacity = () => lyrics.evaluate(element => getComputedStyle(element, '::before').opacity);
  await page.mouse.move(-20, -20);
  await expect.poll(frameOpacity).toBe('0');
  await expect(page.getByText('TuneFree Desktop', { exact: true })).toHaveCSS('font-size', '32px');
  await lyrics.hover();
  await expect.poll(frameOpacity).toBe('1');
  expect(await lyrics.evaluate(element => getComputedStyle(element, '::before').borderColor)).toBe('rgba(248, 250, 252, 0.65)');
  await expect(page.locator('.desktop-lyric-resize-s')).toHaveCSS('height', '16px');
  await page.getByRole('button', { name: '字号放大', exact: true }).click();
  await expect(page.getByText('TuneFree Desktop', { exact: true })).toHaveCSS('font-size', '34px');
  // A focused toolbar button must not pin the frame after the pointer exits the window.
  await page.mouse.move(-20, -20);
  await expect.poll(frameOpacity).toBe('0');
  await expect(page.getByRole('button', { name: '字号放大', exact: true })).toBeHidden();
  await lyrics.hover();
  await page.getByRole('button', { name: '锁定歌词（锁定后鼠标可直接穿透）', exact: true }).click();
  await expect.poll(frameOpacity).toBe('0');
  await expect(page.locator('.desktop-lyric-resize-handle')).toHaveCount(0);
  expect(await page.pageErrors()).toEqual([]);
});
