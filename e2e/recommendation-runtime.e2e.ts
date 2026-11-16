import { expect, test, type Page } from '@playwright/test';

async function recommendationFixture(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript(({ theme }) => {
    localStorage.setItem('tunefree_theme_mode', theme);
    localStorage.setItem('tunefree_desktop_mira_position_v3', JSON.stringify({ x: 1080, y: 90 }));
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { name: string; callback: number }>();
    const commands: Array<{ command: string; args?: Record<string, unknown> }> = [];
    let sequence = 0;
    const timestamp = new Date(2030, 0, 1, 12, 34, 56).getTime();
    const item = (id: string, name: string) => ({ song: { id, source: 'qq', name, artist: '歌手', album: '' },
      score: 1, reasons: [], recommendationSource: 'hybrid', requestId: 'request' });
    let job: Record<string, unknown> = { jobId: 'initial', status: 'running', stage: 'cloud_rerank', detail: '正在精选',
      items: [item('old', '原推荐歌曲')], error: null, updatedAt: timestamp, deadlineAt: timestamp + 265000,
      localCount: 2, localUpdatedAt: timestamp - 1000, cloudEnabled: true, resultUpdatedAt: timestamp - 2000, nextRefreshAt: null };
    let config = { localRecommendationEnabled: true, enabled: true, baseUrl: '', model: '', timeoutMs: 60000,
      maxCandidates: 80, maxResults: 30, cacheTtlSeconds: 86400, uploadRecentEvents: false, hasApiKey: false,
      databaseSizeBytes: 0, llmCacheEntries: 0, lastError: null };
    const emit = (patch: Record<string, unknown>) => {
      job = { ...job, ...patch };
      for (const [id, listener] of listeners) {
        if (listener.name === 'recommendation-job-update') callbacks.get(listener.callback)?.({ event: listener.name, id, payload: job });
      }
    };
    Object.defineProperty(window, '__recommendationFixture', { value: { emit, item, commands, timestamp,
      listenerCount: () => [...listeners.values()].filter((value) => value.name === 'recommendation-job-update').length } });
    Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', { value: {
      unregisterListener: (_name: string, id: number) => listeners.delete(id),
    } });
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (callback: (event: unknown) => void) => { const id = ++sequence; callbacks.set(id, callback); return id; },
      unregisterCallback: (id: number) => callbacks.delete(id),
      invoke: async (command: string, args?: Record<string, unknown>) => {
        commands.push({ command, args });
        if (command === 'plugin:event|listen') { const id = ++sequence; listeners.set(id, { name: String(args?.event), callback: Number(args?.handler) }); return id; }
        if (command === 'plugin:event|unlisten') { listeners.delete(Number(args?.eventId)); return; }
        if (command === 'get_local_server_info') return { port: 43210, token: 'fixture-only' };
        if (command === 'get_llm_config') return config;
        if (command === 'get_latest_recommendation_job') return job;
        if (command === 'sync_recommendation_library') return config.localRecommendationEnabled;
        if (command === 'scan_download_dir' || command === 'list_platform_accounts' || command === 'list_llm_models') return [];
        if (command === 'get_download_dir') return '';
        if (command === 'save_llm_config') {
          config = { ...config, ...args?.config as object };
          if (!config.localRecommendationEnabled) emit({ jobId: 'disabled', status: 'disabled', stage: 'disabled', detail: '推荐已关闭',
            items: [], cloudEnabled: false, localUpdatedAt: 0, resultUpdatedAt: 0 });
          return;
        }
        if (command === 'refresh_recommendations') { emit({ status: 'waiting', stage: 'waiting', detail: '等待刷新', nextRefreshAt: timestamp + 180000 }); return job; }
        if (command === 'save_recommendation_feedback') {
          const feedback = args?.feedback as { action: string; song: { id: string } };
          if (feedback.action === 'dismiss') emit({ items: (job.items as ReturnType<typeof item>[]).filter((value) => value.song.id !== feedback.song.id),
            status: 'waiting', stage: 'waiting', detail: '等待刷新' });
          return;
        }
        if (command === 'clear_recommendation_data') {
          emit({ jobId: 'cleared', status: 'idle', stage: 'cleared', detail: '暂无推荐', items: [], error: null,
            cloudEnabled: false, localCount: 0, localUpdatedAt: 0, resultUpdatedAt: 0, nextRefreshAt: null });
          return { databaseSizeBytes: 0, llmCacheEntries: 0 };
        }
        return null;
      },
    } });
  }, { theme });
  await page.route('http://127.0.0.1:43210/**', (route) => route.fulfill({ json: { hosts: [], playlists: [], songs: [] } }));
}

