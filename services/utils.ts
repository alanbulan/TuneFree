import type { HTMLAttributeReferrerPolicy } from "react";
import { Song } from "../types";
import { SELF_HOSTED_PROXY } from "./config";

// ==============================
// URL 修复与图片工具
// ==============================

/**
 * 修复/标准化 URL：
 * - 补全协议前缀（// → https:）
 * - 已知支持 HTTPS 的图床强制升级
 * - 酷我 HTTP 图片通过自建代理解决 Mixed Content
 * - QQ 封面尺寸升级（300x300 → 500x500）
 */
export const fixUrl = (url: string | undefined): string => {
  if (!url || typeof url !== "string") return "";
  let fixed = url.trim();

  // 某些公开接口会把查询参数中的 & 返回为 HTML 实体。
  if (fixed.includes("&amp;")) {
    fixed = fixed.replace(/&amp;/g, "&");
  }

  // 补全协议（仅针对明显缺失协议的 // 开头 URL）
  if (fixed.startsWith("//")) {
    fixed = `https:${fixed}`;
  }

  // 强制 HTTPS（仅针对已知支持 HTTPS 的图床）
  if (fixed.startsWith("http://")) {
    if (
      fixed.includes("music.126.net") ||
      fixed.includes("y.gtimg.cn") ||
      fixed.includes("qpic.cn")
    ) {
      fixed = fixed.replace("http://", "https://");
    }
    // 酷我所有子域名均不支持 HTTPS（kwcdn / img1 / img4 等），
    // 通过自建代理绕过 Mixed Content 拦截
    if (fixed.includes("kuwo.cn")) {
      fixed = `${SELF_HOSTED_PROXY}${encodeURIComponent(fixed)}`;
    }
  }

  // QQ 封面尺寸升级：300x300 → 500x500
  if (fixed.includes("300x300")) {
    fixed = fixed.replace("300x300", "500x500");
  }

  return fixed;
};

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
export const findId = (item: any, platform: string): string | undefined => {
  if (!item) return undefined;

  if (platform === "qq") {
    if (item.songmid) return String(item.songmid);
    if (item.mid) return String(item.mid);
    if (item.file?.media_mid) return String(item.file.media_mid);
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
export const findImage = (item: any): string => {
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
    if (item[key] && typeof item[key] === "string") {
      return item[key];
    }
  }

  // QQ 嵌套字段兜底
  if (item.mac_detail?.pic_v12) return item.mac_detail.pic_v12;

  return "";
};

// ==============================
// 原始数据提取
// ==============================

/**
 * 从平台 API 原始响应中提取歌曲原始数组。
 * 主要用于在 executeMethod transform 后，将已丢失的封面字段补回。
 */
export const extractRawTracks = (data: any): any[] => {
  if (!data) return [];
  // 网易云: result.tracks / playlist.tracks / result.songs
  if (data.result?.tracks) return data.result.tracks;
  if (data.playlist?.tracks) return data.playlist.tracks;
  if (data.result?.songs) return data.result.songs;
  // QQ: 多种嵌套路径
  if (data.toplist?.data?.songInfoList) return data.toplist.data.songInfoList;
  if (data.req?.data?.body?.song?.list) return data.req.data.body.song.list;
  if (data.data?.songlist) return data.data.songlist;
  if (data.data?.song?.list) return data.data.song.list;
  // 酷我: musiclist / abslist
  if (data.musiclist) return data.musiclist;
  if (data.abslist) return data.abslist;
  return [];
};

/**
 * 智能列表提取器：从平台 API 的各种响应结构中提取歌曲/榜单数组。
 * 按以下优先级尝试：QQ 分组展平 → 顶层数组 → 常见字段名 → data.xxx 包裹。
 */
export const extractList = (data: any): any[] => {
  if (!data) return [];

  // 展平 QQ 榜单的分组结构（groupList / group → toplist / topList / list）
  const flattenGroup = (groupArr: any[]) =>
    groupArr.flatMap(
      (g: any) => g.toplist || g.topList || g.list || [],
    );

  if (data.data?.groupList) return flattenGroup(data.data.groupList);
  if (data.data?.group) return flattenGroup(data.data.group);
  if (data.groupList) return flattenGroup(data.groupList);
  if (data.group) return flattenGroup(data.group);

  // QQ 嵌套路径兜底（transform 崩溃时 rawData 回落到这里）
  if (data.toplist?.data?.songInfoList) return data.toplist.data.songInfoList;
  if (data.req?.data?.body?.song?.list) return data.req.data.body.song.list;

  // 本身是数组
  if (Array.isArray(data)) {
    const first = data[0];
    if (
      first &&
      (first.toplist || first.topList || first.list || first.groupName)
    ) {
      return flattenGroup(data);
    }
    return data;
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
    if (data[key] && Array.isArray(data[key])) {
      const arr = data[key];
      const first = arr[0];
      if (
        first &&
        (first.toplist || first.topList || first.list || first.groupName)
      ) {
        return flattenGroup(arr);
      }
      return arr;
    }
  }

  // data.xxx 包裹
  if (data.data) {
    if (Array.isArray(data.data)) {
      const arr = data.data;
      const first = arr[0];
      if (
        first &&
        (first.toplist || first.topList || first.list || first.groupName)
      ) {
        return flattenGroup(arr);
      }
      return arr;
    }
    for (const key of priorityKeys) {
      if (data.data[key] && Array.isArray(data.data[key])) {
        return data.data[key];
      }
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
export const normalizeSongs = (list: any[], platform: string): Song[] => {
  if (!Array.isArray(list)) return [];

  return list
    .map((item) => {
      if (!item) return null;

      // 解包 QQ 的 data 包裹
      const actualItem = item.data ? item.data : item;

      const id = findId(actualItem, platform);

      // ---- Artist ----
      let artist: string | undefined = actualItem.artist;
      if (!artist) {
        if (Array.isArray(actualItem.ar))
          artist = actualItem.ar.map((a: any) => a.name).join("/");
        else if (Array.isArray(actualItem.artists))
          artist = actualItem.artists.map((a: any) => a.name).join("/");
        else if (Array.isArray(actualItem.singer))
          artist = actualItem.singer.map((s: any) => s.name).join("/");
        else if (Array.isArray(actualItem.singerList))
          artist = actualItem.singerList.map((s: any) => s.name).join("/");
        else if (actualItem.artist_name) artist = actualItem.artist_name;
      }

      // ---- Album ----
      let album: string | undefined = actualItem.album;
      if (typeof album === "object" && album !== null && (album as any).name) {
        album = (album as any).name;
      } else if (!album && actualItem.album_name) {
        album = actualItem.album_name;
      } else if (!album && actualItem.albumname) {
        album = actualItem.albumname;
      } else if (!album && actualItem.albumName) {
        album = actualItem.albumName;
      }

      // ---- Picture ----
      let pic = findImage(actualItem);
      if (!pic && actualItem.al?.picUrl) pic = actualItem.al.picUrl;
      if (!pic && actualItem.album?.picUrl) pic = actualItem.album.picUrl;
      // QQ 通过 albummid 构造封面
      if (!pic && platform === "qq") {
        const mid =
          actualItem.albummid ||
          actualItem.album?.mid ||
          actualItem.album_mid;
        if (mid) {
          pic = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg`;
        }
      }
      pic = fixUrl(pic);

      // 无法识别 ID 时生成临时 ID（播放时会被 parseSongFull 过滤）
      const finalId =
        id !== undefined ? id : `temp_${Math.random().toString(36).slice(2)}`;

      return {
        ...actualItem,
        source: platform,
        id: finalId,
        name: String(
          actualItem.name ||
            actualItem.title ||
            actualItem.songname ||
            "Unknown Song",
        ),
        artist: String(artist || "Unknown Artist"),
        album: String(album || ""),
        pic: String(pic || ""),
        isValidId: id !== undefined,
      };
    })
    .filter(Boolean) as Song[];
};
