import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BUILTIN_PROVIDERS } from '../builtin';
import {
  aggregatePlatforms,
  fallbackPlatformsFor,
  getCustomProviders,
  getNameMatchCandidates,
  getSourceGeneration,
  getTopListDetail,
  getTopLists,
  liveSearchPlatforms,
  topListPlatforms,
  providersFor,
  registerBuiltinProviders,
  resolveDirectUrl,
  resolveFull,
  resolveLyrics,
  resolvePic,
  searchSongs,
  searchUsesGDStudioQuota,
  searchablePlatforms,
  setBuiltinScriptProviders,
  setCustomProviders,
  usesGDStudioQuota,
} from '../registry';
import { CircuitOpenError, getOpenCircuits, resetCircuits } from '../circuitBreaker';
import type { MusicProvider, SourceResolveRequest } from '../types';

/**
 * 注册表是「平台能力的唯一来源」，这里的内置 provider 用可控替身注册，
 * 因此不需要 mock 任何平台模块，断言的就是注册表本身的决策。
 */
const provider = (overrides: Partial<MusicProvider> = {}): MusicProvider => ({
  kind: 'native',
  id: 'fake',
  label: '替身',
  platforms: [],
  ...overrides,
});

const request = (overrides: Partial<SourceResolveRequest> = {}): SourceResolveRequest => ({
  platform: 'kuwo',
  id: 1,
  quality: '320k',
  ...overrides,
});

const fakeBuiltins: MusicProvider[] = [
  provider({
    id: 'native-like',
    label: '原生替身',
    platforms: ['netease', 'qq', 'kuwo'],
    searchPlatforms: ['netease', 'qq', 'kuwo'],
    topListPlatforms: ['netease'],
    priority: 20,
    lyricsPriority: 10,
    searchTier: 'core',
    fallback: true,
    getUrl: async () => 'https://native.test/a.mp3',
    getLyrics: async () => '原生歌词',
    search: async () => [{ id: 'n1', source: 'netease', name: '歌', artist: '', album: '' }],
    topLists: async () => [{ id: 'top', name: '榜单' }],
    topListDetail: async () => [{ id: 't1', source: 'netease', name: '榜首歌', artist: '', album: '' }],
  }),
  provider({
    kind: 'native',
    id: 'search-only',
    label: '搜索替身',
    platforms: [],
    searchPlatforms: ['kugou'],
    priority: 30,
    searchTier: 'extended',
    fallback: 'with-custom',
    search: async () => [{ id: 'k1', source: 'kugou', name: '狗歌', artist: '', album: '' }],
  }),
  provider({
    kind: 'gdstudio',
    id: 'gd-like',
    label: 'GD 替身',
    platforms: ['netease', 'joox'],
    searchPlatforms: ['joox'],
    priority: 10,
    lyricsPriority: 20,
    searchTier: 'extended',
    gdStudioQuota: true,
    fallback: true,
    getUrl: async () => 'https://gd.test/a.mp3',
    getLyrics: async () => 'GD 歌词',
    search: async () => [{ id: 'j1', source: 'joox', name: 'JOOX 歌', artist: '', album: '' }],
  }),
];

