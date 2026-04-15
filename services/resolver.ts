import { API_PREFIX } from "./config";
import { fixUrl, normalizeSongs } from "./utils";
import { parseSongs } from "./tunehub";
import { fetchNeteaselyrics } from "./netease";
import { fetchQQLyrics } from "./qq";
import { fetchKuwoLyrics } from "./kuwo";
import {
  getGDStudioLyrics,
  getGDStudioSongUrl,
  isGDStudioOnlySource,
  isGDStudioSource,
  parseGDStudioSongFull,
} from "./gdStudio";
import type { Song } from "../types";

// ==============================
// 解析缓存
// ==============================

/**
 * 解析结果缓存 — 避免同一首歌在同一会话中重复调用 /v1/parse 浪费积分。
 * Key 格式："{platform}:{id}:{quality}"
 */
const _parseCache = new Map<
  string,
  { data: any[]; timestamp: number; expiresAt: number }
>();
const _parsePending = new Map<string, Promise<any[] | null>>();

/** 默认解析缓存 TTL：5 分钟（URL 有临时签名，过期后需重新解析） */
const DEFAULT_PARSE_CACHE_TTL = 5 * 60 * 1000;
const MIN_PARSE_CACHE_TTL = 30 * 1000;

const getExpireTimestamp = (expire: unknown): number | null => {
  if (typeof expire === "number" && Number.isFinite(expire)) {
    return expire > 1e12 ? expire : expire * 1000;
  }

  if (typeof expire === "string" && expire.trim()) {
    const numeric = Number(expire);
    if (Number.isFinite(numeric) && expire.trim() === String(numeric)) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }

    const parsed = Date.parse(expire);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return null;
};

const getParseCacheExpiry = (item: any): number => {
  const expireAt = getExpireTimestamp(item?.expire);
  if (!expireAt) return Date.now() + DEFAULT_PARSE_CACHE_TTL;

  return Math.max(Date.now() + MIN_PARSE_CACHE_TTL, expireAt - 15 * 1000);
};

/**
 * 歌词缓存 — 避免重复请求备用歌词 API（歌词内容不会变化，长期缓存安全）。
 * Key 格式："lrc:{source}:{id}"
 */
const _lyricsCache = new Map<string, string>();
const _lyricsPending = new Map<string, Promise<string>>();

const getCachedFallbackLyrics = (
  id: string | number,
  source: string,
): string => _lyricsCache.get(`lrc:${source}:${id}`) || "";

const extractParsedLyrics = (item: any): string => {
  if (typeof item?.lyrics === "string" && item.lyrics.trim()) {
    return item.lyrics.trim();
  }
  if (typeof item?.lrc === "string" && item.lrc.trim()) {
    return item.lrc.trim();
  }
  if (typeof item?.lyric === "string" && item.lyric.trim()) {
    return item.lyric.trim();
  }
  return "";
};

const hasMergedTranslationLines = (lrc: string): boolean => {
  if (!lrc) return false;

  const timeToText = new Map<string, string>();
  const lines = lrc.split("\n");

  for (const line of lines) {
    const match = line.match(/^\[(\d{2}:\d{2}\.\d{2,3})\](.*)$/);
    if (!match) continue;

    const time = match[1];
    const text = match[2].trim();
    if (!text) continue;

    const previousText = timeToText.get(time);
    if (previousText && previousText !== text) {
      return true;
    }

    timeToText.set(time, text);
  }

  return false;
};

const shouldPreferFallbackLyrics = (
  platform: string,
  parsedLyrics: string,
): boolean =>
  platform === "qq" && !!parsedLyrics && !hasMergedTranslationLines(parsedLyrics);

const resolveLyricsFromParse = async (
  item: any,
  id: string | number,
  platform: string,
): Promise<string> => {
  const parsedLyrics = extractParsedLyrics(item);

  if (shouldPreferFallbackLyrics(platform, parsedLyrics)) {
    const fallbackLyrics = await fetchFallbackLyrics(id, platform);
    return fallbackLyrics || parsedLyrics;
  }

  if (parsedLyrics) {
    return parsedLyrics;
  }

  return fetchFallbackLyrics(id, platform);
};

const resolvePlaybackLyrics = (
  item: any,
  id: string | number,
  platform: string,
): string => {
  const parsedLyrics = extractParsedLyrics(item);

  if (shouldPreferFallbackLyrics(platform, parsedLyrics)) {
    return getCachedFallbackLyrics(id, platform);
  }

  if (parsedLyrics) {
    return parsedLyrics;
  }

  return getCachedFallbackLyrics(id, platform);
};

