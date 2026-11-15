/** Isolated production lyric renderer profiling with deterministic event/clock fixtures. */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const results = [], errors = [];
const durationMs = Number(process.env.PROFILE_DURATION_MS ?? 5000);
const baseURL = process.env.PROFILE_BASE_URL ?? 'http://127.0.0.1:3101';

try {
  for (const mode of ['line', 'karaoke']) {
    const page = await browser.newPage({ viewport: { width: 650, height: 420 }, deviceScaleFactor: 2 });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(({ mode }) => {
      localStorage.setItem('tunefree_lyric_display_mode', mode);
      const callbacks = new Map(), handlers = new Map(); let id = 0;
      Object.defineProperty(window, '__sendLyricFixture', { value: (event, payload) => handlers.get(event)?.({ event, id: 1, payload }) });
      const counters = { activeMutations: 0, contextMutations: 0, wordMutations: 0, frames: 0 };
      Object.defineProperty(window, '__lyricPerformance', { value: counters });
      const nativeFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => nativeFrame((time) => { counters.frames += 1; callback(time); });
      new MutationObserver((entries) => {
        for (const entry of entries) {
          if (entry.target.closest?.('.desktop-lyric-context-line')) counters.contextMutations += 1;
          if (entry.target.closest?.('.desktop-lyric-current-line')) counters.activeMutations += 1;
          if (entry.target.matches?.('.karaoke-word')) counters.wordMutations += 1;
        }
      }).observe(document, { subtree: true, attributes: true, childList: true, characterData: true });
      Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', { value: { unregisterListener: (event) => handlers.delete(event) } });
      Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
        transformCallback: (callback) => { callbacks.set(++id, callback); return id; },
        unregisterCallback: (key) => callbacks.delete(key),
        metadata: { currentWindow: { label: 'desktop-lyric' }, currentWebview: { label: 'desktop-lyric' } },
        invoke: async (command, args) => {
          if (command === 'plugin:event|listen') { handlers.set(args.event, callbacks.get(args.handler)); return 1; }
          if (command === 'get_runtime_info') return { os: 'macos', arch: 'arm64' };
          return null;
        },
      } });
    }, { mode });
    await page.route('**/*', (route) => new URL(route.request().url()).origin === baseURL ? route.continue() : route.fulfill({ json: {} }));
    await page.goto(`${baseURL}/desktop-lyric/index.html`);
    await page.getByRole('region', { name: '桌面歌词控制区域' }).waitFor();
    await page.waitForTimeout(200);
    await page.evaluate(({ mode }) => {
      const line = Array.from({ length: 100 }, (_, i) => `[${String(Math.floor(i * 10 / 60)).padStart(2, '0')}:${String(i * 10 % 60).padStart(2, '0')}]歌词第${i + 1}行`).join('\n');
      const words = Array.from({ length: 100 }, (_, i) => `[${i * 10000},10000](0,3000,0)歌词(${3000},3000,0)测试(${6000},4000,0)第${i + 1}行`).join('\n');
      window.__sendLyricFixture('lyric-song', { trackKey: 'qq:profile', id: 'profile', source: 'qq', title: '本地歌词测试', artist: '模拟数据', lrc: mode === 'karaoke' ? words : line });
      window.__sendLyricFixture('lyric-tick', { trackKey: 'qq:profile', currentTime: 120, isPlaying: true, playbackRate: 1, lyricDisplayMode: mode, lyricOffsetSeconds: 0 });
    }, { mode });
    await page.waitForTimeout(1000);
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map((entry) => [entry.name, entry.value]));
    const before = await metrics();
    const initial = await page.evaluate(() => ({ ...window.__lyricPerformance }));
    await page.waitForTimeout(durationMs);
    const after = await metrics();
    const final = await page.evaluate(() => ({ ...window.__lyricPerformance }));
    const sample = { mode, durationMs,
      work: Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount'].map((key) => [key, after[key] - before[key]])),
      counters: Object.fromEntries(Object.keys(final).map((key) => [key, final[key] - initial[key]])),
      visibleWords: await page.locator('.karaoke-word').count(),
      currentText: await page.locator('.desktop-lyric-current-line').innerText(),
      dom: await client.send('Memory.getDOMCounters') };
    results.push(sample); console.log(JSON.stringify(sample));
    await page.close();
  }
  const target = process.env.PROFILE_OUTPUT ?? '/tmp/tunefree-desktop-lyric-profile.json';
  writeFileSync(target, `${JSON.stringify({ date: new Date().toISOString(), baseURL, scenarios: results, errors,
    limitations: 'Fixed production Chromium desktop lyric renderer; no native IPC latency, using synthetic timing/lyrics. Attribute observer adds shared overhead.' }, null, 2)}\n`);
  console.log(`Report: ${target}; errors: ${errors.length}`);
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
