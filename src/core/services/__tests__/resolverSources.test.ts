import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 与 resolver.test.ts 相同的隔离方式：屏蔽平台模块，只验证解析编排。
vi.mock('../netease', () => ({ searchNetease: vi.fn(), fetchNeteaseLyrics: vi.fn() }));
vi.mock('../qq', () => ({ searchQQ: vi.fn(), fetchQQLyrics: vi.fn(), qqMusicuFetch: vi.fn() }));
vi.mock('../kuwo', () => ({ searchKuwo: vi.fn(), fetchKuwoLyrics: vi.fn(), batchFetchKuwoCovers: vi.fn() }));
vi.mock('../kugou', () => ({ searchKugou: vi.fn() }));
vi.mock('../migu', () => ({ searchMigu: vi.fn() }));

import { fetchFallbackLyrics, getLyrics, getSongUrl, parseSongFull } from '../resolver';
import { fetchNeteaseLyrics, searchNetease } from '../netease';
import { searchQQ } from '../qq';
import { searchKuwo } from '../kuwo';
import { searchKugou } from '../kugou';
import { searchMigu } from '../migu';
import { BUILTIN_PROVIDERS } from '../sources/builtin';
import { nativeProvider } from '../sources/nativeProvider';
import { registerBuiltinProviders, setCustomProviders } from '../sources/registry';
import type { MusicProvider } from '../sources/types';

const songMeta = {
  name: '江南',
  artist: '林俊杰',
  album: '第二天堂',
  pic: '',
  picId: '',
  urlId: '',
  lyricId: '',
};

const provider = (overrides: Partial<MusicProvider> = {}): MusicProvider => ({
  kind: 'lx',
  id: 'lx:script',
  label: '自定义音源',
  platforms: [],
  getUrl: async () => null,
  ...overrides,
});

const register = (platform: string, entry: Partial<MusicProvider>): void => {
  setCustomProviders([
    {
      provider: provider({ platforms: [platform], ...entry }),
      platform,
    },
  ]);
};

