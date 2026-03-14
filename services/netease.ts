import { Song, TopList } from "../types";
import { proxyFetchJson } from "./proxy";
import { fixUrl } from "./utils";

// ==============================
// 网易云音乐 直连接口
// 通过 CORS 代理直接调用网易云 API，不依赖 TuneHub 后端
// ==============================

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

  return songs.map((s: any) => ({
    id: String(s.id),
    name: s.name || "",
    artist: s.ar?.map((a: any) => a.name).join(", ") || "",
    album: s.al?.name || "",
    pic: fixUrl(s.al?.picUrl || ""),
    source: "netease" as const,
  }));
};

/**
 * 网易云榜单列表：/api/toplist/detail
 * 返回所有可用排行榜的基本信息（ID、名称、封面）。
 */
export const getNeteaseTopLists = async (): Promise<TopList[]> => {
  const data = await proxyFetchJson(
    "https://music.163.com/api/toplist/detail",
  );
  const list = data?.list;

  if (!list || !Array.isArray(list)) return [];

  return list.map((item: any) => ({
    id: String(item.id),
    name: item.name || "",
    updateFrequency: item.updateFrequency || "",
    picUrl: fixUrl(item.coverImgUrl || ""),
    coverImgUrl: fixUrl(item.coverImgUrl || ""),
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
  const data = await proxyFetchJson(url);
  const tracks = data?.playlist?.tracks;

  if (!tracks || !Array.isArray(tracks)) return [];

  return tracks.map((s: any) => ({
    id: String(s.id),
    name: s.name || "",
    artist: s.ar?.map((a: any) => a.name).join(", ") || "",
    album: s.al?.name || "",
    pic: fixUrl(s.al?.picUrl || ""),
    source: "netease" as const,
  }));
};

/**
 * 网易云歌词：/api/song/lyric
 * 同时获取原文歌词（lrc）和翻译歌词（tlyric），拼接后返回。
 * 无翻译时只返回原文。
 * @param id 歌曲 ID
 */
export const fetchNeteaselyrics = async (
  id: string | number,
): Promise<string> => {
  try {
    const data = await proxyFetchJson(
      `http://music.163.com/api/song/lyric?id=${id}&lv=1&tv=1`,
    );
    const main: string = data?.lrc?.lyric || "";
    const trans: string = data?.tlyric?.lyric || "";
    return main && trans ? `${main}\n${trans}` : main;
  } catch {
    return "";
  }
};
