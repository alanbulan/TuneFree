import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../types';
import type { ContextSongSuggestion } from '../../ipc/types';
import { searchSongsByContext } from '../contextSearch';
import { registerBuiltinProviders, setCustomProviders, searchSongs } from '../sources/registry';
import { BUILTIN_PROVIDERS } from '../sources/builtin';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));

vi.mock('../../ipc/commands', () => ({ invokeCommand: mocks.invoke }));
vi.mock('../../ipc/env', () => ({ isTauri: mocks.isTauri }));
vi.mock('../sources/registry', async (original) => ({
  ...await original<typeof import('../sources/registry')>(),
  searchSongs: vi.fn(),
}));

const song = (name: string, artist: string, source = 'netease', extra: Partial<Song> = {}): Song => ({
  id: `${source}-${name}`, name, artist, album: '', source, ...extra,
});

const suggestion = (name: string, artist: string): ContextSongSuggestion => ({ name, artist, reason: '贴合场景' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isTauri.mockReturnValue(true);
  registerBuiltinProviders(BUILTIN_PROVIDERS);
  setCustomProviders([]);
});
afterEach(() => {
  registerBuiltinProviders(BUILTIN_PROVIDERS);
  setCustomProviders([]);
});

describe('语境搜歌', () => {
  it('把模型给的歌名歌手解析成真实平台歌曲，并保留推荐理由', async () => {
    mocks.invoke.mockResolvedValue([suggestion('晴天', '周杰伦')]);
    vi.mocked(searchSongs).mockResolvedValue([
      song('晴天', '周杰伦', 'netease', { pic: 'https://p.test/1.jpg' }),
    ]);

    const songs = await searchSongsByContext('下雨天', 5);

    expect(mocks.invoke).toHaveBeenCalledWith('search_songs_by_context', { keyword: '下雨天', limit: 5 });
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ name: '晴天', artist: '周杰伦', source: 'netease' });
    expect(songs[0].recommendationReasons).toEqual(['贴合场景']);
    // 搜索词带上歌手，降低同名歌曲搜错的概率
    expect(searchSongs).toHaveBeenCalledWith('晴天 周杰伦', expect.any(String), 1, 5, undefined);
  });

  it('歌名完全对不上就丢弃，宁缺毋滥', async () => {
    mocks.invoke.mockResolvedValue([suggestion('晴天', '周杰伦')]);
    vi.mocked(searchSongs).mockResolvedValue([song('七里香', '周杰伦')]);

    expect(await searchSongsByContext('下雨天')).toEqual([]);
  });

  it('同名但歌手对不上时降低优先级，优先选歌手命中的那个', async () => {
    mocks.invoke.mockResolvedValue([suggestion('后来', '刘若英')]);
    vi.mocked(searchSongs).mockImplementation(async (_keyword, platform) => platform === 'netease'
      ? [song('后来', '其他歌手', 'netease')]
      : [song('后来', '刘若英', 'qq')]);

    const songs = await searchSongsByContext('怀旧');

    expect(songs).toHaveLength(1);
    expect(songs[0].source).toBe('qq');
  });

  it('歌名与歌手都完全命中时不再问后续平台', async () => {
    mocks.invoke.mockResolvedValue([suggestion('夜曲', '周杰伦')]);
    vi.mocked(searchSongs).mockImplementation(async (_keyword, platform) =>
      platform === 'netease' ? [song('夜曲', '周杰伦', 'netease')] : []);

    const songs = await searchSongsByContext('夜晚');

    expect(songs).toHaveLength(1);
    expect(searchSongs).toHaveBeenCalledTimes(1);
  });

  it('单个平台失败不影响其他平台', async () => {
    mocks.invoke.mockResolvedValue([suggestion('起风了', '买辣椒也用券')]);
    vi.mocked(searchSongs).mockImplementation(async (_keyword, platform) => {
      if (platform === 'netease') throw new Error('熔断了');
      return [song('起风了', '买辣椒也用券', platform)];
    });

    const songs = await searchSongsByContext('毕业');

    expect(songs).toHaveLength(1);
    expect(songs[0].source).not.toBe('netease');
  });

  it('同一首歌在多个平台命中时只保留一次，并保持模型给的顺序', async () => {
    mocks.invoke.mockResolvedValue([
      suggestion('第一首', '甲'), suggestion('第二首', '乙'),
    ]);
    vi.mocked(searchSongs).mockImplementation(async (keyword) => [
      song(String(keyword).split(' ')[0], 'someone'),
    ]);

    const songs = await searchSongsByContext('场景');

    expect(songs.map((item) => item.name)).toEqual(['第一首', '第二首']);
  });

  it('空关键词不发请求；模型返回空则不搜索', async () => {
    expect(await searchSongsByContext('   ')).toEqual([]);
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValue([]);
    expect(await searchSongsByContext('雨天')).toEqual([]);
    expect(searchSongs).not.toHaveBeenCalled();
  });

  it('非桌面环境直接报错，不静默返回空', async () => {
    mocks.isTauri.mockReturnValue(false);
    await expect(searchSongsByContext('雨天')).rejects.toThrow(/桌面应用/);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('模型侧失败原样抛出，交给界面翻译成可行动提示', async () => {
    mocks.invoke.mockRejectedValue(new Error('云端推荐未启用或配置不完整'));
    await expect(searchSongsByContext('雨天')).rejects.toThrow('云端推荐未启用或配置不完整');
  });
});
