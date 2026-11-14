import { expect, test, type Page } from '@playwright/test';

async function nativeFixture(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((theme) => {
    localStorage.setItem('tunefree_theme_mode', theme);
    const accounts: Record<string, unknown> = {};
    let connected = false;
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      transformCallback: () => 1,
      unregisterCallback: () => {},
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      invoke: async (command: string, args: Record<string, string>) => {
        const profile = { platform: 'netease', userId: '123', nickname: '账号回归测试', avatarUrl: null, state: 'connected', connectedAt: 1 };
        if (command === 'get_local_server_info') return { port: 43210, token: 'test-fixture' };
        if (command === 'list_platform_accounts') return Object.values(accounts);
        if (command === 'start_platform_login') return { platform: args.platform, attemptId: 'fixture', startedAt: Date.now() };
        if (command === 'finish_platform_login') { accounts.netease = profile; connected = true; return { state: 'connected', account: profile }; }
        if (command === 'cancel_platform_login') return;
        if (command === 'refresh_platform_account') return profile;
        if (command === 'logout_platform_account') { delete accounts[args.platform]; connected = false; return; }
        if (command === 'list_platform_playlists') return connected ? [{ id: 'playlist-42', name: '我的平台歌单', coverUrl: null, trackCount: 120, kind: 'created' }] : [];
        if (command === 'import_platform_playlist') return { name: '我的平台歌单', songs: Array.from({ length: 120 }, (_, i) => ({ id: String(i), source: 'netease', name: `平台歌曲 ${i + 1}`, artist: '测试歌手', album: '测试专辑', pic: null, lyricId: null, strMediaMid: null })) };
        if (command === 'get_latest_recommendation_job') return null;
        if (command.startsWith('plugin:event|')) return 1;
        return null;
      },
    } });
  }, theme);
  await page.route('http://127.0.0.1:43210/**', (route) => route.fulfill({ json: { hosts: [] } }));
}

for (const theme of ['light', 'dark'] as const) {
  test(`desktop accounts connect, import and logout at minimum window size (${theme})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 900, height: 640 });
    await nativeFixture(page, theme);
    await page.goto('/');
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '账号', exact: true }).click();
    await expect(page.getByRole('heading', { name: '平台账号', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '账号', exact: true })).toBeVisible();
    await page.getByRole('article', { name: '网易云音乐账号' }).getByRole('button', { name: '连接账号' }).click();
    await page.getByRole('button', { name: '我已完成登录' }).click();
    await expect(page.getByText('账号回归测试')).toBeVisible();
    await expect(page.getByRole('article', { name: 'QQ 音乐账号' }).getByRole('button', { name: '连接账号' })).toBeEnabled();
    const importControl = page.getByRole('button', { name: '导入到本地' });
    await importControl.scrollIntoViewIfNeeded();
    const box = await importControl.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 900).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`accounts-${theme}.png`), animations: 'disabled' });
    await importControl.click();
    await expect(page.getByText(/已导入「我的平台歌单」共 120 首/)).toBeVisible();
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '歌单', exact: true }).click();
    await expect(page.getByRole('button', { name: /我的平台歌单.*打开/ })).toBeVisible();
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '账号', exact: true }).click();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page.getByText('账号回归测试')).toHaveCount(0);
    const storage = await page.evaluate(() => JSON.stringify(localStorage));
    expect(storage).not.toContain('test-fixture'); expect(storage).not.toContain('cookie');
    expect(await page.pageErrors()).toEqual([]);
  });
}

test('browser preview explains native login requirement', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '账号', exact: true }).click();
  await expect(page.getByText(/账号登录需要运行 TuneFree 桌面应用/)).toBeVisible();
  for (const button of await page.getByRole('button', { name: '连接账号', exact: true }).all()) await expect(button).toBeDisabled();
});
