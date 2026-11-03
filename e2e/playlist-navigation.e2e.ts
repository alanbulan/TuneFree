import { expect, test, type Locator, type Page } from '@playwright/test';

const playlistName = '返回导航回归歌单';
const backName = '← 返回歌单列表';

async function openPlaylist(page: Page, count: number, theme: 'light' | 'dark' = 'light') {
  await page.addInitScript(({ count, theme, name }) => {
    const songs = Array.from({ length: count }, (_, index) => ({
      id: String(index + 1), name: `回归歌曲 ${index + 1}`,
      artist: '回归测试', album: '本地测试数据', source: 'qq', pic: '',
    }));
    localStorage.setItem('tunefree_library', JSON.stringify({
      favorites: [], playlists: [{ id: 'navigation-test', name, createTime: 1, songs }],
    }));
    localStorage.setItem('tunefree_theme_mode', theme);
    localStorage.setItem('tunefree_play_mode', JSON.stringify('sequence'));
  }, { count, theme, name: playlistName });

  await page.goto('/library/playlists');
  await page.getByRole('button', { name: new RegExp(`${playlistName}.*打开`) }).click();
  await expect(page.getByRole('heading', { name: playlistName, exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(new RegExp(`${theme}-theme`));
  // Let the real MotionPanel enter animation finish before measuring geometry.
  await page.locator('.view-transition-panel').evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true })
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => {})));
  });
}

/** No locator.click(): its automatic scrolling would hide the original bug. */
async function expectReachable(control: Locator, regionSelector: string) {
  await expect.poll(() => control.evaluate((element, selector) => {
    const region = document.querySelector(selector)!.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      withinRegion: rect.width > 0 && rect.height > 0
        && rect.left >= region.left && rect.right <= region.right
        && rect.top >= region.top && rect.bottom <= region.bottom,
      receivesPointer: hit !== null && element.contains(hit),
    };
  }, regionSelector)).toEqual({ withinRegion: true, receivesPointer: true });
}

async function clickAtCurrentPosition(page: Page, control: Locator, regionSelector: string) {
  await expectReachable(control, regionSelector);
  const box = await control.boundingBox();
  if (!box) throw new Error('Expected an onscreen control');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const longPlaylistCases = [
  { width: 900, height: 640, theme: 'light', collapsed: false },
  { width: 1200, height: 800, theme: 'light', collapsed: false },
  { width: 1440, height: 900, theme: 'light', collapsed: false },
  { width: 900, height: 640, theme: 'dark', collapsed: true },
] as const;

for (const scenario of longPlaylistCases) {
  test(`long playlist remains reachable at ${scenario.width}x${scenario.height}, ${scenario.theme}, sidebar ${scenario.collapsed ? 'collapsed' : 'expanded'}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await openPlaylist(page, 250, scenario.theme);
    if (scenario.collapsed) await page.getByRole('button', { name: '收起侧边菜单' }).click();

    const outer = page.locator('.view-scroll');
    const songs = page.locator('.song-virtual-list');
    const back = page.getByRole('button', { name: backName, exact: true });
    const navigation = page.getByRole('navigation', { name: '歌单导航', exact: true });

    await outer.evaluate((element) => { element.scrollTop = 0; });
    await expectReachable(back, '.workspace');
    expect(await navigation.evaluate((element) => element.getBoundingClientRect().top
      - document.querySelector('.library-page-header')!.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(0);

    for (const fraction of [0.5, 1]) {
      // Exercise both scrolling layers: the virtual list and the workspace.
      await songs.evaluate((element, amount) => {
        element.scrollTop = (element.scrollHeight - element.clientHeight) * amount;
      }, fraction);
      await outer.evaluate((element, amount) => {
        element.scrollTop = (element.scrollHeight - element.clientHeight) * amount;
      }, fraction);
      await expect.poll(() => songs.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await expect.poll(() => outer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await expectReachable(back, '.workspace');
    }

    // No strip of scrolled song rows should remain above the pinned navigation.
    await expect.poll(() => navigation.evaluate((element) => Math.abs(
      element.getBoundingClientRect().top - document.querySelector('.workspace')!.getBoundingClientRect().top,
    ))).toBeLessThanOrEqual(1);

    if (scenario.width === 900 && !scenario.collapsed) {
      const screenshot = testInfo.outputPath('long-playlist-scrolled.png');
      await page.screenshot({ path: screenshot });
      await testInfo.attach('long-playlist-scrolled', { path: screenshot, contentType: 'image/png' });
    }

    // Song actions remain usable at the bottom without scrolling back up.
    const favorite = page.getByRole('button', { name: '收藏歌曲 回归歌曲 250', exact: true });
    await clickAtCurrentPosition(page, favorite, '.workspace');
    await expect(page.getByRole('button', { name: '取消收藏 回归歌曲 250', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '关闭提示' }).click();
    await clickAtCurrentPosition(page,
      page.getByRole('button', { name: '从歌单移除 回归歌曲 250', exact: true }), '.workspace');
    await expect(page.getByRole('button', { name: '从歌单移除 回归歌曲 250', exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() =>
      JSON.parse(localStorage.getItem('tunefree_library')!).playlists[0].songs.length)).toBe(249);

    // The independent bottom transport is not covered by the navigation.
    const mode = page.locator('.transport').getByRole('button', { name: '切换播放模式' });
    await clickAtCurrentPosition(page, mode, '.transport');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('tunefree_play_mode'))).toBe('"loop"');
    await expectReachable(page.locator('.transport').getByRole('button', { name: '打开全屏播放器' }), '.transport');

    await expect.poll(() => outer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await clickAtCurrentPosition(page, back, '.workspace');
    await expect(page.getByRole('button', { name: new RegExp(`${playlistName}.*249 首.*打开`) })).toBeVisible();
    await expect(back).toHaveCount(0);
  });
}

for (const count of [0, 2]) {
  test(`${count === 0 ? 'empty' : 'short'} playlist retains its controls and return navigation`, async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 640 });
    await openPlaylist(page, count);
    const back = page.getByRole('button', { name: backName, exact: true });
    await expectReachable(back, '.workspace');
    if (count === 0) {
      await expect(page.getByText('这个歌单还没有歌曲')).toBeVisible();
      await expect(page.getByRole('button', { name: '播放全部', exact: true })).toBeDisabled();
    } else {
      await expect(page.getByRole('button', { name: '播放全部', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: '立即播放 回归歌曲 1', exact: true })).toBeVisible();
    }
    await page.locator('.view-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await clickAtCurrentPosition(page, back, '.workspace');
    await expect(page.getByRole('button', { name: new RegExp(`${playlistName}.*${count} 首.*打开`) })).toBeVisible();
  });
}