const warmLyricsCache = (
  item: any,
  id: string | number,
  platform: string,
): void => {
  const parsedLyrics = extractParsedLyrics(item);
  if (!parsedLyrics || shouldPreferFallbackLyrics(platform, parsedLyrics)) {
    void fetchFallbackLyrics(id, platform);
  }
};

const getParseCacheKey = (
  id: string | number,
  platform: string,
  quality: string,
): string => `${platform}:${id}:${quality}`;

const getValidParseCache = (
  id: string | number,
  platform: string,
  quality: string,
): { data: any[]; timestamp: number; expiresAt: number } | null => {
  const cached = _parseCache.get(getParseCacheKey(id, platform, quality));
  if (!cached) return null;
  if (Date.now() >= cached.expiresAt) return null;
  return cached;
};

const setParseCache = (
  id: string | number,
  platform: string,
  quality: string,
  data: any[],
): void => {
  _parseCache.set(getParseCacheKey(id, platform, quality), {
    data,
    timestamp: Date.now(),
    expiresAt: getParseCacheExpiry(data[0]),
  });
};

const fetchParsedData = async (
  id: string | number,
  platform: string,
  quality: string = "320k",
): Promise<any[] | null> => {
  const cached = getValidParseCache(id, platform, quality);
  if (cached) return cached.data;

  const cacheKey = getParseCacheKey(id, platform, quality);
  const pending = _parsePending.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    const data = await parseSongs(String(id), platform, quality);
    if (data && data.length > 0) {
      setParseCache(id, platform, quality, data);
    }
    _parsePending.delete(cacheKey);
    return data;
  })();

  _parsePending.set(cacheKey, request);
  return request;
};

// ==============================
// 原生 URL 直连（Cloudflare Pages Function）
// ==============================

/**
 * 优先尝试通过本地 CF Pages Function（/api/url）直接获取播放 URL。
 * 跳过 TuneHub 积分计费，延迟更低。
 * 仅在 CF Pages 环境（生产 / 本地开发模拟）下有效，失败时静默返回 null。
 *
 * @param id       歌曲 ID（平台相关格式）
 * @param platform 平台名称（netease / qq / kuwo 等）
 * @param quality  音质（128k / 320k / flac / flac24bit）
 */
export const fetchNativeUrl = async (
  id: string,
  platform: string,
  quality: string,
): Promise<string | null> => {
  try {
    const resp = await fetch(
      `${API_PREFIX}/api/url?platform=${encodeURIComponent(platform)}&id=${encodeURIComponent(id)}&quality=${encodeURIComponent(quality)}`,
    );
    if (resp.ok) {
      const data = await resp.json();
      if (data?.url) return data.url as string;
    }
  } catch {
    // 静默失败，回退到 TuneHub
  }
  return null;
};

// ==============================
// 歌词
// ==============================

/**
 * 平台原生歌词 API 备用获取（TuneHub parse 未返回歌词时调用）。
 * 结果写入 _lyricsCache 避免重复请求。
 *
 * 支持平台：
 * - netease：/api/song/lyric（原文 + 翻译）
 * - qq：musicu.fcg PlayLyricInfo（Base64 解码，原文 + 翻译）
 * - kuwo：openapi/v1/www/lyric/getlyric → songinfoandlrc 降级
 *
 * @param id     歌曲 ID
 * @param source 平台名称
 */
export const fetchFallbackLyrics = async (
  id: string | number,
  source: string,
): Promise<string> => {
  const cacheKey = `lrc:${source}:${id}`;
  const cached = _lyricsCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const pending = _lyricsPending.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    let lrc = "";

    try {
      if (source === "netease") {
        lrc = await fetchNeteaselyrics(id);
      } else if (source === "qq") {
        lrc = await fetchQQLyrics(id);
      } else if (source === "kuwo") {
        lrc = await fetchKuwoLyrics(id);
      }

      if (!lrc && isGDStudioSource(source)) {
        lrc = await getGDStudioLyrics(id, source);
      }
    } catch (e) {
      console.warn(`[Resolver] fetchFallbackLyrics failed (${source}:${id}):`, e);
    }

    _lyricsCache.set(cacheKey, lrc);
    _lyricsPending.delete(cacheKey);
    return lrc;
  })();

  _lyricsPending.set(cacheKey, request);
  return request;
};

/**
 * 获取歌词（公共接口）。
 *
 * 策略：
 * 1. 调用 TuneHub /v1/parse 获取完整信息（parse 通常含歌词字段）
 * 2. parse 未返回歌词时，调用平台原生歌词 API（fetchFallbackLyrics）
 *
 * @param id     歌曲 ID
 * @param source 平台名称
 */
