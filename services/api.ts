export { GD_STUDIO_API_BASE } from "./config";

export {
  fixUrl,
  getImgReferrerPolicy,
  normalizeSongs,
  extractList,
} from "./utils";

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
  fetchNeteaselyrics,
} from "./netease";
export {
  searchQQ,
  qqMusicuFetch,
  getQQTopLists,
  getQQTopListDetail,
  fetchQQLyrics,
} from "./qq";
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

import { Song, TopList } from "../types";
import {
  searchNetease,
  getNeteaseTopLists,
  getNeteaseTopListDetail,
} from "./netease";
import { searchQQ, getQQTopLists, getQQTopListDetail } from "./qq";
import { searchKuwo, getKuwoTopLists, getKuwoTopListDetail } from "./kuwo";
import { searchGDStudio } from "./gdStudio";

export const searchSongs = async (
  keyword: string,
  platform: string,
  page: number = 1,
): Promise<Song[]> => {
  const limit = 30;

  if (platform === "netease") return searchNetease(keyword, page, limit);
  if (platform === "qq") return searchQQ(keyword, page, limit);
  if (platform === "kuwo") return searchKuwo(keyword, page, limit);
  if (platform === "joox") return searchGDStudio(keyword, platform, page, limit);

  return [];
};

export const searchAggregate = async (
  keyword: string,
  page: number = 1,
  options: { includeExtendedSources?: boolean } = {},
): Promise<Song[]> => {
  const platforms = options.includeExtendedSources
    ? (["netease", "qq", "kuwo", "joox"] as const)
    : (["netease", "qq", "kuwo"] as const);

  const results = await Promise.all(
    platforms.map((p) =>
      searchSongs(keyword, p, page).catch(() => [] as Song[]),
    ),
  );

  const merged: Song[] = [];
  const maxLen = Math.max(...results.map((r) => r.length));
  for (let i = 0; i < maxLen; i++) {
    for (const platformResult of results) {
      if (platformResult[i]) merged.push(platformResult[i]);
    }
  }

  return merged;
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