for (const theme of ['light', 'dark'] as const) {
  test(`recommendation keeps live status across views and distinguishes terminal states (${theme})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await recommendationFixture(page, theme); await page.goto('/');
    await expect(page.getByRole('button', { name: /^Bloub 音乐伙伴，正在为你挑选音乐/ })).toBeVisible();
    const navigate = (name: string) => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
    await navigate('设置');
    const card = page.locator('.task-progress-card');
    await expect(card.locator('.task-progress-row').nth(0).getByText('已完成', { exact: true })).toBeVisible();
    await expect(card.getByText('运行中', { exact: true })).toBeVisible();
    await page.evaluate(() => {
      const fixture = (window as unknown as { __recommendationFixture: { emit: (job: object) => void; item: (id: string, name: string) => object; timestamp: number } }).__recommendationFixture;
      fixture.emit({ jobId: 'completed', status: 'done', stage: 'done', detail: '精选完成', error: null,
        items: [fixture.item('new', '新推荐歌曲')], resultUpdatedAt: fixture.timestamp, updatedAt: fixture.timestamp + 30000 });
    });
    await expect(card.locator('.task-progress-row').nth(1).getByText('已完成', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Bloub 音乐伙伴，音乐还没开始/ })).toBeVisible();
    await expect(card.locator('.task-progress-row').nth(1).locator('small')).toHaveText('12:34:56');
    await navigate('首页'); await page.getByRole('button', { name: '为你推荐', exact: true }).click();
    await expect(page.getByRole('button', { name: '立即播放 新推荐歌曲' })).toBeVisible();
    await expect(page.getByRole('button', { name: '立即播放 原推荐歌曲' })).toHaveCount(0);
    await page.getByRole('button', { name: '不感兴趣 新推荐歌曲' }).click();
    await expect(page.getByRole('button', { name: '立即播放 新推荐歌曲' })).toHaveCount(0);
    const counts = await page.evaluate(() => {
      const fixture = (window as unknown as { __recommendationFixture: { commands: { command: string }[]; listenerCount: () => number } }).__recommendationFixture;
      return { feedback: fixture.commands.filter((value) => value.command === 'save_recommendation_feedback').length,
        dismiss: fixture.commands.filter((value) => value.command === 'dismiss_recommendation').length, listeners: fixture.listenerCount() };
    });
    expect(counts).toEqual({ feedback: 1, dismiss: 0, listeners: 1 });
    await page.evaluate(() => {
      const fixture = (window as unknown as { __recommendationFixture: { emit: (job: object) => void; item: (id: string, name: string) => object } }).__recommendationFixture;
      fixture.emit({ jobId: 'local', status: 'done', stage: 'local_only', detail: '本地推荐已更新', cloudEnabled: false,
        items: [fixture.item('local', '本地推荐歌曲')] });
    });
    await expect(page.getByRole('button', { name: '立即播放 本地推荐歌曲' })).toBeVisible();
    await navigate('设置');
    await page.mouse.move(720, 110); await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`recommendation-status-${theme}.png`), animations: 'disabled' });
    await page.getByRole('button', { name: '推荐数据管理' }).click();
    await page.getByRole('button', { name: '清空推荐数据', exact: true }).click();
    await page.getByRole('dialog', { name: '清空推荐数据' }).getByRole('button', { name: '清空', exact: true }).click();
    await expect(card.getByText('暂无推荐', { exact: true })).toBeVisible();
    await navigate('首页'); await page.getByRole('button', { name: '为你推荐', exact: true }).click();
    await expect(page.getByRole('button', { name: '立即播放 本地推荐歌曲' })).toHaveCount(0);
    await navigate('设置');
    await page.getByRole('checkbox', { name: '根据播放与收藏发现好音乐' }).uncheck();
    await expect(page.getByRole('checkbox', { name: '使用已配置的模型发现和精选音乐' })).toBeDisabled();
    await page.locator('.settings-core-card').filter({ has: page.getByRole('heading', { name: '音乐推荐', exact: true }) })
      .getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(card.locator('.task-progress-row.disabled')).toHaveCount(2);
    expect(await page.pageErrors()).toEqual([]);
  });
}