describe('registry', () => {
  beforeEach(() => {
    registerBuiltinProviders(fakeBuiltins);
    setCustomProviders([]);
  });

  afterEach(() => {
    registerBuiltinProviders(BUILTIN_PROVIDERS);
    setBuiltinScriptProviders([]);
    setCustomProviders([]);
    vi.restoreAllMocks();
  });

  it('注册与代数：任何变更都让缓存的解析结果失效', () => {
    const before = getSourceGeneration();
    setCustomProviders([{ provider: provider({ platforms: ['kuwo'] }), platform: 'kuwo' }]);
    expect(getSourceGeneration()).toBe(before + 1);
    registerBuiltinProviders(fakeBuiltins);
    expect(getSourceGeneration()).toBe(before + 2);
  });

  it('provider 排序：解析按 priority，歌词按 lyricsPriority（原生优先于 GD）', () => {
    expect(providersFor('netease').map((item) => item.id)).toEqual(['gd-like', 'native-like']);
    expect(providersFor('netease', 'metadata').map((item) => item.id)).toEqual(['native-like', 'gd-like']);
  });

  it('歌词与封面不独占：自定义源优先，取不到再回落内置', async () => {
    setCustomProviders([
      {
        provider: provider({ platforms: ['kuwo'], getLyrics: async () => '', getPic: async () => '' }),
        platform: 'kuwo',
      },
    ]);
    // 解析仍然独占（自定义源存在时不再出现内置 provider）
    expect(providersFor('kuwo').map((item) => item.id)).toEqual(['fake']);
    // 歌词 / 封面把内置 provider 排在自定义源之后（GD 替身不负责 kuwo，故不出现）
    expect(providersFor('kuwo', 'metadata').map((item) => item.id)).toEqual(['fake', 'native-like']);

    await expect(resolveLyrics(request())).resolves.toBe('原生歌词');
    await expect(resolvePic(request())).resolves.toBe('');

    registerBuiltinProviders([
      { ...fakeBuiltins[0], getPic: async () => 'https://img.test/native.jpg' },
      fakeBuiltins[1],
      fakeBuiltins[2],
    ]);
    await expect(resolvePic(request())).resolves.toBe('https://img.test/native.jpg');
  });

  it('自定义音源独占其平台：命中即返回，失败也不回落内置', async () => {
    const customGetUrl = vi.fn(async () => 'https://custom.test/a.mp3');
    setCustomProviders([{ provider: provider({ platforms: ['kuwo'], getUrl: customGetUrl }), platform: 'kuwo' }]);

    await expect(resolveDirectUrl(request())).resolves.toBe('https://custom.test/a.mp3');
    expect(providersFor('kuwo').map((item) => item.id)).toEqual(['fake']);
    expect(getCustomProviders('kuwo')).toHaveLength(1);
    expect(getCustomProviders('netease')).toHaveLength(0);

    const failing = vi.fn(async () => {
      throw new Error('源接口 500');
    });
    setCustomProviders([{ provider: provider({ platforms: ['kuwo'], getUrl: failing }), platform: 'kuwo' }]);
    await expect(resolveDirectUrl(request())).resolves.toBeNull();
  });

  it('自定义音源之间按注册顺序尝试，取消时向上抛 AbortError', async () => {
    const controller = new AbortController();
    const failing = vi.fn(async () => {
      throw new Error('炸');
    });
    const succeeding = vi.fn(async () => 'https://custom.test/ok.mp3');
    setCustomProviders([
      { provider: provider({ platforms: ['kuwo'], getUrl: failing }), platform: 'kuwo' },
      { provider: provider({ platforms: ['kuwo'], getUrl: succeeding }), platform: 'kuwo' },
    ]);
    await expect(resolveDirectUrl(request({ signal: controller.signal }))).resolves.toBe(
      'https://custom.test/ok.mp3',
    );

    const cancelling = vi.fn(async () => {
      controller.abort();
      throw new Error('aborted');
    });
    setCustomProviders([{ provider: provider({ platforms: ['kuwo'], getUrl: cancelling }), platform: 'kuwo' }]);
    await expect(resolveDirectUrl(request({ signal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('内置解析：高优先级失败后自动落到下一个 provider，并规范化 URL', async () => {
    await expect(resolveDirectUrl(request({ platform: 'netease' }))).resolves.toBe('https://gd.test/a.mp3');

    // GD 返回空 → 原生接手
    registerBuiltinProviders([
      { ...fakeBuiltins[2], getUrl: async () => null },
      fakeBuiltins[0],
      fakeBuiltins[1],
    ]);
    await expect(resolveDirectUrl(request({ platform: 'netease' }))).resolves.toBe(
      'https://native.test/a.mp3',
    );

    // 都不支持 → null
    await expect(resolveDirectUrl(request({ platform: 'kugou' }))).resolves.toBeNull();
  });

  it('歌词与封面：按序取第一个非空结果，异常被吞掉', async () => {
    await expect(resolveLyrics(request({ platform: 'netease' }))).resolves.toBe('原生歌词');
    await expect(resolveLyrics(request({ platform: 'joox' }))).resolves.toBe('GD 歌词');
    await expect(resolveLyrics(request({ platform: 'kugou' }))).resolves.toBe('');

    // 抛错的 provider 也覆盖 joox，才会真正进入歌词的失败分支
    registerBuiltinProviders([
      { ...fakeBuiltins[0], platforms: ['joox'], getLyrics: async () => { throw new Error('歌词炸了'); } },
      fakeBuiltins[2],
      fakeBuiltins[1],
    ]);
    await expect(resolveLyrics(request({ platform: 'joox' }))).resolves.toBe('GD 歌词');

    registerBuiltinProviders([
      { ...fakeBuiltins[0], getPic: async () => '' },
      { ...fakeBuiltins[2], platforms: ['netease', 'joox'], getPic: async () => 'https://img.test/a.jpg' },
      fakeBuiltins[1],
    ]);
    await expect(resolvePic(request({ platform: 'netease' }))).resolves.toBe('https://img.test/a.jpg');
    await expect(resolvePic(request({ platform: 'kugou' }))).resolves.toBe('');

    const picFailure = new AbortController();
    registerBuiltinProviders([
      {
        ...fakeBuiltins[0],
        platforms: ['netease'],
        getPic: async () => {
          throw new Error('封面炸了');
        },
      },
      fakeBuiltins[2],
      fakeBuiltins[1],
    ]);
    await expect(resolvePic(request({ platform: 'netease' }))).resolves.toBe('');
    registerBuiltinProviders([
      {
        ...fakeBuiltins[0],
        platforms: ['netease'],
        getPic: async () => {
          picFailure.abort();
          throw new Error('aborted');
        },
      },
      fakeBuiltins[2],
      fakeBuiltins[1],
    ]);
    await expect(resolvePic(request({ platform: 'netease', signal: picFailure.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    });

    const controller = new AbortController();
    registerBuiltinProviders([
      {
        ...fakeBuiltins[0],
        platforms: ['joox'],
        getLyrics: async () => {
          controller.abort();
          throw new Error('aborted');
        },
      },
      fakeBuiltins[2],
      fakeBuiltins[1],
    ]);
    await expect(resolveLyrics(request({ platform: 'joox', signal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('整曲解析：只交给声明了 resolveFull 的 provider', async () => {
    await expect(resolveFull(request({ platform: 'joox' }))).resolves.toBeNull();

    registerBuiltinProviders([
      fakeBuiltins[0],
      {
        ...fakeBuiltins[2],
        resolveFull: async (input) => ({
          url: 'https://gd.test/full.mp3',
          lrc: '词',
          pic: '图',
          resolvedSource: input.platform,
          resolvedId: input.id,
        }),
      },
      fakeBuiltins[1],
    ]);
    await expect(resolveFull(request({ platform: 'joox' }))).resolves.toMatchObject({
      url: 'https://gd.test/full.mp3',
    });

    registerBuiltinProviders([
      {
        ...fakeBuiltins[2],
        resolveFull: async () => {
          throw new Error('炸');
        },
      },
      fakeBuiltins[0],
      fakeBuiltins[1],
    ]);
    await expect(resolveFull(request({ platform: 'joox' }))).resolves.toBeNull();
  });

  it('搜索分发、可选平台与聚合分组都来自 provider 声明', async () => {
    await expect(searchSongs('关键词', 'netease', 1, 5)).resolves.toEqual([
      { id: 'n1', source: 'netease', name: '歌', artist: '', album: '' },
    ]);
    await expect(searchSongs('关键词', 'joox', 1, 5)).resolves.toEqual([
      { id: 'j1', source: 'joox', name: 'JOOX 歌', artist: '', album: '' },
    ]);
    await expect(searchSongs('关键词', 'unknown', 1, 5)).resolves.toEqual([]);

    expect(searchablePlatforms()).toEqual(['netease', 'qq', 'kuwo', 'kugou', 'joox']);
    expect(aggregatePlatforms(false)).toEqual(['netease', 'qq', 'kuwo']);
    expect(aggregatePlatforms(true)).toEqual(['netease', 'qq', 'kuwo', 'kugou', 'joox']);
  });

  it('自定义源提供搜索时也会进入可选平台与聚合分组', () => {
    setCustomProviders([
      {
        provider: provider({ platforms: ['kuwo'], searchPlatforms: ['kuwo'], search: async () => [] }),
        platform: 'kuwo',
      },
    ]);
    expect(searchablePlatforms()).toContain('kuwo');
  });

  it('GD 频次标记：解析与搜索分别可查', () => {
    expect(usesGDStudioQuota('netease')).toBe(true);
    expect(usesGDStudioQuota('kugou')).toBe(false);
    expect(searchUsesGDStudioQuota('joox')).toBe(true);
    expect(searchUsesGDStudioQuota('netease')).toBe(false);
  });

  it('榜单按 provider 声明分发', async () => {
    await expect(getTopLists('netease')).resolves.toEqual([{ id: 'top', name: '榜单' }]);
    await expect(getTopLists('qq')).resolves.toEqual([]);
    await expect(getTopListDetail('top', 'netease')).resolves.toEqual([
      { id: 't1', source: 'netease', name: '榜首歌', artist: '', album: '' },
    ]);
    await expect(getTopListDetail('top', 'qq')).resolves.toEqual([]);
  });

  it('只接管播放解析的自定义音源不屏蔽原生榜单', async () => {
    setCustomProviders([{
      provider: provider({ platforms: ['netease'], getUrl: async () => 'https://custom.test/a.mp3' }),
      platform: 'netease',
    }]);
    await expect(getTopLists('netease')).resolves.toEqual([{ id: 'top', name: '榜单' }]);
    await expect(getTopListDetail('top', 'netease')).resolves.toHaveLength(1);
  });

  it('封面规范化保留 B 站防盗链代理和 QQ 高清地址', async () => {
    registerBuiltinProviders([provider({
      platforms: ['bilibili'], getPic: async () => 'https://i0.hdslb.com/cover.jpg',
    })]);
    expect(await resolvePic(request({ platform: 'bilibili' }))).toContain('/api/cors-proxy?');
  });

  it('内置脚本 provider：与静态内置同等参与解析、搜索与兜底', () => {
    const scriptProvider = provider({
      kind: 'lx',
      id: 'builtin:gd',
      label: 'GD音乐台',
      platforms: ['joox'],
      searchPlatforms: ['joox'],
      priority: 5,
      lyricsPriority: 25,
      searchTier: 'extended',
      fallback: true,
      gdStudioQuota: true,
      getUrl: async () => 'https://script.test/a.mp3',
      search: async () => [{ id: 'j9', source: 'joox', name: '脚本歌', artist: '', album: '' }],
    });
    setBuiltinScriptProviders([{ provider: scriptProvider, platform: 'joox' }]);

    // 优先级 5 高于静态替身（10），因此排在最前；两者都参与 joox 解析
    expect(providersFor('joox').map((item) => item.id)).toEqual(['builtin:gd', 'gd-like']);
    expect(searchablePlatforms()).toContain('joox');
    expect(aggregatePlatforms(true)).toContain('joox');
    expect(searchUsesGDStudioQuota('joox')).toBe(true);
    expect(fallbackPlatformsFor('netease')).toContain('joox');

    setBuiltinScriptProviders([]);
    expect(providersFor('joox').map((item) => item.id)).toEqual(['gd-like']);
    expect(searchablePlatforms()).toContain('joox');
    expect(searchUsesGDStudioQuota('joox')).toBe(true);
  });

  it('跨源兜底候选：总是参与的 + 仅在有自定义源时参与的', () => {
    expect(fallbackPlatformsFor('netease')).toEqual(['qq', 'kuwo', 'joox']);
    // kugou 声明为 with-custom：没有对应自定义源时被排除
    expect(fallbackPlatformsFor('netease')).not.toContain('kugou');
    setCustomProviders([{ provider: provider({ platforms: ['kugou'] }), platform: 'kugou' }]);
    expect(fallbackPlatformsFor('netease')).toContain('kugou');
    expect(fallbackPlatformsFor('kugou')).not.toContain('kugou');
  });

  it('首页榜单标签只在有榜单能力时列出平台，自定义源也算', () => {
    registerBuiltinProviders(fakeBuiltins);
    setBuiltinScriptProviders([]);
    setCustomProviders([]);
    expect(topListPlatforms()).toEqual(['netease']);

    setCustomProviders([
      { platform: 'kugou', provider: provider({ id: 'custom-top', platforms: ['kugou'],
        topLists: async () => [], topListPlatforms: ['kugou'] }) },
      // 只有榜单详情、没有榜单列表的 provider 不算
      { platform: 'migu', provider: provider({ id: 'detail-only', platforms: ['migu'],
        topListDetail: async () => [] }) },
    ]);
    expect(topListPlatforms()).toEqual(['netease', 'kugou']);
  });

  it('按歌名匹配候选只包含显式开启的 provider', () => {
    setCustomProviders([
      { provider: provider({ platforms: ['kugou'], nameMatch: true }), platform: 'kugou' },
      { provider: provider({ platforms: ['kuwo'] }), platform: 'kuwo' },
    ]);
    const candidates = getNameMatchCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].platform).toBe('kugou');
  });
});

describe('熔断接入注册表', () => {
  beforeEach(() => {
    setBuiltinScriptProviders([]);
    setCustomProviders([]);
  });
  afterEach(() => resetCircuits());

  it('搜索连续失败后不再发请求，也不再出现在聚合平台里', async () => {
    let attempts = 0;
    registerBuiltinProviders([
      provider({
        id: 'flaky-search', label: '会挂的搜索源', platforms: [],
        searchPlatforms: ['kugou'], searchTier: 'extended', priority: 30,
        search: async () => { attempts += 1; throw new Error('上游挂了'); },
      }),
    ]);
    expect(aggregatePlatforms(true)).toEqual(['kugou']);

    for (let index = 0; index < 3; index += 1) {
      await expect(searchSongs('歌', 'kugou', 1, 10)).rejects.toThrow('上游挂了');
    }
    expect(attempts).toBe(3);
    // 熔断打开：聚合搜索不再把它列为参与平台，直接搜索也被拒绝且不发请求
    expect(aggregatePlatforms(true)).toEqual([]);
    expect(liveSearchPlatforms()).toEqual([]);
    await expect(searchSongs('歌', 'kugou', 1, 10)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(attempts).toBe(3);
  });

  it('解析连续失败后跳过该 provider，交给下一个', async () => {
    let attempts = 0;
    registerBuiltinProviders([
      provider({
        id: 'broken', label: '坏源', platforms: ['kuwo'], priority: 1,
        getUrl: async () => { attempts += 1; throw new Error('上游 500'); },
      }),
      provider({
        id: 'good', label: '好源', platforms: ['kuwo'], priority: 2,
        getUrl: async () => 'https://good.test/a.mp3',
      }),
    ]);
    const urlRequest = request({ platform: 'kuwo', id: 1, quality: '320k' });

    // 前三次都会退回到好源，但坏源仍被尝试
    for (let index = 0; index < 3; index += 1) {
      expect(await resolveDirectUrl(urlRequest)).toBe('https://good.test/a.mp3');
    }
    expect(attempts).toBe(3);
    // 熔断后坏源被跳过，尝试次数不再增长
    expect(await resolveDirectUrl(urlRequest)).toBe('https://good.test/a.mp3');
    expect(attempts).toBe(3);
  });

  it('返回空结果不算失败，不会误伤没有歌词的歌', async () => {
    registerBuiltinProviders([
      provider({ id: 'no-lyrics', label: '无歌词源', platforms: ['kuwo'], priority: 1,
        getLyrics: async () => '' }),
      provider({ id: 'has-lyrics', label: '有歌词源', platforms: ['kuwo'], priority: 2,
        getLyrics: async () => '歌词' }),
    ]);
    for (let index = 0; index < 5; index += 1) {
      expect(await resolveLyrics(request({ platform: 'kuwo', id: index, quality: '320k' })))
        .toBe('歌词');
    }
    // 空结果只是「这首没有」，该 provider 依然参与后续解析
    expect(getOpenCircuits()).toEqual([]);
  });
});
