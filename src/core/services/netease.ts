import { Song, TopList } from "../types";
import { mergeLyricTracks } from "../utils/lyrics";
import { proxyFetchJson } from "./proxy";
import { normalizeMusicUrl } from "./utils";

// ==============================
// 网易云音乐 直连接口
// 通过 CORS 代理直接调用网易云 API
// ==============================

const getLyricText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { lyric?: unknown }).lyric === "string") {
    return (value as { lyric: string }).lyric;
  }
  return "";
};

const buildNeteaseLyricV1Url = (id: string | number): string =>
  `https://music.163.com/api/song/lyric/v1?id=${id}&cp=false&lv=0&kv=0&tv=0&rv=0&yv=0&ytv=0&yrv=0`;

const buildNeteaseLyricLegacyUrl = (id: string | number): string =>
  `https://music.163.com/api/song/lyric?id=${id}&lv=-1&kv=-1&tv=-1&rv=-1&yv=-1&ytv=-1`;

const fetchNeteaseLyricJson = async (url: string): Promise<any> => {
  const proxied = await proxyFetchJson(url);
  if (proxied) return proxied;

  try {
    const resp = await fetch(url);
    return await resp.json();
  } catch {
    return null;
  }
};

const extractNeteaseLyricTracks = (data: any) => ({
  main: getLyricText(data?.lrc),
  translation: getLyricText(data?.tlyric),
  romanization: getLyricText(data?.romalrc),
  karaoke: getLyricText(data?.yrc) || getLyricText(data?.klyric),
});

const hasAnyLyricTrack = (tracks: ReturnType<typeof extractNeteaseLyricTracks>): boolean =>
  !!(tracks.main || tracks.translation || tracks.romanization || tracks.karaoke);

const mergeNeteaseLyricPayload = (tracks: ReturnType<typeof extractNeteaseLyricTracks>): string =>
  mergeLyricTracks({
    main: tracks.main,
    translation: tracks.translation,
    romanization: tracks.romanization,
    karaoke: tracks.karaoke,
    source: "netease",
  });

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const fetchNeteaseJsonWithRetry = async (
  url: string,
  isValid: (data: any) => boolean,
): Promise<any> => {
  const retryDelays = [180, 360, 720];

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    const data = await proxyFetchJson(url);
    if (isValid(data)) return data;
    if (attempt < retryDelays.length) {
      await wait(retryDelays[attempt]);
    }
  }

  return null;
};

/**
 * 网易云搜索：cloudsearch/pc（未加密，支持分页）
 * @param keyword 搜索关键词
 * @param page    页码（从 1 开始）
 * @param limit   每页数量
 */
export const searchNetease = async (
  keyword: string,
  page: number,
  limit: number,
): Promise<Song[]> => {
  const offset = (page - 1) * limit;
  const url = `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(keyword)}&type=1&offset=${offset}&limit=${limit}`;

  const data = await proxyFetchJson(url);
  const songs = data?.result?.songs;

  if (!songs || !Array.isArray(songs)) return [];

  return songs.map((s: Record<string, unknown>) => {
    const ar = s.ar;
    const al = s.al;
    return {
      id: String(s.id),
      name: String(s.name ?? ""),
      artist: Array.isArray(ar) ? ar.map((a: Record<string, unknown>) => String(a.name ?? "")).join(", ") : "",
      album: typeof al === "object" && al !== null ? String((al as Record<string, unknown>).name ?? "") : "",
      pic: normalizeMusicUrl(typeof al === "object" && al !== null ? (al as Record<string, unknown>).picUrl as string : ""),
      source: "netease" as const,
    };
  });
};

/**
 * 网易云榜单列表：/api/toplist/detail
 * 返回所有可用排行榜的基本信息（ID、名称、封面）。
 */
export const getNeteaseTopLists = async (): Promise<TopList[]> => {
  const data = await fetchNeteaseJsonWithRetry(
    "https://music.163.com/api/toplist/detail",
    (value) => Array.isArray(value?.list),
  );
  const list = data?.list;

  if (!list || !Array.isArray(list)) return [];

  return list.map((item: Record<string, unknown>) => ({
    id: String(item.id),
    name: String(item.name ?? ""),
    updateFrequency: String(item.updateFrequency ?? ""),
    picUrl: normalizeMusicUrl(item.coverImgUrl as string || ""),
    coverImgUrl: normalizeMusicUrl(item.coverImgUrl as string || ""),
  }));
};

/**
 * 网易云榜单详情：/api/v6/playlist/detail
 * 获取指定榜单的前 30 首歌曲列表。
 * @param id 榜单 ID
 */
export const getNeteaseTopListDetail = async (
  id: string | number,
): Promise<Song[]> => {
  const url = `https://music.163.com/api/v6/playlist/detail?id=${id}&n=30`;
  const data = await fetchNeteaseJsonWithRetry(
    url,
    (value) => Array.isArray(value?.playlist?.tracks),
  );
  const tracks = data?.playlist?.tracks;

  if (!tracks || !Array.isArray(tracks)) return [];

  return tracks.map((s: Record<string, unknown>) => {
    const ar = s.ar;
    const al = s.al;
    return {
      id: String(s.id),
      name: String(s.name ?? ""),
      artist: Array.isArray(ar) ? ar.map((a: Record<string, unknown>) => String(a.name ?? "")).join(", ") : "",
      album: typeof al === "object" && al !== null ? String((al as Record<string, unknown>).name ?? "") : "",
      pic: normalizeMusicUrl(typeof al === "object" && al !== null ? (al as Record<string, unknown>).picUrl as string : ""),
      source: "netease" as const,
    };
  });
};

/**
 * 网易云歌词：优先使用 /api/song/lyric/v1 获取 yrc 逐字歌词。
 * 新版接口没有逐字轨道时，再回退旧 /api/song/lyric，避免遗漏旧接口仍可用的 yrc。
 * @param id 歌曲 ID
 */
export const fetchNeteaseLyrics = async (
  id: string | number,
): Promise<string> => {
  try {
    const v1Data = await fetchNeteaseLyricJson(buildNeteaseLyricV1Url(id));
    const v1Tracks = extractNeteaseLyricTracks(v1Data);

    if (v1Tracks.karaoke) {
      return mergeNeteaseLyricPayload(v1Tracks);
    }

    const legacyData = await fetchNeteaseLyricJson(buildNeteaseLyricLegacyUrl(id));
    const legacyTracks = extractNeteaseLyricTracks(legacyData);

    if (legacyTracks.karaoke) {
      return mergeNeteaseLyricPayload(legacyTracks);
    }

    if (hasAnyLyricTrack(v1Tracks)) {
      return mergeNeteaseLyricPayload(v1Tracks);
    }

    return hasAnyLyricTrack(legacyTracks) ? mergeNeteaseLyricPayload(legacyTracks) : "";
  } catch {
    return "";
  }
};