export const getLyrics = async (
  id: string | number,
  source: string,
): Promise<string> => {
  if (isGDStudioOnlySource(source)) {
    return getGDStudioLyrics(id, source);
  }

  if (isGDStudioSource(source)) {
    const gdLyrics = await getGDStudioLyrics(id, source);
    if (gdLyrics) return gdLyrics;
  }

  const data = await fetchParsedData(id, source);
  return resolveLyricsFromParse(data?.[0], id, source);
};

// ==============================
// 播放 URL
// ==============================

/**
 * 获取歌曲播放 URL（公共接口）。
 *
 * 策略：
 * 1. 优先通过本地 CF Pages Function 直连获取（无积分消耗）
 * 2. 失败时回退到 TuneHub /v1/parse
 *
 * @param id      歌曲 ID
 * @param source  平台名称
 * @param quality 音质（默认 320k）
 */
export const getSongUrl = async (
  id: string | number,
  source: string,
  quality: string = "320k",
): Promise<string | null> => {
  if (!source || source === "undefined") return null;

  if (isGDStudioOnlySource(source)) {
    return getGDStudioSongUrl(id, source, quality);
  }

  // 优先：本地原生直连（无积分）
  const nativeUrl = await fetchNativeUrl(String(id), source, quality);
  if (nativeUrl) return fixUrl(nativeUrl) || null;

  if (isGDStudioSource(source)) {
    const gdStudioUrl = await getGDStudioSongUrl(id, source, quality);
    if (gdStudioUrl) return gdStudioUrl;
  }

  // 回退：TuneHub parse / cache
  const data = await fetchParsedData(id, source, quality);
  const url = data?.[0]?.url;
  if (url) return fixUrl(url) || null;

  return null;
};

// ==============================
// 完整解析（URL + 歌词 + 封面）
// ==============================

/**
 * 一次性获取歌曲的播放 URL、歌词和封面（供 playSong 调用）。
 *
 * 策略：
 * 1. 检查解析缓存（5 分钟 TTL），命中时直接返回
 * 2. 优先通过 CF Pages Function 直连获取 URL
 * 3. 失败时调用 TuneHub /v1/parse
 * 4. parse 未返回歌词时，异步调用 fetchFallbackLyrics（不阻塞 URL 返回）
 *
 * 临时 ID（temp_*）直接返回 null，跳过所有网络请求。
 *
 * @param id       歌曲 ID
 * @param platform 平台名称
 * @param quality  音质（默认 320k）
 */
export const parseSongFull = async (
  id: string | number,
  platform: string,
  quality: string = "320k",
  songMeta?: Pick<Song, "pic" | "picId">,
): Promise<{ url: string | null; lrc: string; pic: string } | null> => {
  if (!id || !platform || String(id).startsWith("temp_")) return null;

  if (isGDStudioOnlySource(platform)) {
    return parseGDStudioSongFull(id, platform, quality, songMeta);
  }

  const cached = getValidParseCache(id, platform, quality);

  if (cached) {
    const item = cached.data[0];
    const normalized = normalizeSongs(cached.data, platform)[0];
    const lrc = resolvePlaybackLyrics(item, id, platform);
    warmLyricsCache(item, id, platform);
    return {
      url: fixUrl(item?.url) || null,
      lrc,
      pic: normalized?.pic || "",
    };
  }

  // 尝试直连 URL
  const nativeUrl = await fetchNativeUrl(String(id), platform, quality);

  let data: any[] | null;
  if (nativeUrl) {
    // 直连成功：构造最小化数据集（仍需 normalizeSongs 提取封面等字段）
    data = [{ url: nativeUrl, id: String(id), platform }];
  } else {
    if (isGDStudioSource(platform)) {
      const gdParsed = await parseGDStudioSongFull(id, platform, quality, songMeta);
      if (gdParsed) return gdParsed;
    }

    // 回退：TuneHub parse（获取 URL + 歌词 + 封面）
    data = await fetchParsedData(id, platform, quality);
  }

  if (!data || data.length === 0) {
    if (isGDStudioSource(platform)) {
      return parseGDStudioSongFull(id, platform, quality, songMeta);
    }
    return null;
  }

  const item = data[0];
  const normalized = normalizeSongs(data, platform)[0];
  const lrc = resolvePlaybackLyrics(item, id, platform);
  warmLyricsCache(item, id, platform);

  return {
    url: fixUrl(item?.url) || null,
    lrc,
    pic: normalized?.pic || songMeta?.pic || "",
  };
};
