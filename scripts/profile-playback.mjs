/** Fixed playback scenarios against the existing production preview; no real account data. */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const baseURL = process.env.PROFILE_BASE_URL ?? 'http://127.0.0.1:3101';
const durationMs = Number(process.env.PROFILE_DURATION_MS ?? 5000);
const highRefreshSimulation = process.env.PROFILE_HIGH_REFRESH === '1';
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const errors = [];
const wav = Buffer.alloc(44 + 960000);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(960000, 40);
for (let i = 0; i < 480000; i += 1) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI / 20) * 1200), 44 + i * 2);
const measuredKeys = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'];
const results = [];

async function fixture(page, pet) {
  await page.addInitScript(({ pet }) => {
    localStorage.setItem('tunefree_theme_mode', 'light');
    localStorage.setItem('tunefree_desktop_show_pet', String(pet));
    localStorage.setItem('tunefree_desktop_mira_position_v3', JSON.stringify({ x: 1030, y: 90 }));
    const songs = Array.from({ length: 5000 }, (_, i) => ({ id: `profile-${i}`, name: `性能测试歌曲 ${i + 1}`,
      artist: '本地测试', album: '固定数据', source: 'qq', pic: 'https://performance-fixture.test/cover.svg' }));
    localStorage.setItem('tunefree_library', JSON.stringify({ favorites: [], playlists: [{ id: 'profile', name: '性能测试歌单', createTime: 1, songs }] }));
    localStorage.setItem('tunefree_current_song', JSON.stringify(songs[0]));
    localStorage.setItem('tunefree_queue', JSON.stringify(songs));
    const counters = { canvasFrames: 0, mediaHandlers: 0, mediaMetadata: 0, petAttributes: 0, commands: {}, longTasks: [] };
    Object.defineProperty(window, '__performanceFixture', { value: counters });
    const clearRect = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.classList.contains('audio-visualizer-canvas')) counters.canvasFrames += 1;
      return clearRect.apply(this, args);
    };
    const setActionHandler = navigator.mediaSession.setActionHandler;
    navigator.mediaSession.setActionHandler = function (...args) {
      counters.mediaHandlers += 1;
      return setActionHandler.apply(this, args);
    };
    const descriptor = Object.getOwnPropertyDescriptor(MediaSession.prototype, 'metadata');
    Object.defineProperty(MediaSession.prototype, 'metadata', { ...descriptor, set(value) {
      counters.mediaMetadata += 1; descriptor.set.call(this, value);
    } });
    const observer = new MutationObserver((changes) => {
      for (const change of changes) if (change.type === 'attributes' && change.target.closest?.('.bloub-avatar')) counters.petAttributes += 1;
    });
    observer.observe(document, { subtree: true, attributes: true });
    new PerformanceObserver((list) => counters.longTasks.push(...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration }))))
      .observe({ type: 'longtask', buffered: true });
    Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', { value: { unregisterListener: () => {} } });
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      transformCallback: () => 1, unregisterCallback: () => {},
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      invoke: async (command) => {
        counters.commands[command] = (counters.commands[command] ?? 0) + 1;
        if (command === 'get_local_server_info') return { port: 43210, token: 'performance-fixture' };
        if (command === 'resolve_platform_account_url') return { url: 'https://performance-fixture.test/audio.wav', quality: '128k', state: 'connected', message: null };
        if (command === 'get_latest_recommendation_job') return null;
        if (command === 'scan_download_dir' || command === 'list_platform_accounts') return [];
        if (command.startsWith('plugin:event|')) return 1;
        return null;
      },
    } });
  }, { pet });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === baseURL) return route.continue();
    if (url.pathname === '/audio.wav') return route.fulfill({ body: wav, contentType: 'audio/wav', headers: { 'access-control-allow-origin': '*' } });
    if (url.pathname === '/cover.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="40" fill="#ff3151"/><circle cx="128" cy="128" r="72" fill="white"/></svg>' });
    if (url.pathname === '/api/cors-proxy' || url.hostname === 'music-api.gdstudio.xyz') {
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({ json: { hosts: [], songs: [], lists: [] } });
  });
}

