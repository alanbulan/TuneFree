import { normalizeMusicUrl } from '../musicUrl';
import { searchNetease, getNeteaseTopLists, getNeteaseTopListDetail } from '../netease';
import { searchQQ, getQQTopLists, getQQTopListDetail } from '../qq';
import { searchKuwo, getKuwoTopLists, getKuwoTopListDetail } from '../kuwo';
import { fetchNativeUrl } from './nativeUrl';
import { fetchNativeLyrics } from './nativeLyrics';
import type { MusicProvider, SourceResolveRequest } from './types';

/**
 * 内置平台 provider：网易 / QQ / 酷我。
 *
 * 解析走 Rust `/api/url`，歌词走各平台原生实现（带翻译与逐字，质量更好），
 * 搜索与榜单走各平台 TS 实现。解析优先级低于 GD（与既有行为一致：先 GD 再原生），
 * 歌词优先级高于 GD。
 */

export const NATIVE_PLATFORMS: readonly string[] = ['netease', 'qq', 'kuwo'];

export const nativeProvider: MusicProvider = {
  kind: 'native',
  id: 'native',
  label: '内置解析',
  platforms: NATIVE_PLATFORMS,
  searchPlatforms: NATIVE_PLATFORMS,
  topListPlatforms: NATIVE_PLATFORMS,
  priority: 20,
  lyricsPriority: 10,
  searchTier: 'core',
  fallback: true,

  getUrl: async (request: SourceResolveRequest): Promise<string | null> => {
    if (!NATIVE_PLATFORMS.includes(request.platform)) return null;
    const raw = await fetchNativeUrl(
      String(request.id),
      request.platform,
      request.quality,
      request.signal,
    );
    if (!raw) return null;
    return normalizeMusicUrl(raw) || raw;
  },

  getLyrics: async (request: SourceResolveRequest): Promise<string> =>
    fetchNativeLyrics(request.lyricId || request.id, request.platform, {
      signal: request.signal,
      forceRefresh: request.forceRefresh,
    }),

  search: async (keyword, platform, page, limit, signal) => {
    if (platform === 'netease') return searchNetease(keyword, page, limit, signal);
    if (platform === 'qq') return searchQQ(keyword, page, limit, signal);
    if (platform === 'kuwo') return searchKuwo(keyword, page, limit, signal);
    return [];
  },

  topLists: async (platform) => {
    if (platform === 'netease') return getNeteaseTopLists();
    if (platform === 'qq') return getQQTopLists();
    if (platform === 'kuwo') return getKuwoTopLists();
    return [];
  },

  topListDetail: async (id, platform) => {
    if (platform === 'netease') return getNeteaseTopListDetail(id);
    if (platform === 'qq') return getQQTopListDetail(id);
    if (platform === 'kuwo') return getKuwoTopListDetail(id);
    return [];
  },
};
