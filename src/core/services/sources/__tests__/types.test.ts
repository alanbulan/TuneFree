import { describe, expect, it } from 'vitest';
import { providerHandles, providerLists, providerSearches, toSourceResolveRequest } from '../types';
import type { MusicProvider } from '../types';

const provider = (overrides: Partial<MusicProvider> = {}): MusicProvider => ({
  kind: 'native',
  id: 'p',
  label: '替身',
  platforms: ['netease'],
  ...overrides,
});

describe('sources/types', () => {
  it('能力判定按声明取交集', () => {
    const full = provider({
      platforms: ['netease', 'qq'],
      searchPlatforms: ['netease'],
      topListPlatforms: ['qq'],
      search: async () => [],
      topLists: async () => [],
    });
    expect(providerHandles(full, 'netease')).toBe(true);
    expect(providerHandles(full, 'kuwo')).toBe(false);
    expect(providerSearches(full, 'netease')).toBe(true);
    expect(providerSearches(full, 'qq')).toBe(false);
    expect(providerLists(full, 'qq')).toBe(true);
    expect(providerLists(full, 'netease')).toBe(false);

    // 没有对应方法或没有声明搜索平台都不算提供该能力
    const bare = provider();
    expect(providerSearches(bare, 'netease')).toBe(false);
    expect(providerLists(bare, 'netease')).toBe(false);
  });

  it('从 Song 构造解析请求', () => {
    expect(
      toSourceResolveRequest({ id: 7, source: 'qq', name: '歌名', artist: '歌手', album: '专辑',
        urlId: 'url', lyricId: 'lyric', picId: 'pic', hash: 'hash', albumId: 'album',
        qualityHashes: { flac: { hash: 'flac-hash' } } }, 'flac', {
        forceRefresh: true,
      }),
    ).toEqual({
      platform: 'qq',
      id: 7,
      quality: 'flac',
      name: '歌名',
      artist: '歌手',
      album: '专辑',
      urlId: 'url', lyricId: 'lyric', picId: 'pic', hash: 'hash', albumId: 'album',
      qualityHashes: { flac: { hash: 'flac-hash' } },
      forceRefresh: true,
      signal: undefined,
    });
  });
});
