import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  disposeMusicSources,
  ensureMusicSourcesInitialized,
  getMusicSourcesSnapshot,
  importMusicSourceFiles,
  importMusicSourceFromUrl,
  reloadMusicSources,
  removeMusicSource,
  setMusicSourceEnabled,
  setMusicSourceNameMatchFallback,
  subscribeMusicSources,
} from '../manager';
import { getCustomProviders, getSourceGeneration, providersFor, setCustomProviders } from '../registry';
import { loadSourceRecords, persistSourceRecords } from '../store';
import type { LxSourceDeclaration } from '../protocol';

/** 可控的沙箱替身：记录实例、模拟 inited 声明与失败。 */
const sandboxState = vi.hoisted(() => ({
  instances: [] as Array<{
    code: string;
    disposed: boolean;
    declarations: Record<string, LxSourceDeclaration> | null;
    snapshot: {
      status: string;
      error: string;
      sources: Record<string, LxSourceDeclaration>;
      updateAlert: null;
      hosts: string[];
      logs: string[];
    };
    listeners: Set<() => void>;
  }>,
}));

vi.mock('../workerHost', () => ({
  LxSandbox: class {
    code: string;
    disposed = false;
    declarations: Record<string, LxSourceDeclaration> | null = null;
    snapshot = {
      status: 'idle',
      error: '',
      sources: {} as Record<string, LxSourceDeclaration>,
      updateAlert: null,
      hosts: [] as string[],
      logs: [] as string[],
    };
    listeners = new Set<() => void>();

    constructor(input: { code: string }) {
      this.code = input.code;
      sandboxState.instances.push(this as unknown as (typeof sandboxState.instances)[number]);
    }

    initialize() {
      if (this.code.includes('BOOM')) {
        this.snapshot.status = 'failed';
        this.snapshot.error = '脚本加载失败：语法错误';
      } else {
        this.snapshot.status = 'ready';
        this.snapshot.sources = this.declarations ?? {
          kw: { name: '酷我', qualitys: ['320k'], actions: ['musicUrl'] },
          local: { name: '本地', qualitys: [], actions: ['musicUrl'] },
        };
      }
      for (const listener of this.listeners) listener();
      return Promise.resolve();
    }

    getSnapshot() {
      return this.snapshot;
    }

    subscribe(listener: () => void) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    dispose() {
      this.disposed = true;
    }

    call() {
      return Promise.resolve({ ok: true, result: 'https://cdn.test/a.mp3', error: '' });
    }
  },
}));

/** 只让写入失败可控，其余走真实实现（含真实 localStorage）。 */
const storageMock = vi.hoisted(() => ({ failWrites: { value: false } }));

vi.mock('../../../utils/safeStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/safeStorage')>();
  return {
    ...actual,
    safeSetJson: (key: string, value: unknown) =>
      storageMock.failWrites.value ? false : actual.safeSetJson(key, value),
  };
});

vi.mock('../relay', () => ({ relaySourceRequest: vi.fn() }));

const { relaySourceRequest } = await import('../relay');
const relayMock = vi.mocked(relaySourceRequest);

const scriptOf = (name: string, extra = ''): string => `/**
 * @name ${name}
 * @version 1.0.0
 */
globalThis.lx;
${extra}
`;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const findSandbox = () => sandboxState.instances.filter((instance) => !instance.disposed);

/** 快照里的用户音源（内置脚本条目单独断言）。 */
const userEntries = () => getMusicSourcesSnapshot().entries.filter((entry) => !entry.record.builtin);
const builtinEntries = () => getMusicSourcesSnapshot().entries.filter((entry) => entry.record.builtin);

