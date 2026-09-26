import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicSourceEntry, MusicSourcePlatform } from '../sourceEntry';
import { PROBE_CONCURRENCY, pickProbePlatform, probeMusicSource, probeMusicSources } from '../sourceProbe';

type CallArgs = [string, string, Record<string, unknown>, { signal?: AbortSignal }];

const sandboxes = vi.hoisted(() => new Map<string, { call: (...args: CallArgs) => Promise<unknown> }>());

vi.mock('../manager', () => ({
  getMusicSourceSandbox: (id: string) => sandboxes.get(id),
}));

const platform = (appPlatform: string, lxPlatform: string, overrides: Partial<MusicSourcePlatform> = {}): MusicSourcePlatform => ({
  appPlatform, lxPlatform, actions: ['musicUrl'], ...overrides,
});

const entry = (id: string, platforms: MusicSourcePlatform[] = [platform('kuwo', 'kw')]): MusicSourceEntry => ({
  record: {
    id, name: id, version: '', author: '', description: '', homepage: '', fileName: `${id}.js`,
    content: '', enabled: true, nameMatchFallback: false, importedAt: 0, bytes: 0,
  },
  status: 'ready', error: '', platforms, updateAlert: null, hosts: [], logs: [], calls: [], update: null,
});

describe('sourceProbe', () => {
  beforeEach(() => sandboxes.clear());

  it('按固定顺序挑第一个声明了播放地址的平台', () => {
    expect(pickProbePlatform(entry('a', [platform('kuwo', 'kw'), platform('netease', 'wy')]))?.lxPlatform).toBe('wy');
    expect(pickProbePlatform(entry('b', [platform('netease', 'wy', { actions: ['lyric'] }), platform('migu', 'mg')]))?.lxPlatform).toBe('mg');
    expect(pickProbePlatform(entry('c', [platform('joox', 'joox')]))).toBeNull();
  });

  it('单个检测：直接调用沙箱 musicUrl，按声明挑音质并带上检测歌曲', async () => {
    const call = vi.fn(async (..._args: CallArgs) => ({ ok: true, result: 'https://cdn.test/a.mp3', error: '' }));
    sandboxes.set('a', { call });
    const result = await probeMusicSource(entry('a', [platform('qq', 'tx', { qualitys: ['320k', 'flac'] })]));
    expect(result).toMatchObject({ id: 'a', ok: true, skipped: false, message: '返回有效播放地址' });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    const [source, action, info] = call.mock.calls[0];
    // 检测音质 128k 未声明时沿用解析链路的回落规则（取最高已知音质）。
    expect([source, action, info.type]).toEqual(['tx', 'musicUrl', 'flac']);
    expect(info.musicInfo).toMatchObject({ songmid: '001yS0N33yPm1B', strMediaMid: '002MX8Ea4e5RDS', source: 'tx' });

    await probeMusicSource(entry('a', [platform('kugou', 'kg')]));
    expect(call.mock.calls[1][2]).toMatchObject({ type: '128k', musicInfo: { hash: 'c41e80a18d1448fa47086372999c7f43' } });
  });

  it('单个检测：没有可测平台、沙箱未运行、调用失败分别给出原因', async () => {
    expect(await probeMusicSource(entry('x', []))).toMatchObject({ ok: false, skipped: true, message: '没有可检测的平台' });
    expect(await probeMusicSource(entry('missing'))).toMatchObject({ ok: false, skipped: false, message: '音源未运行，请先启用或重新加载' });
    sandboxes.set('bad', { call: vi.fn(async () => ({ ok: false, result: null, error: '接口返回 403' })) });
    expect(await probeMusicSource(entry('bad'))).toMatchObject({ ok: false, message: '接口返回 403' });
    sandboxes.set('empty', { call: vi.fn(async () => ({ ok: false, result: null, error: '' })) });
    expect(await probeMusicSource(entry('empty'))).toMatchObject({ ok: false, message: '音源调用失败' });
  });

  it('批量检测限制并发、回报进度，异常记为失败', async () => {
    let running = 0;
    let peak = 0;
    const ids = ['a', 'b', 'c', 'd', 'e'];
    for (const id of ids) {
      sandboxes.set(id, {
        call: async () => {
          running += 1; peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 1));
          running -= 1;
          if (id === 'd') throw new Error('沙箱已崩溃');
          return { ok: true, result: 'https://cdn.test/a.mp3', error: '' };
        },
      });
    }
    const progress: Array<[number, string[]]> = [];
    const results = await probeMusicSources(ids.map((id) => entry(id)), { onProgress: (done, active) => progress.push([done, active]) });
    expect(peak).toBe(PROBE_CONCURRENCY);
    expect(results).toHaveLength(5);
    expect(results.find((item) => item.id === 'd')).toMatchObject({ ok: false, message: '沙箱已崩溃' });
    expect(results.filter((item) => item.ok)).toHaveLength(4);
    expect(progress[0]).toEqual([0, ['a']]);
    expect(progress[progress.length - 1]).toEqual([5, []]);
    expect(await probeMusicSources([])).toEqual([]);
  });

  it('取消后不再启动新检测，进行中的调用被中止且不计入结果', async () => {
    const controller = new AbortController();
    const call = vi.fn((...args: CallArgs) => new Promise((_resolve, reject) => {
      args[3].signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    for (const id of ['a', 'b', 'c']) sandboxes.set(id, { call });
    const pending = probeMusicSources(['a', 'b', 'c'].map((id) => entry(id)), { signal: controller.signal, concurrency: 1 });
    await Promise.resolve();
    controller.abort();
    expect(await pending).toEqual([]);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
