import { expect, test } from '@playwright/test';

test('desktop lyric production entry loads its shared chunks and controls', async ({ page }) => {
  await page.goto('/desktop-lyric/index.html');
  const lyrics = page.getByRole('region', { name: '桌面歌词控制区域', exact: true });
  await expect(lyrics).toBeVisible();
  await lyrics.focus();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  expect(await page.pageErrors(), 'Desktop lyric entry must not throw uncaught errors').toEqual([]);
});