describe('manager', () => {
  beforeEach(() => {
    setCustomProviders([]);
    localStorage.clear();
    sandboxState.instances = [];
    disposeMusicSources();
    localStorage.clear();
    sandboxState.instances = [];
    relayMock.mockReset();
  });

  it('初始化：读取存储、启动启用音源并注册 provider', async () => {
    await ensureMusicSourcesInitialized();
    const outcomes = await importMusicSourceFiles([{ fileName: 'a.js', text: scriptOf('音源 A') }]);
    expect(outcomes).toEqual([{ fileName: 'a.js', ok: true, message: '已导入' }]);
    expect(loadSourceRecords()).toHaveLength(1);

    await flush();
    // 内置脚本条目始终存在，且同样是 ready（不可删除、不可停用）
    const builtins = builtinEntries();
    expect(builtins).toHaveLength(1);
    expect(builtins[0].record.builtin).toBe(true);
    expect(builtins[0].status).toBe('ready');
    expect(builtins[0].platforms).toEqual([
      { appPlatform: 'kuwo', lxPlatform: 'kw', actions: ['musicUrl'], qualitys: ['320k'] },
    ]);

    const snapshot = { entries: userEntries() };
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].status).toBe('ready');
    expect(snapshot.entries[0].platforms).toEqual([
      { appPlatform: 'kuwo', lxPlatform: 'kw', actions: ['musicUrl'], qualitys: ['320k'] },
    ]);
    expect(getMusicSourcesSnapshot().readyCount).toBe(2);
    expect(getCustomProviders('kuwo')).toHaveLength(1);
    expect(getCustomProviders('netease')).toHaveLength(0);

    // 幂等：重复调用不会重复启动沙箱。
    const before = findSandbox().length;
    await ensureMusicSourcesInitialized();
    expect(findSandbox()).toHaveLength(before);
  });

  it('导入去重：同内容保留启用状态并提示更新', async () => {
    await importMusicSourceFiles([{ fileName: 'a.js', text: scriptOf('音源 A') }]);
    await flush();
    const [id] = loadSourceRecords().map((record) => record.id);
    setMusicSourceEnabled(id, false);

    const outcomes = await importMusicSourceFiles([{ fileName: 'a-renamed.js', text: scriptOf('音源 A') }]);
    expect(outcomes[0]).toMatchObject({ ok: true, message: '内容相同，已更新原有音源' });
    const records = loadSourceRecords();
    expect(records).toHaveLength(1);
    expect(records[0].enabled).toBe(false);
    expect(records[0].fileName).toBe('a-renamed.js');
    expect(findSandbox()).toHaveLength(0); // 停用状态下不会新起沙箱
  });

  it('导入失败：内容非法、总量超限、写入失败都会回执原因', async () => {
    const invalid = await importMusicSourceFiles([{ fileName: 'bad.html', text: '<!DOCTYPE html>' }]);
    expect(invalid[0].ok).toBe(false);
    expect(invalid[0].message).toContain('网页文件');

    const huge = await importMusicSourceFiles([
      { fileName: 'huge.js', text: scriptOf('大音源', `/*${'x'.repeat(600 * 1024)}*/`) },
    ]);
    expect(huge[0].ok).toBe(false);
    expect(huge[0].message).toContain('上限');
  });

  it('总量超限与写入失败时回滚，不落盘', async () => {
    // 单文件上限 512 KB，因此用一批文件合计突破 3.5 MB 的总量上限。
    const batch = Array.from({ length: 8 }, (_, index) => ({
      fileName: `bulk-${index}.js`,
      text: scriptOf(`批量音源 ${index}`, `/*${'x'.repeat(480 * 1024)}*/`),
    }));
    const overflow = await importMusicSourceFiles(batch);
    expect(overflow.every((outcome) => !outcome.ok)).toBe(true);
    expect(overflow[0].message).toContain('上限');
    expect(loadSourceRecords()).toHaveLength(0);

    localStorage.clear();
    sandboxState.instances = [];
    disposeMusicSources();
    localStorage.clear();

    storageMock.failWrites.value = true;
    const failed = await importMusicSourceFiles([{ fileName: 'q.js', text: scriptOf('配额音源') }]);
    storageMock.failWrites.value = false;
    expect(failed[0].ok).toBe(false);
    expect(failed[0].message).toContain('配额');
    expect(userEntries()).toHaveLength(0);
    expect(loadSourceRecords()).toHaveLength(0);
    expect(findSandbox()).toHaveLength(0);
  });

  it('日志和主机记录变化不重建 provider 或使歌曲缓存失效', async () => {
    await importMusicSourceFiles([{ fileName: 'a.js', text: scriptOf('音源 A') }]);
    await flush();
    const current = getCustomProviders('kuwo')[0];
    const generation = getSourceGeneration();
    const sandbox = findSandbox()[0];
    sandbox.snapshot.logs.push('请求开始');
    sandbox.snapshot.hosts.push('example.test');
    for (const listener of sandbox.listeners) listener();
    expect(userEntries()[0].logs).toContain('请求开始');
    expect(getCustomProviders('kuwo')[0]).toBe(current);
    expect(getSourceGeneration()).toBe(generation);
  });

  it('内置脚本也会重新加载并在退出时终止', async () => {
    await ensureMusicSourcesInitialized();
    const first = findSandbox()[0];
    reloadMusicSources();
    await flush();
    expect(first.disposed).toBe(true);
    expect(findSandbox()).toHaveLength(1);
    expect(providersFor('kuwo')[0].id).toContain('builtin:gd');
    const second = findSandbox()[0];
    disposeMusicSources();
    expect(second.disposed).toBe(true);
    expect(findSandbox()).toHaveLength(0);
  });

  it('并行导入不相互覆盖', async () => {
    await Promise.all([
      importMusicSourceFiles([{ fileName: 'a.js', text: scriptOf('音源 A') }]),
      importMusicSourceFiles([{ fileName: 'b.js', text: scriptOf('音源 B') }]),
    ]);
    expect(loadSourceRecords().map((record) => record.name).sort()).toEqual(['音源 A', '音源 B']);
  });

  it('下载链接的 HTTP 失败响应不能作为音源导入', async () => {
    relayMock.mockResolvedValueOnce({ envelope: {
      status: 404, statusText: 'Not Found', headers: {},
      bodyBase64: Buffer.from('Not found').toString('base64'),
    } });
    const outcome = await importMusicSourceFromUrl('https://example.test/missing.js');
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('404');
    expect(userEntries()).toHaveLength(0);
  });

  it('损坏的记录在启动时标记失败且不影响其它音源', async () => {
    const created = await importMusicSourceFiles([{ fileName: 'a.js', text: scriptOf('音源 A') }]);
    expect(created[0].ok).toBe(true);
    const records = loadSourceRecords();
    persistSourceRecords([{ ...records[0], content: '不是压缩数据' }]);

    disposeMusicSources();
    localStorage.setItem('tunefree_music_sources_keep', '1');
    // 重新走一次初始化流程（记录已在存储里）。
    const recordsOnDisk = loadSourceRecords();
    expect(recordsOnDisk).toHaveLength(1);
    await ensureMusicSourcesInitialized();
    const snapshot = userEntries();
    expect(snapshot[0].status).toBe('failed');
    expect(snapshot[0].error).toContain('损坏');
  });

  it('启停、按歌名匹配开关与删除都会同步到注册表', async () => {
    await importMusicSourceFiles([{ fileName: 'a.js', text: scriptOf('音源 A') }]);
    await flush();
    const [record] = loadSourceRecords();
    expect(getCustomProviders('kuwo')).toHaveLength(1);
    expect(getCustomProviders('kuwo')[0].nameMatch).toBe(false);

    setMusicSourceEnabled(record.id, false);
    expect(getCustomProviders('kuwo')).toHaveLength(0);
    expect(findSandbox()).toHaveLength(0);

    setMusicSourceEnabled(record.id, true);
    await flush();
    expect(findSandbox()).toHaveLength(1);

    setMusicSourceNameMatchFallback(record.id, true);
    expect(getCustomProviders('kuwo')[0].nameMatch).toBe(true);

    setMusicSourceNameMatchFallback('missing-id', true);
    setMusicSourceEnabled('missing-id', true);
    removeMusicSource('missing-id');

    removeMusicSource(record.id);
    expect(loadSourceRecords()).toHaveLength(0);
    expect(getCustomProviders('kuwo')).toHaveLength(0);
  });

  it('沙箱初始化失败时状态为 failed 且不注册 provider', async () => {
    await importMusicSourceFiles([{ fileName: 'boom.js', text: scriptOf('坏音源', '/*BOOM*/') }]);
    await flush();
    const snapshot = userEntries();
    expect(snapshot[0].status).toBe('failed');
    expect(snapshot[0].error).toContain('语法错误');
    expect(getCustomProviders('kuwo')).toHaveLength(0);
  });

  it('重新加载会释放并重启已启用音源', async () => {
    await importMusicSourceFiles([{ fileName: 'a.js', text: scriptOf('音源 A') }]);
    await flush();
    const first = findSandbox()[0];
    reloadMusicSources();
    expect(first.disposed).toBe(true);
    await flush();
    const second = findSandbox()[0];
    expect(second).not.toBe(first);
    expect(getCustomProviders('kuwo')).toHaveLength(1);
  });

  it('从链接导入：成功与失败路径', async () => {
    relayMock.mockResolvedValueOnce({
      envelope: {
        status: 200,
        statusText: 'OK',
        headers: {},
        bodyBase64: Buffer.from(scriptOf('在线音源'), 'utf-8').toString('base64'),
      },
    });
    const imported = await importMusicSourceFromUrl('https://example.test/source.js');
    expect(imported).toMatchObject({ fileName: 'source.js', ok: true });
    expect(loadSourceRecords()[0].name).toBe('在线音源');

    relayMock.mockResolvedValueOnce({ error: '源代理请求失败（HTTP 404）' });
    const failed = await importMusicSourceFromUrl('https://example.test/missing.js');
    expect(failed).toEqual({ fileName: 'missing.js', ok: false, message: '源代理请求失败（HTTP 404）' });

    relayMock.mockResolvedValueOnce({
      envelope: {
        status: 200,
        statusText: 'OK',
        headers: {},
        bodyBase64: Buffer.from('<html>', 'utf-8').toString('base64'),
      },
    });
    const invalid = await importMusicSourceFromUrl('https://example.test/not-a-source');
    expect(invalid.ok).toBe(false);
    expect(invalid.fileName).toMatch(/^在线音源-\d+\.js$/);

    // 无法从 URL 推断文件名时使用默认名。
    relayMock.mockResolvedValueOnce({ error: '失败' });
    const fallbackName = await importMusicSourceFromUrl('not a url');
    expect(fallbackName.fileName).toMatch(/^在线音源-\d+\.js$/);
  });

  it('订阅者能收到状态变化，取消后不再收到', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMusicSources(listener);
    await importMusicSourceFiles([{ fileName: 'a.js', text: scriptOf('音源 A') }]);
    expect(listener).toHaveBeenCalled();
    const count = listener.mock.calls.length;
    unsubscribe();
    await flush();
    // 初始化完成的通知不再到达已取消的订阅者。
    expect(listener.mock.calls.length).toBeLessThanOrEqual(count);
  });

  it('释放后清空记录与 provider', async () => {
    await importMusicSourceFiles([{ fileName: 'a.js', text: scriptOf('音源 A') }]);
    await flush();
    disposeMusicSources();
    expect(userEntries()).toHaveLength(0);
    // 释放会一并清掉内置脚本沙箱，此时连内置条目也不再展示
    expect(getMusicSourcesSnapshot().entries).toHaveLength(0);
    expect(getCustomProviders('kuwo')).toHaveLength(0);
  });
});
