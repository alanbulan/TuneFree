import { searchKugou } from '../kugou';
import { searchMigu } from '../migu';
import type { MusicProvider } from './types';

/**
 * 酷狗 / 咪咕的搜索 provider。
 *
 * 这两个平台本应用没有内置播放解析（链接由用户导入的 kg / mg 自定义音源提供），
 * 因此这里只声明搜索能力：让用户能搜到歌、把歌曲元数据（hash / _types /
 * copyrightId）带进解析链路。
 *
 * 跨源兜底声明为 `'with-custom'`：只有存在覆盖该平台的自定义音源时才值得去搜。
 */
export const platformSearchProvider: MusicProvider = {
  kind: 'native',
  id: 'kugou-migu-search',
  label: '酷狗 / 咪咕搜索',
  platforms: [],
  searchPlatforms: ['kugou', 'migu'],
  priority: 30,
  searchTier: 'extended',
  fallback: 'with-custom',

  search: async (keyword, platform, page, limit, signal) => {
    if (platform === 'kugou') return searchKugou(keyword, page, limit, signal);
    if (platform === 'migu') return searchMigu(keyword, page, limit, signal);
    return [];
  },
};