try {
  for (const pet of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
    page.on('pageerror', (error) => errors.push(error.message));
    await fixture(page, pet);
    const start = Date.now();
    await page.goto(`${baseURL}/`);
    const navigation = page.getByRole('navigation', { name: '主导航', exact: true });
    await navigation.getByRole('button', { name: '关于', exact: true }).click();
    await page.getByRole('heading', { name: '关于', exact: true }).waitFor();
    const readyMs = Date.now() - start;
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map((item) => [item.name, item.value]));
    const measure = async (name, sampleDuration = durationMs) => {
      await page.mouse.move(700, 100);
      await page.waitForTimeout(1000);
      await client.send('HeapProfiler.collectGarbage');
      const before = await metrics();
      const initial = await page.evaluate(() => ({ ...JSON.parse(JSON.stringify(window.__performanceFixture)), measuredAt: performance.now() }));
      await page.waitForTimeout(sampleDuration);
      const after = await metrics();
      const final = await page.evaluate(() => JSON.parse(JSON.stringify(window.__performanceFixture)));
      const heap = await client.send('Runtime.getHeapUsage');
      const sample = { name, pet, durationMs: sampleDuration, readyMs,
        work: Object.fromEntries(measuredKeys.map((key) => [key, after[key] - before[key]])),
        counters: Object.fromEntries(['canvasFrames', 'mediaHandlers', 'mediaMetadata', 'petAttributes'].map((key) => [key, final[key] - initial[key]])),
        commands: Object.fromEntries(Object.entries(final.commands).map(([key, value]) => [key, value - (initial.commands[key] ?? 0)]).filter(([, value]) => value)),
        longTasks: final.longTasks.filter((entry) => entry.startTime >= initial.measuredAt),
        dom: await client.send('Memory.getDOMCounters'), heapBytes: heap.usedSize };
      results.push(sample); console.log(JSON.stringify(sample));
    };
    await measure('paused');
    await page.getByRole('button', { name: '播放或暂停', exact: true }).click();
    await page.getByLabel('播放来源：QQ 音乐账号 · 128K').waitFor();
    await measure('playing');
    await page.getByRole('button', { name: '打开全屏播放器', exact: true }).click();
    await page.getByRole('dialog', { name: '全屏播放器', exact: true }).waitFor();
    await measure('full-player');
    await page.getByRole('button', { name: '收起播放器', exact: true }).click();
    await page.getByRole('dialog', { name: '全屏播放器', exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '播放或暂停', exact: true }).click();
    if (highRefreshSimulation) {
      await page.evaluate(() => {
        const frames = new Map(); let id = 0;
        window.requestAnimationFrame = (callback) => { frames.set(++id, callback); return id; };
        window.cancelAnimationFrame = (key) => frames.delete(key);
        setInterval(() => {
          const callbacks = [...frames.values()]; frames.clear();
          for (const callback of callbacks) callback(performance.now());
        }, 1000 / 120);
      });
      await page.getByRole('button', { name: '播放或暂停', exact: true }).click();
      await measure('simulated-120hz');
      await page.getByRole('button', { name: '播放或暂停', exact: true }).click();
    }
    await page.close();
  }
  const report = { date: new Date().toISOString(), baseURL, highRefreshSimulation, scenarios: results, errors,
    limitations: 'Production Chromium at 1200×800, DPR2, fixed 5000-song queue and local WAV; native IPC/network fixtures. Browser CPU work differs from installed WebKit. Canvas/pet observers add shared instrumentation overhead. The optional 120Hz clock uses timers; it is not a physical display measurement.' };
  const target = process.env.PROFILE_OUTPUT ?? '/tmp/tunefree-playback-profile.json';
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${target}; errors: ${errors.length}`);
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
