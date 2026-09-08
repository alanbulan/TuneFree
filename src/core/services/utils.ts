import type { HTMLAttributeReferrerPolicy } from "react";
import { Song } from "../types";
export { normalizeMusicUrl } from './musicUrl';
import { normalizeMusicUrl } from './musicUrl';

/**
 * 根据图片 URL 来源返回合适的 referrerPolicy：
 * - 网易云 (music.126.net / netease.com) 需要 no-referrer，否则返回 403
 * - 酷我、QQ 等需要携带 referrer（至少 origin），否则触发防盗链拦截
 */
export const getImgReferrerPolicy = (
  url?: string,
): HTMLAttributeReferrerPolicy => {
  if (!url) return "no-referrer";
  if (url.includes("126.net") || url.includes("netease.com"))
    return "no-referrer";
  return "origin";
};

// ==============================
// ID / 图片字段查找
// ==============================

/**
 * 从原始 API 响应对象中深度查找歌曲 ID。
 * - QQ 平台优先使用 songmid（字母数字格式），parse API 需要此字段
 * - 酷我平台优先使用 rid / musicrid
 * - 通用回退到 item.id / item.ID
 */
export const findId = (item: Record<string, unknown> | null, platform: string): string | undefined => {
  if (!item) return undefined;

  if (platform === "qq") {
    if (item.songmid) return String(item.songmid);
    if (item.mid) return String(item.mid);
    const file = item.file;
    if (typeof file === "object" && file !== null && "media_mid" in file) {
      return String((file as Record<string, unknown>).media_mid);
    }
    if (item.topId) return String(item.topId);
    if (item.id) return String(item.id);
    return undefined;
  }

  if (platform === "kuwo") {
    if (item.rid) return String(item.rid);
    if (item.musicrid) return String(item.musicrid);
  }

  if (item.id) return String(item.id);
  if (item.ID) return String(item.ID);

  return undefined;
};

/**
 * 暴力查找对象中的封面图片字段（按优先级顺序）。
 * 兼容网易云、QQ、酷我等平台的不同字段命名习惯。
 */
export const findImage = (item: Record<string, unknown> | null): string => {
  if (!item) return "";

  const keys = [
    "picUrl",
    "coverImgUrl",
    "pic",
    "pic_v12",
    "frontPicUrl",
    "headPicUrl",
    "img",
    "cover",
    "imgUrl",
    "album_pic",
    "albumpic",
  ];

  for (const key of keys) {
    const value = item[key];
    if (value && typeof value === "string") {
      return value;
    }
  }

  // QQ 嵌套字段兜底
  const macDetail = item.mac_detail;
  if (typeof macDetail === "object" && macDetail !== null) {
    const picV12 = (macDetail as Record<string, unknown>).pic_v12;
    if (typeof picV12 === "string") return picV12;
  }

  return "";
};

// ==============================
// 原始数据提取
// ==============================

/**
 * 从平台 API 原始响应中提取歌曲原始数组。
 * 主要用于在 executeMethod transform 后，将已丢失的封面字段补回。
 */
