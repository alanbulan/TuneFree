import { expect, test, type Page } from '@playwright/test';

async function nativeFixture(page: Page, theme: 'light' | 'dark', seeded = false) {
  await page.addInitScript(({ theme, seeded }) => {
    localStorage.setItem('tunefree_theme_mode', theme);
    const accounts: Record<string, unknown> = {};
    const commands: { command: string; platform?: string; playlistId?: string }[] = [];
    Object.defineProperty(window, '__accountFixtureCommands', { value: commands });
    Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', { value: { unregisterListener: () => {} } });
    const profile = (platform: string) => ({ platform, userId: '123', nickname: platform === 'netease' ? '账号回归测试' : `${platform} 测试账号`,
      avatarUrl: platform === 'netease' ? null : `https://account-avatars.test/${platform}.svg`, state: 'connected', connectedAt: 1 });
    if (seeded) for (const platform of ['netease', 'qq', 'kuwo']) accounts[platform] = profile(platform);
    const songs = (platform: string, count: number, offset = 0) => Array.from({ length: count }, (_, index) => ({ id: String(offset + index + 1), source: platform,
      name: `平台歌曲 ${offset + index + 1}`, artist: '测试歌手', album: '测试专辑', pic: null, lyricId: null, strMediaMid: platform === 'qq' ? 'MEDIA' : null }));
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      transformCallback: () => 1,
      unregisterCallback: () => {},
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      invoke: async (command: string, args: Record<string, string>) => {
        commands.push({ command, platform: args?.platform, playlistId: args?.playlistId });
        if (command === 'get_local_server_info') return { port: 43210, token: 'test-fixture' };
        if (command === 'list_platform_accounts') return Object.values(accounts);
        if (command === 'start_platform_login') return { platform: args.platform, attemptId: 'fixture', startedAt: Date.now() };
        if (command === 'finish_platform_login') { const account = profile(args.platform); accounts[args.platform] = account; return { state: 'connected', account }; }
        if (command === 'cancel_platform_login') return;
        if (command === 'refresh_platform_account') return profile(args.platform);
        if (command === 'logout_platform_account') { delete accounts[args.platform]; return; }
        if (command === 'list_platform_playlists') return accounts[args.platform] ? Array.from({ length: seeded ? 23 : 1 }, (_, index) => ({ id: `playlist-${index}`,
          name: seeded ? `我的平台歌单 ${index + 1}` : '我的平台歌单', coverUrl: null, trackCount: 120, kind: index % 2 ? 'collected' : 'created' })) : [];
        if (command === 'import_platform_playlist') return { name: seeded ? `我的平台歌单 ${Number(args.playlistId.split('-')[1]) + 1}` : '我的平台歌单', songs: songs(args.platform, 120) };
        if (command === 'preview_platform_playlist') return { name: '预览歌单', total: 120, page: Number(args.page), pageSize: 20,
          songs: songs(args.platform, 20, (Number(args.page) - 1) * 20) };
        if (command === 'resolve_platform_account_url') return { url: 'https://account-audio.test/sample.wav', quality: '128k', state: 'connected', message: null };
        if (command === 'get_latest_recommendation_job') return null;
        if (command.startsWith('plugin:event|')) return 1;
        return null;
      },
    } });
  }, { theme, seeded });
  await page.route('https://account-avatars.test/**', (route) => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#ff3151"/><circle cx="32" cy="25" r="12" fill="white"/><path d="M12 57a20 20 0 0 1 40 0" fill="white"/></svg>',
  }));
  await page.route('http://127.0.0.1:43210/**', (route) => route.fulfill({ json: { hosts: [] } }));
  // A deterministic playable WAV proves preview → resolver → media → origin UI.
  const wav = Buffer.alloc(44 + 960000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(960000, 40);
  await page.route('https://account-audio.test/**', (route) => route.fulfill({ body: wav, contentType: 'audio/wav', headers: { 'access-control-allow-origin': '*' } }));
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

for (const theme of ['light', 'dark'] as const) {
  test(`three accounts share controls, playlist selection and preview playback (${theme})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await nativeFixture(page, theme, true); await page.goto('/');
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '账号', exact: true }).click();
    await expect(page.getByRole('article', { name: '酷我音乐账号' })).toBeVisible();
    for (const name of ['QQ 音乐账号', '酷我音乐账号']) {
      const avatar = page.getByRole('article', { name }).locator('.account-avatar img');
      await expect(avatar).toHaveCount(1);
      await expect.poll(() => avatar.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    }
    const picker = page.getByRole('button', { name: '查看哪个平台的歌单' });
    const refresh = page.getByRole('button', { name: '刷新歌单' });
    const [pickerBox, refreshBox] = await Promise.all([picker.boundingBox(), refresh.boundingBox()]);
    expect(pickerBox?.height).toBe(32); expect(refreshBox?.height).toBe(32);
    expect(pickerBox?.width).toBe(128); expect(refreshBox?.width).toBe(128);
    expect(Math.abs(pickerBox!.y - refreshBox!.y)).toBeLessThan(1);
    await page.mouse.move(750, 130);
    await page.screenshot({ path: testInfo.outputPath(`accounts-overview-${theme}.png`), animations: 'disabled' });
    await expect(page.getByRole('button', { name: /^预览 我的平台歌单 / })).toHaveCount(10);
    await page.getByRole('checkbox', { name: '选择本页歌单' }).check();
    await page.getByRole('button', { name: '歌单下一页' }).click();
    await page.getByRole('checkbox', { name: '选择 我的平台歌单 11', exact: true }).check();
    await expect(page.getByText('已选 11 个', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '批量导入（11）' }).click();
    await expect(page.getByText('批量导入完成：成功 11 个，失败 0 个')).toBeVisible();
    await page.getByRole('button', { name: '歌单上一页' }).click();
    const preview = page.getByRole('button', { name: '预览 我的平台歌单 1', exact: true });
    const border = await preview.evaluate((element) => getComputedStyle(element).borderWidth);
    expect(border).toBe('0px');
    await picker.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`accounts-three-${theme}.png`), animations: 'disabled' });
    await preview.click(); const dialog = page.getByRole('dialog', { name: '我的平台歌单 1' });
    await expect(dialog.locator('.song-table .table-head')).toBeVisible();
    await dialog.getByLabel('平台歌曲 1 - 测试歌手', { exact: true }).click();
    await expect(page.getByLabel('播放来源：网易云音乐账号 · 128K')).toHaveCount(1);
    await dialog.getByRole('button', { name: '暂停播放' }).click();
    await expect(dialog.getByRole('button', { name: '继续播放' })).toBeVisible();
    await dialog.getByRole('button', { name: '继续播放' }).click();
    await dialog.getByRole('button', { name: '收藏歌曲 平台歌曲 1', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '取消收藏 平台歌曲 1', exact: true })).toBeVisible();
    await page.mouse.move(170, 200);
    await page.screenshot({ path: testInfo.outputPath(`accounts-preview-${theme}.png`), animations: 'disabled' });
    await dialog.getByRole('button', { name: '歌曲下一页' }).click();
    await expect(dialog.getByLabel('平台歌曲 21 - 测试歌手', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`accounts-preview-page-two-${theme}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(preview).toBeFocused();
    await picker.click(); await page.getByRole('option', { name: 'QQ 音乐' }).click();
    await expect(page.getByRole('heading', { name: 'QQ 音乐的歌单' })).toBeVisible();
    await page.getByRole('button', { name: '预览 我的平台歌单 1', exact: true }).click();
    await page.getByRole('dialog').getByLabel('平台歌曲 1 - 测试歌手', { exact: true }).click();
    await expect(page.getByLabel('播放来源：QQ 音乐账号 · 128K')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await picker.click(); await page.getByRole('option', { name: '酷我音乐' }).click();
    await expect(page.getByRole('heading', { name: '酷我音乐的歌单' })).toBeVisible();
    await page.getByRole('button', { name: '预览 我的平台歌单 1', exact: true }).click();
    await page.getByRole('dialog').getByLabel('平台歌曲 1 - 测试歌手', { exact: true }).click();
    await expect(page.getByLabel('播放来源：酷我音乐账号 · 128K')).toHaveCount(1);
    const called = await page.evaluate(() => (window as unknown as { __accountFixtureCommands: { command: string; platform?: string }[] }).__accountFixtureCommands);
    expect(called.filter((call) => call.command === 'resolve_platform_account_url').map((call) => call.platform))
      .toEqual(expect.arrayContaining(['netease', 'qq', 'kuwo']));
    expect(called.filter((call) => call.command === 'import_platform_playlist')).toHaveLength(14);
    expect(await page.pageErrors()).toEqual([]);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`preview selects songs across pages, imports only the selection and plays a complete queue (${theme})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 900, height: 640 });
    await nativeFixture(page, theme, true); await page.goto('/');
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '账号', exact: true }).click();
    const preview = page.getByRole('button', { name: '预览 我的平台歌单 1', exact: true });
    await preview.click(); const dialog = page.getByRole('dialog', { name: '我的平台歌单 1' });
    await dialog.getByRole('button', { name: '歌曲下一页' }).click();
    await dialog.getByRole('checkbox', { name: '选择歌曲 平台歌曲 21', exact: true }).check();
    await dialog.getByRole('button', { name: '歌曲上一页' }).click();
    await dialog.getByRole('checkbox', { name: '选择歌曲 平台歌曲 2', exact: true }).check();
    await expect(dialog.getByText('已选 2 首', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '播放所选（2）' }).click();
    const queue = () => page.evaluate(() => JSON.parse(localStorage.getItem('tunefree_queue') || '[]').map((song: { id: string }) => song.id));
    await expect.poll(queue).toEqual(['2', '21']);
    await expect(page.getByLabel('播放来源：网易云音乐账号 · 128K')).toHaveCount(1);
    const importBounds = await dialog.getByRole('button', { name: '导入所选（2）' }).boundingBox();
    const fullImportBounds = await dialog.getByRole('button', { name: '导入这个歌单', exact: true }).boundingBox();
    for (const bounds of [importBounds, fullImportBounds]) {
      expect(bounds).not.toBeNull();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(618);
      expect(bounds!.height).toBeGreaterThanOrEqual(32);
    }
    await page.mouse.move(150, 150);
    await page.screenshot({ path: testInfo.outputPath(`accounts-song-selection-${theme}.png`), animations: 'disabled' });
    await dialog.getByRole('button', { name: '导入所选（2）' }).click();
    await expect(dialog).toHaveCount(0);
    const savedSongs = () => page.evaluate(() => JSON.parse(localStorage.getItem('tunefree_library') || '{}').playlists?.[0]?.songs.map((song: { id: string }) => song.id));
    await expect.poll(savedSongs).toEqual(['2', '21']);
    await preview.click();
    await dialog.getByRole('button', { name: '歌曲下一页' }).click();
    await dialog.getByLabel('平台歌曲 21 - 测试歌手', { exact: true }).click();
    await expect.poll(async () => (await queue()).length).toBe(120);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('tunefree_current_song') || '{}').id)).toBe('21');
    await dialog.getByRole('button', { name: '播放全部' }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('tunefree_current_song') || '{}').id)).toBe('1');
    await dialog.getByRole('button', { name: '选择全部 120 首' }).click();
    await expect(dialog.getByText('已选 120 首', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '导入所选（120）' }).click();
    const confirm = page.getByRole('dialog', { name: '已有同名歌单' });
    await expect(confirm).toBeVisible(); await confirm.getByRole('button', { name: '再导入一份' }).click();
    await expect.poll(async () => (await savedSongs())?.length).toBe(120);
    const reads = await page.evaluate(() => (window as unknown as { __accountFixtureCommands: { command: string }[] }).__accountFixtureCommands.filter((call) => call.command === 'import_platform_playlist').length);
    expect(reads).toBe(1);
    const storage = await page.evaluate(() => JSON.stringify(localStorage));
    expect(storage).not.toContain('account-audio.test'); expect(storage).not.toContain('cookie');
    expect(await page.pageErrors()).toEqual([]);
  });
}

test('browser preview explains native login requirement', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '账号', exact: true }).click();
  await expect(page.getByText(/账号登录需要运行 TuneFree 桌面应用/)).toBeVisible();
  for (const button of await page.getByRole('button', { name: '连接账号', exact: true }).all()) await expect(button).toBeDisabled();
});
