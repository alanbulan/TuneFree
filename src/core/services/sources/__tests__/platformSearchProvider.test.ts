import { describe, expect, it, vi, beforeEach } from 'vitest';
import { platformSearchProvider } from '../platformSearchProvider';

const mocks = vi.hoisted(() => ({ searchKugou: vi.fn(), searchMigu: vi.fn() }));

vi.mock('../../kugou', () => ({ searchKugou: mocks.searchKugou }));
vi.mock('../../migu', () => ({ searchMigu: mocks.searchMigu }));

const kugouSong = { id: 'K1', source: 'kugou', name: '狗歌', artist: '', album: '' };
const miguSong = { id: 'M1', source: 'migu', name: '咪歌', artist: '', album: '' };

describe('platformSearchProvider', () => {
  beforeEach(() => {
    mocks.searchKugou.mockReset().mockResolvedValue([kugouSong]);
    mocks.searchMigu.mockReset().mockResolvedValue([miguSong]);
  });

  it('只声明搜索能力：没有解析与歌词，并标记为扩展源', () => {
    expect(platformSearchProvider.platforms).toEqual([]);
    expect(platformSearchProvider.searchPlatforms).toEqual(['kugou', 'migu']);
    expect(platformSearchProvider.getUrl).toBeUndefined();
    expect(platformSearchProvider.getLyrics).toBeUndefined();
    expect(platformSearchProvider.searchTier).toBe('extended');
    // kg / mg 没有内置解析入口，只有存在自定义音源时才值得参与兜底
    expect(platformSearchProvider.fallback).toBe('with-custom');
  });

  it('搜索按平台分发到各自的实现', async () => {
    await expect(platformSearchProvider.search!('晴天', 'kugou', 2, 10)).resolves.toEqual([kugouSong]);
    expect(mocks.searchKugou).toHaveBeenCalledWith('晴天', 2, 10, undefined);
    expect(mocks.searchMigu).not.toHaveBeenCalled();

    await expect(platformSearchProvider.search!('晴天', 'migu', 1, 5)).resolves.toEqual([miguSong]);
    expect(mocks.searchMigu).toHaveBeenCalledWith('晴天', 1, 5, undefined);
  });

  it('未声明的平台返回空列表', async () => {
    await expect(platformSearchProvider.search!('晴天', 'netease', 1, 5)).resolves.toEqual([]);
    expect(mocks.searchKugou).not.toHaveBeenCalled();
    expect(mocks.searchMigu).not.toHaveBeenCalled();
  });
});
