import { throwIfAborted } from './proxy';
import { Song, TopList } from "../types";
import { searchNetease, getNeteaseTopLists, getNeteaseTopListDetail } from "./netease";
import { searchQQ, getQQTopLists, getQQTopListDetail } from "./qq";
import { searchKuwo, getKuwoTopLists, getKuwoTopListDetail } from "./kuwo";
import { searchGDStudio } from "./gdStudio";

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
export {
  searchGDStudio,
  getGDStudioSongUrl,
  getGDStudioLyrics,
  getGDStudioPic,
  isGDStudioSource,
  isGDStudioOnlySource,
} from "./gdStudio";

export const searchSongs = async (
  keyword: string,
  platform: string,
  page: number = 1,
  signal?: AbortSignal,
): Promise<Song[]> => {
  throwIfAborted(signal);
  const limit = 30;

  if (platform === "netease") return searchNetease(keyword, page, limit, signal);
  if (platform === "qq") return searchQQ(keyword, page, limit, signal);
  if (platform === "kuwo") return searchKuwo(keyword, page, limit, signal);
  if (platform === "joox") return searchGDStudio(keyword, platform, page, limit, signal);

  return [];
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

export const searchAggregate = async (
  keyword: string, page: number = 1, options: AggregateSearchOptions = {},
): Promise<Song[]> => {
  throwIfAborted(options.signal);
  const platforms = options.includeExtendedSources
    ? ['netease', 'qq', 'kuwo', 'joox'] : ['netease', 'qq', 'kuwo'];
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

export const getTopLists = async (platform: string): Promise<TopList[]> => {
  if (platform === "netease") return getNeteaseTopLists();
  if (platform === "qq") return getQQTopLists();
  if (platform === "kuwo") return getKuwoTopLists();
  return [];
};

export const getTopListDetail = async (
  id: string | number,
  platform: string,
): Promise<Song[]> => {
  if (platform === "netease") return getNeteaseTopListDetail(id);
  if (platform === "qq") return getQQTopListDetail(id);
  if (platform === "kuwo") return getKuwoTopListDetail(id);
  return [];
};

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