export const extractRawTracks = (data: Record<string, unknown> | null): Record<string, unknown>[] => {
  if (!data) return [];

  const getNested = (parent: Record<string, unknown>, ...keys: string[]): unknown => {
    let current: unknown = parent;
    for (const key of keys) {
      if (typeof current !== "object" || current === null) return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  };

  // 网易云: result.tracks / playlist.tracks / result.songs
  const neteaseTracks = getNested(data, "result", "tracks");
  if (Array.isArray(neteaseTracks)) return neteaseTracks as Record<string, unknown>[];
  const playlistTracks = getNested(data, "playlist", "tracks");
  if (Array.isArray(playlistTracks)) return playlistTracks as Record<string, unknown>[];
  const neteaseSongs = getNested(data, "result", "songs");
  if (Array.isArray(neteaseSongs)) return neteaseSongs as Record<string, unknown>[];
  // QQ: 多种嵌套路径
  const qqSongInfo = getNested(data, "toplist", "data", "songInfoList");
  if (Array.isArray(qqSongInfo)) return qqSongInfo as Record<string, unknown>[];
  const qqSongList = getNested(data, "req", "data", "body", "song", "list");
  if (Array.isArray(qqSongList)) return qqSongList as Record<string, unknown>[];
  const qqDataSonglist = getNested(data, "data", "songlist");
  if (Array.isArray(qqDataSonglist)) return qqDataSonglist as Record<string, unknown>[];
  const qqDataSongList = getNested(data, "data", "song", "list");
  if (Array.isArray(qqDataSongList)) return qqDataSongList as Record<string, unknown>[];
  // 酷我: musiclist / abslist
  if (Array.isArray(data.musiclist)) return data.musiclist as Record<string, unknown>[];
  if (Array.isArray(data.abslist)) return data.abslist as Record<string, unknown>[];
  return [];
};

/**
 * 智能列表提取器：从平台 API 的各种响应结构中提取歌曲/榜单数组。
 * 按以下优先级尝试：QQ 分组展平 → 顶层数组 → 常见字段名 → data.xxx 包裹。
 */
export const extractList = (data: Record<string, unknown> | null): Record<string, unknown>[] => {
  if (!data) return [];

  const getNested = (parent: Record<string, unknown>, ...keys: string[]): unknown => {
    let current: unknown = parent;
    for (const key of keys) {
      if (typeof current !== "object" || current === null) return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  };

  const isGroupItem = (item: unknown): item is Record<string, unknown> =>
    typeof item === "object" && item !== null &&
    ("toplist" in item || "topList" in item || "list" in item || "groupName" in item);

  // 展平 QQ 榜单的分组结构（groupList / group → toplist / topList / list）
  const flattenGroup = (groupArr: Record<string, unknown>[]): Record<string, unknown>[] =>
    groupArr.flatMap((g) => {
      const toplist = g.toplist;
      const topList = g.topList;
      const list = g.list;
      if (Array.isArray(toplist)) return toplist as Record<string, unknown>[];
      if (Array.isArray(topList)) return topList as Record<string, unknown>[];
      if (Array.isArray(list)) return list as Record<string, unknown>[];
      return [];
    });

  const dataGroupList = getNested(data, "data", "groupList");
  if (Array.isArray(dataGroupList)) return flattenGroup(dataGroupList as Record<string, unknown>[]);
  const dataGroup = getNested(data, "data", "group");
  if (Array.isArray(dataGroup)) return flattenGroup(dataGroup as Record<string, unknown>[]);
  if (Array.isArray(data.groupList)) return flattenGroup(data.groupList as Record<string, unknown>[]);
  if (Array.isArray(data.group)) return flattenGroup(data.group as Record<string, unknown>[]);

  // QQ 嵌套路径兜底（transform 崩溃时 rawData 回落到这里）
  const qqSongInfo = getNested(data, "toplist", "data", "songInfoList");
  if (Array.isArray(qqSongInfo)) return qqSongInfo as Record<string, unknown>[];
  const qqSongList = getNested(data, "req", "data", "body", "song", "list");
  if (Array.isArray(qqSongList)) return qqSongList as Record<string, unknown>[];

  // 本身是数组
  if (Array.isArray(data)) {
    const arr = data as unknown[];
    if (arr.length > 0 && isGroupItem(arr[0])) {
      return flattenGroup(arr as Record<string, unknown>[]);
    }
    return arr as Record<string, unknown>[];
  }

  // 常见字段名（按优先级）
  const priorityKeys = [
    "tracks",
    "songs",
    "list",
    "songlist",
    "toplist",
    "topList",
    "data",
    "result",
    "results",
    "hotSongs",
  ];

  for (const key of priorityKeys) {
    const value = data[key];
    if (Array.isArray(value)) {
      const arr = value as unknown[];
      if (arr.length > 0 && isGroupItem(arr[0])) {
        return flattenGroup(arr as Record<string, unknown>[]);
      }
      return arr as Record<string, unknown>[];
    }
  }

  // data.xxx 包裹
  const dataField = data.data;
  // 顶层 data 数组已在上面的 priorityKeys 中处理，这里只解包对象。
  if (typeof dataField === "object" && dataField !== null) {
    const dataRecord = dataField as Record<string, unknown>;
    for (const key of priorityKeys) {
      const value = dataRecord[key];
      if (Array.isArray(value)) return value as Record<string, unknown>[];
    }
  }

  // 单个对象兜底
  if (data.id && data.name) return [data];

  return [];
};

// ==============================
// 歌曲对象标准化
// ==============================

/**
 * 将各平台返回的原始歌曲对象统一标准化为 Song 接口。
 * - 自动推断 ID（平台相关优先级）
 * - 自动展开 ar / artists / singer / singerList 等字段
 * - 自动提取封面（QQ 通过 albummid 构造）
 * - 无法识别 ID 的条目生成临时 temp_ ID（后续播放时会过滤）
 */
export const normalizeSongs = (list: Record<string, unknown>[], platform: string): Song[] => {
  if (!Array.isArray(list)) return [];

  const joinNames = (arr: unknown): string | undefined => {
    if (!Array.isArray(arr)) return undefined;
    return arr
      .map((a) => (typeof a === "object" && a !== null ? (a as Record<string, unknown>).name : ""))
      .filter((n): n is string => typeof n === "string" && !!n)
      .join("/");
  };

  return list
    .map((item) => {
      if (!item) return null;

      // 解包 QQ 的 data 包裹
      const actualItem: Record<string, unknown> =
        typeof item.data === "object" && item.data !== null
          ? (item.data as Record<string, unknown>)
          : item;

      const id = findId(actualItem, platform);

      // ---- Artist ----
      let artist: string | undefined = typeof actualItem.artist === "string" ? actualItem.artist : undefined;
      if (!artist) {
        artist = joinNames(actualItem.ar);
        if (!artist) artist = joinNames(actualItem.artists);
        if (!artist) artist = joinNames(actualItem.singer);
        if (!artist) artist = joinNames(actualItem.singerList);
        if (!artist && typeof actualItem.artist_name === "string") artist = actualItem.artist_name;
      }

      // ---- Album ----
      let album: unknown = actualItem.album;
      if (typeof album === "object" && album !== null && typeof (album as Record<string, unknown>).name === "string") {
        album = (album as Record<string, unknown>).name;
      } else if (!album || typeof album !== "string") {
        if (typeof actualItem.album_name === "string") album = actualItem.album_name;
        else if (typeof actualItem.albumname === "string") album = actualItem.albumname;
        else if (typeof actualItem.albumName === "string") album = actualItem.albumName;
      }

      // ---- Picture ----
      let pic = findImage(actualItem);
      const al = actualItem.al;
      if (!pic && typeof al === "object" && al !== null && typeof (al as Record<string, unknown>).picUrl === "string") {
        pic = (al as Record<string, unknown>).picUrl as string;
      }
      const albumObj = actualItem.album;
      if (!pic && typeof albumObj === "object" && albumObj !== null && typeof (albumObj as Record<string, unknown>).picUrl === "string") {
        pic = (albumObj as Record<string, unknown>).picUrl as string;
      }
      // QQ 通过 albummid 构造封面
      if (!pic && platform === "qq") {
        const albummid = actualItem.albummid;
        const albumMidObj = typeof actualItem.album === "object" && actualItem.album !== null ? actualItem.album as Record<string, unknown> : null;
        const mid = albummid ?? albumMidObj?.mid ?? actualItem.album_mid;
        if (typeof mid === "string" && mid) {
          pic = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg`;
        }
      }
      pic = normalizeMusicUrl(pic);

      // 无法识别 ID 时生成临时 ID（播放时会被 parseSongFull 过滤）
      const finalId =
        id !== undefined ? id : `temp_${Math.random().toString(36).slice(2)}`;

      const name = String(actualItem.name || actualItem.title || actualItem.songname || "Unknown Song");

      return {
        ...actualItem,
        source: platform,
        id: finalId,
        name,
        artist: String(artist || "Unknown Artist"),
        album: String(album || ""),
        pic: String(pic || ""),
        isValidId: id !== undefined,
      };
    })
    .filter(Boolean) as Song[];
};

/** @deprecated Use normalizeMusicUrl instead. Kept for backward compatibility. */
export const fixUrl = normalizeMusicUrl;
