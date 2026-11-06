/** Production UI stress run. Start `npm run start` after building, then run this script. */
import { chromium } from '@playwright/test';
import { createWriteStream, writeFileSync } from 'node:fs';

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
const cycles = Number(process.env.PROFILE_CYCLES ?? 30);
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname === '127.0.0.1' && url.port === '3101') return route.continue();
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});
await page.addInitScript(() => {
  const songs = Array.from({ length: 5000 }, (_, index) => ({
    id: `stress-${index}`, name: `压力测试歌曲 ${index + 1}`, artist: '本地测试', album: '5000 首测试歌单', source: 'qq', pic: '',
  }));
  localStorage.setItem('tunefree_library', JSON.stringify({ favorites: [], playlists: [{ id: 'stress', name: '性能测试歌单', createTime: 1, songs }] }));
  localStorage.setItem('tunefree_desktop_mira_position_v3', JSON.stringify({ x: 1030, y: 90 }));
  localStorage.setItem('tunefree_current_song', JSON.stringify(songs[0]));
  localStorage.setItem('tunefree_queue', JSON.stringify(songs.slice(0, 100)));
  localStorage.setItem('tunefree_theme_mode', 'light');
});

try {
  await page.goto('http://127.0.0.1:3101/');
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
  const nav = name => page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name, exact: true }).press('Enter');
  const settle = async () => {
    await page.mouse.move(600, 400);
    await page.locator('button:focus, [role="button"]:focus').evaluateAll(elements => elements.forEach(element => element.blur()));
    await page.waitForTimeout(600);
  };
  const samples = [];
  const snapshot = async suffix => {
    if (!process.env.PROFILE_HEAP_PREFIX) return;
    const stream = createWriteStream(`${process.env.PROFILE_HEAP_PREFIX}-${suffix}.heapsnapshot`);
    const append = ({ chunk }) => stream.write(chunk);
    client.on('HeapProfiler.addHeapSnapshotChunk', append);
    await client.send('HeapProfiler.takeHeapSnapshot');
    client.off('HeapProfiler.addHeapSnapshotChunk', append);
    await new Promise(resolve => stream.end(resolve));
  };
  const sample = async cycle => {
    await settle();
    await client.send('HeapProfiler.collectGarbage');
    const heap = await client.send('Runtime.getHeapUsage');
    samples.push({ cycle, elapsedMs: Date.now() - start, heapBytes: heap.usedSize, dom: await client.send('Memory.getDOMCounters') });
    console.log(JSON.stringify(samples.at(-1)));
  };
  let maxRenderedSongRows = 0;
  const exercise = async () => {
    await nav('歌单');
    await page.getByRole('button', { name: /性能测试歌单.*打开/ }).press('Enter');
    const list = page.locator('.song-virtual-list');
    await list.waitFor();
    for (const fraction of [0, 0.5, 1]) {
      await list.evaluate((element, position) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * position; }, fraction);
      await page.waitForTimeout(50);
      maxRenderedSongRows = Math.max(maxRenderedSongRows, await list.locator('.song-row').count());
    }
    await page.locator('.transport').getByRole('button', { name: '打开全屏播放器', exact: true }).press('Enter');
    await page.getByRole('dialog', { name: '全屏播放器', exact: true }).waitFor();
    await page.getByRole('button', { name: '收起播放器', exact: true }).press('Enter');
    await page.getByRole('dialog', { name: '全屏播放器', exact: true }).waitFor({ state: 'hidden' });
    await nav('设置');
    await nav('音源');
    await nav('搜索');
    await nav('首页');
    const pet = page.getByRole('button', { name: /^Bloub 音乐伙伴/ });
    await pet.press('Shift+F10');
    await page.getByRole('dialog', { name: 'Bloub 动作与表情' }).waitFor();
    await page.getByRole('button', { name: '关闭动作面板' }).press('Enter');
    await nav('关于');
    await settle();
    await page.locator('.lyric-toggle-btn').hover();
    await page.getByRole('tooltip').waitFor();
  };
  const start = Date.now();
  for (let warmup = 0; warmup < 3; warmup += 1) await exercise();
  await sample(0);
  await snapshot('before');
  const before = await metrics();
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    await exercise();
    if (cycle % 5 === 0) await sample(cycle);
  }
  await page.waitForTimeout(5000);
  await sample(cycles + 1);
  await snapshot('after');
  const after = await metrics();
  const report = { startedAt: new Date(start).toISOString(), durationMs: Date.now() - start,
    scenario: { playlistSongs: 5000, warmups: 3, cycles, fullPlayerOpenClose: cycles + 3, externalRequests: 'local empty fixtures' },
    maxRenderedSongRows, samples, errors,
    measuredWork: Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount'].map(key => [key, after[key] - before[key]])),
    limitations: 'Chromium production renderer with offline fixtures; native WebKit/Rust processes measured separately. GC-normalized samples detect retained growth, not proof of absence of every leak.' };
  const target = process.env.PROFILE_OUTPUT ?? '/tmp/tunefree-ui-profile.json';
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${target}; rows: ${maxRenderedSongRows}; errors: ${errors.length}`);
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