describe('自定义音源接入解析链路', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setCustomProviders([]);
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: 'https://native.test/x.mp3' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(searchNetease).mockResolvedValue([]);
    vi.mocked(searchQQ).mockResolvedValue([]);
    vi.mocked(searchKuwo).mockResolvedValue([]);
    vi.mocked(searchKugou).mockResolvedValue([]);
    vi.mocked(searchMigu).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    registerBuiltinProviders(BUILTIN_PROVIDERS);
    setCustomProviders([]);
    vi.restoreAllMocks();
  });

  it('命中自定义音源时独占该平台，不再请求内置接口', async () => {
    register('netease', { getUrl: async () => 'https://custom.test/a.mp3' });

    await expect(getSongUrl(1, 'netease', '320k', songMeta)).resolves.toBe('https://custom.test/a.mp3');
    expect(fetchMock).not.toHaveBeenCalled();

    // 其它平台没有自定义音源，仍走内置解析。
    await expect(getSongUrl(2, 'qq', '320k', songMeta)).resolves.toBe('https://native.test/x.mp3');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('自定义音源失败时该平台直接失败，但仍会跨源兜底', async () => {
    register('netease', {
      getUrl: async () => {
        throw new Error('源接口 500');
      },
    });
    vi.mocked(searchQQ).mockResolvedValue([
      { id: 'qq-1', name: '江南', artist: '林俊杰', album: '', source: 'qq' },
    ]);

    await expect(getSongUrl(1, 'netease', '320k', songMeta)).resolves.toBe('https://native.test/x.mp3');
    // 兜底落在 QQ 平台：只有那一次内置请求，netease 自己的内置接口没被调用。
    const requested = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requested.some((url) => url.includes('platform=netease'))).toBe(false);
    expect(requested.some((url) => url.includes('platform=qq'))).toBe(true);
  });

  it('自定义音源提供歌词时优先使用，且不请求原生歌词', async () => {
    register('netease', { getLyrics: async () => '[00:00]自定义歌词' });

    await expect(getLyrics(1, 'netease', songMeta)).resolves.toBe('[00:00]自定义歌词');
    expect(fetchNeteaseLyrics).not.toHaveBeenCalled();
  });

  it('自定义音源提供封面时填充缺失的封面', async () => {
    register('netease', {
      getUrl: async () => 'https://custom.test/a.mp3',
      getPic: async () => 'https://custom.test/cover.jpg',
    });

    await expect(parseSongFull(1, 'netease', '320k', songMeta)).resolves.toMatchObject({
      url: 'https://custom.test/a.mp3',
      pic: 'https://custom.test/cover.jpg',
    });
  });

  it('延后元数据的播放解析不等待封面，也不请求歌词', async () => {
    const getPic = vi.fn(async () => 'https://custom.test/cover.jpg');
    const getLyrics = vi.fn(async () => '歌词');
    register('netease', { getUrl: async () => 'https://custom.test/a.mp3', getPic, getLyrics });
    await expect(parseSongFull(1, 'netease', '320k', songMeta, { deferMetadata: true })).resolves.toMatchObject({
      url: 'https://custom.test/a.mp3', pic: '', lrc: '',
    });
    expect(getPic).not.toHaveBeenCalled();
    expect(getLyrics).not.toHaveBeenCalled();
  });

  it('自定义歌词接收歌曲 id 和独立歌词 id，避免把歌词 id 当成歌曲解析', async () => {
    const customLyrics = vi.fn(async () => '歌词');
    register('netease', { getLyrics: customLyrics });
    await getLyrics('song-id', 'netease', { ...songMeta, lyricId: 'lyric-id' });
    expect(customLyrics).toHaveBeenCalledWith(expect.objectContaining({ id: 'song-id', lyricId: 'lyric-id' }));
  });

  it('按歌名匹配兜底：缺 id 时使用开启该能力的音源，并保留原曲目身份', async () => {
    // 让内置解析先失败，才会走到跨源兜底的末段。
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    register('kugou', {
      getUrl: async (request) => (request.id === '' ? 'https://custom.test/by-name.mp3' : null),
      nameMatch: true,
    });

    await expect(parseSongFull('42', 'netease', '320k', songMeta)).resolves.toMatchObject({
      url: 'https://custom.test/by-name.mp3',
      resolvedSource: 'netease',
      resolvedId: '42',
    });
  });

  it('按歌名匹配兜底：失败、抛错与无候选都不影响最终结果', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    register('kugou', { getUrl: async () => null, nameMatch: true });
    await expect(getSongUrl('42', 'netease', '320k', songMeta)).resolves.toBeNull();

    register('kugou', {
      getUrl: async () => {
        throw new Error('按歌名匹配炸了');
      },
      nameMatch: true,
    });
    await expect(getSongUrl('42', 'netease', '320k', songMeta)).resolves.toBeNull();

    register('kugou', { getUrl: async () => 'https://custom.test/by-name.mp3' });
    await expect(getSongUrl('42', 'netease', '320k', songMeta)).resolves.toBeNull();

    setCustomProviders([]);
    await expect(getSongUrl('42', 'netease', '320k', { ...songMeta, name: '' })).resolves.toBeNull();
  });

  it('跨源兜底：只有启用了 kg / mg 自定义音源时才去搜这两个平台', async () => {
    // 让内置解析先失败，才会走到跨源兜底。
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    // 没有自定义音源：兜底不去搜索酷狗/咪咕
    await expect(getSongUrl('42', 'qq', '320k', songMeta)).resolves.toBeNull();
    expect(searchKugou).not.toHaveBeenCalled();
    expect(searchMigu).not.toHaveBeenCalled();

    vi.mocked(searchKugou).mockResolvedValue([
      { id: 'KUGOU_HASH', source: 'kugou', name: '江南', artist: '林俊杰', album: '', hash: 'KUGOU_HASH' },
    ]);
    register('kugou', { getUrl: async (request) => (request.platform === 'kugou' ? 'https://custom.test/kg.mp3' : null) });

    await expect(getSongUrl('42', 'qq', '320k', songMeta)).resolves.toBe('https://custom.test/kg.mp3');
    expect(searchKugou).toHaveBeenCalled();
    // 咪咕没有启用自定义音源，仍然不会被搜索
    expect(searchMigu).not.toHaveBeenCalled();
  });

  it('没有任何可搜索的兜底平台时，直接走按歌名匹配', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    // 只留解析能力、拿掉所有搜索声明，模拟「兜底无候选」的极端注册表状态
    registerBuiltinProviders([{ ...nativeProvider, searchPlatforms: [] }]);
    register('kugou', {
      getUrl: async (request) => (request.id === '' ? 'https://custom.test/by-name.mp3' : null),
      nameMatch: true,
    });

    await expect(getSongUrl('42', 'netease', '320k', songMeta)).resolves.toBe('https://custom.test/by-name.mp3');
    expect(searchKugou).not.toHaveBeenCalled();
    expect(searchNetease).not.toHaveBeenCalled();
  });

  it('歌词缓存命中时不再触发平台请求', async () => {
    vi.mocked(fetchNeteaseLyrics).mockResolvedValue('[00:00]歌词');

    await expect(fetchFallbackLyrics(7, 'netease')).resolves.toBe('[00:00]歌词');
    await expect(fetchFallbackLyrics(7, 'netease')).resolves.toBe('[00:00]歌词');
    expect(fetchNeteaseLyrics).toHaveBeenCalledTimes(1);
  });
});
