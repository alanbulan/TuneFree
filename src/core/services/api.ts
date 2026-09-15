import { throwIfAborted } from './proxy';
import { Song, TopList } from "../types";
import {
  aggregatePlatforms,
  getTopListDetail as getRegistryTopListDetail,
  getTopLists as getRegistryTopLists,
  searchSongs as searchRegistrySongs,
} from './sources/registry';

/**
 * 对外统一的音乐接口门面。
 *
 * 平台搜索、榜单、聚合等分发都从 `sources/registry.ts` 的 provider 声明派生，
 * 这里只做参数归一化与结果拼接，不再维护任何平台清单。
 */

export {
  normalizeMusicUrl,
  getImgReferrerPolicy,
  normalizeSongs,
  extractList,
} from "./utils";
// Backward compatibility: keep fixUrl alias until all callers are updated
export { normalizeMusicUrl as fixUrl } from "./utils";

export {
  fetchNativeUrl,
  getSongUrl,
  getLyrics,
  fetchFallbackLyrics,
  parseSongFull,
} from "./resolver";

export {
  searchNetease,
  getNeteaseTopLists,
  getNeteaseTopListDetail,
  fetchNeteaseLyrics,
} from "./netease";
// Backward compatibility: keep old name until all callers are updated
export { fetchNeteaseLyrics as fetchNeteaselyrics } from "./netease";
export { searchQQ, qqMusicuFetch, getQQTopLists, getQQTopListDetail, fetchQQLyrics } from "./qq";
export {
  searchKuwo,
  getKuwoTopLists,
  getKuwoTopListDetail,
  fetchKuwoLyrics,
  batchFetchKuwoCovers,
} from "./kuwo";
export { searchKugou } from "./kugou";
export { searchMigu } from "./migu";
export { resolveAutosource, getAIRecommendedSongs } from "./gdStudioExtras";
export {
  aggregatePlatforms,
  searchablePlatforms,
  usesGDStudioQuota,
} from "./sources/registry";

const SEARCH_PAGE_LIMIT = 30;

/** 单平台搜索：由注册表决定哪个 provider 负责该平台。 */
export const searchSongs = async (
  keyword: string,
  platform: string,
  page: number = 1,
  signal?: AbortSignal,
): Promise<Song[]> => {
  throwIfAborted(signal);
  return searchRegistrySongs(keyword, platform, page, SEARCH_PAGE_LIMIT, signal);
};

export interface AggregateSearchOptions {
  includeExtendedSources?: boolean;
  signal?: AbortSignal;
  onPartial?: (songs: Song[], failedSources: string[]) => void;
}

const interleaveSearchResults = (results: Song[][]): Song[] => {
  const merged: Song[] = [];
  const maxLen = Math.max(0, ...results.map((result) => result.length));
  for (let index = 0; index < maxLen; index++) {
    for (const result of results) if (result[index]) merged.push(result[index]);
  }
  return merged;
};

/** 聚合搜索：参与的平台来自注册表（core 常开，extended 由开关控制）。 */
export const searchAggregate = async (
  keyword: string, page: number = 1, options: AggregateSearchOptions = {},
): Promise<Song[]> => {
  throwIfAborted(options.signal);
  const platforms = aggregatePlatforms(options.includeExtendedSources === true);
  const results: Song[][] = platforms.map(() => []);
  const failedSources: string[] = [];
  let succeeded = 0;
  await Promise.all(platforms.map(async (platform, index) => {
    try {
      results[index] = await searchSongs(keyword, platform, page, options.signal);
      succeeded += 1;
    } catch (error) {
      throwIfAborted(options.signal);
      failedSources.push(platform);
      console.warn(`搜索音源 ${platform} 失败`, error);
    }
    throwIfAborted(options.signal);
    options.onPartial?.(interleaveSearchResults(results), [...failedSources]);
  }));
  throwIfAborted(options.signal);
  if (succeeded === 0) throw new Error('所有搜索音源均暂不可用，请稍后重试');
  return interleaveSearchResults(results);
};

export const getTopLists = async (platform: string): Promise<TopList[]> =>
  getRegistryTopLists(platform);

export const getTopListDetail = async (
  id: string | number,
  platform: string,
): Promise<Song[]> => getRegistryTopListDetail(id, platform);

export const triggerDownload = (url: string, filename: string): void => {
  if (!url) return;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};
