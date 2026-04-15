/**
 * services/api.ts — 公共 API 入口
 *
 * 本文件作为薄入口层（thin entry point），职责：
 *  1. 从各子模块重新导出所有公共符号，保证外部调用路径不变（均从 "../services/api" 导入）
 *  2. 实现跨平台的聚合函数（searchSongs、searchAggregate、getTopLists、getTopListDetail）
 *  3. 实现需要 TuneHub executeMethod 的高级功能（getPlaylistDetail）
 *  4. 提供下载辅助函数（triggerDownload）
 *
 * 子模块分工：
 *  config.ts   — 常量与环境检测
 *  proxy.ts    — 代理管理与基础请求工具
 *  utils.ts    — URL 修复、数据标准化、字段提取
 *  tunehub.ts  — TuneHub 后端调用（executeMethod、parseSongs、getSongInfo）
 *  netease.ts  — 网易云音乐直连实现
 *  qq.ts       — QQ 音乐直连实现
 *  kuwo.ts     — 酷我音乐直连实现
 *  gdStudio.ts — GD Studio 统一音源适配（JOOX / Bilibili 等）
 *  resolver.ts — 播放 URL / 歌词 / 封面完整解析（带缓存）
 */

// ==============================
// 基础常量 & 配置
// ==============================
export { DEFAULT_API_BASE } from "./config";
export { getStoredApiBase } from "./proxy";

// ==============================
// 工具函数
// ==============================
export {
  fixUrl,
  getImgReferrerPolicy,
  normalizeSongs,
  extractList,
} from "./utils";

// ==============================
// TuneHub 核心接口
// ==============================
export { executeMethod, parseSongs, getSongInfo } from "./tunehub";

// ==============================
// 解析器（URL / 歌词 / 全量解析）
// ==============================
export {
  fetchNativeUrl,
  getSongUrl,
  getLyrics,
  fetchFallbackLyrics,
  parseSongFull,
} from "./resolver";

// ==============================
// 平台子模块（按需直接使用）
// ==============================
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

// ==============================
// 依赖导入（供聚合函数使用）
// ==============================
import { Song, TopList } from "../types";
import {
  searchNetease,
  getNeteaseTopLists,
  getNeteaseTopListDetail,
} from "./netease";
import { searchQQ, getQQTopLists, getQQTopListDetail } from "./qq";
import { searchKuwo, getKuwoTopLists, getKuwoTopListDetail } from "./kuwo";
import { searchGDStudio } from "./gdStudio";
import { executeMethod } from "./tunehub";
import { extractList, normalizeSongs } from "./utils";

// ==============================
// 聚合搜索
// ==============================

/**
 * 单平台搜索入口。
 * 根据 platform 参数路由到对应平台的搜索实现。
 * 目前支持：netease、qq、kuwo，以及通过 GD Studio 接入的 joox、bilibili。
 *
 * @param keyword  搜索关键词
 * @param platform 目标平台
 * @param page     页码（从 1 开始，默认 1）
 */
export const searchSongs = async (
  keyword: string,
  platform: string,
  page: number = 1,
): Promise<Song[]> => {
  const limit = 30;

  if (platform === "netease") return searchNetease(keyword, page, limit);
  if (platform === "qq") return searchQQ(keyword, page, limit);
  if (platform === "kuwo") return searchKuwo(keyword, page, limit);
  if (platform === "joox" || platform === "bilibili") {
    return searchGDStudio(keyword, platform, page, limit);
  }

  return [];
};

/**
 * 多平台聚合搜索。
 * 并行请求多个平台，结果按"轮询交叉"方式合并，
 * 保证结果多样性（netease[0], qq[0], kuwo[0], netease[1], ...）。
 * 单平台失败不影响其他平台结果。
 * 默认只聚合 netease / qq / kuwo；启用 includeExtendedSources 后，
 * 会额外纳入 joox / bilibili。
 *
 * @param keyword 搜索关键词
 * @param page    页码（从 1 开始，默认 1）
 */
export const searchAggregate = async (
  keyword: string,
  page: number = 1,
  options: { includeExtendedSources?: boolean } = {},
): Promise<Song[]> => {
  const platforms = options.includeExtendedSources
    ? (["netease", "qq", "kuwo", "joox", "bilibili"] as const)
    : (["netease", "qq", "kuwo"] as const);

  const results = await Promise.all(
    platforms.map((p) =>
      searchSongs(keyword, p, page).catch(() => [] as Song[]),
    ),
  );

  // 轮询交叉合并：保证来自不同平台的歌曲交替出现
  const merged: Song[] = [];
  const maxLen = Math.max(...results.map((r) => r.length));
  for (let i = 0; i < maxLen; i++) {
    for (const platformResult of results) {
      if (platformResult[i]) merged.push(platformResult[i]);
    }
  }

  return merged;
};

// ==============================
// 排行榜
// ==============================

/**
 * 获取指定平台的排行榜列表。
 * 支持：netease、qq、kuwo。
 * 未知平台返回空数组。
 *
 * @param platform 平台名称
 */
export const getTopLists = async (platform: string): Promise<TopList[]> => {
  if (platform === "netease") return getNeteaseTopLists();
  if (platform === "qq") return getQQTopLists();
  if (platform === "kuwo") return getKuwoTopLists();
  return [];
};

/**
 * 获取指定排行榜的歌曲列表。
 * 支持：netease、qq、kuwo。
 * 未知平台返回空数组。
 *
 * @param id       榜单 ID
 * @param platform 平台名称
 */
export const getTopListDetail = async (
  id: string | number,
  platform: string,
): Promise<Song[]> => {
  if (platform === "netease") return getNeteaseTopListDetail(id);
  if (platform === "qq") return getQQTopListDetail(id);
  if (platform === "kuwo") return getKuwoTopListDetail(id);
  return [];
};

// ==============================
// 歌单详情（TuneHub executeMethod）
// ==============================

/**
 * 获取歌单详情（名称 + 歌曲列表）。
 * 通过 TuneHub /v1/methods/{platform}/playlist 获取方法配置并执行，
 * 结果经 extractList + normalizeSongs 标准化。
 *
 * @param id       歌单 ID
 * @param platform 平台名称
 */
export const getPlaylistDetail = async (
  id: string,
  platform: string,
): Promise<{ name: string; songs: Song[] } | null> => {
  const data: any = await executeMethod(platform, "playlist", { id });
  if (!data) return null;

  const name: string = String(
    data.name ||
      data.info?.name ||
      data.playlist?.name ||
      data.data?.name ||
      data.result?.name ||
      "未知歌单",
  );

  return {
    name,
    songs: normalizeSongs(extractList(data), platform),
  };
};

// ==============================
// 下载辅助
// ==============================

/**
 * 触发浏览器文件下载。
 * 通过创建隐藏 <a> 元素实现，兼容大多数现代浏览器。
 * 注意：在 Capacitor 原生环境中此方法可能不生效，需额外处理。
 *
 * @param url      下载地址
 * @param filename 保存文件名
 */
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
