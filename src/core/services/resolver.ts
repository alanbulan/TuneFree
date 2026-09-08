import { BoundedCache } from '../utils/boundedCache';
import { rememberTrackMeta } from './gdStudioModel';
import { API_PREFIX, buildLocalServerHeaders } from "./config";
import { normalizeMusicUrl } from "./utils";
import { fetchNeteaseLyrics, searchNetease } from "./netease";
import { fetchQQLyrics, searchQQ } from "./qq";
import { fetchKuwoLyrics, searchKuwo } from "./kuwo";
import {
  getGDStudioLyrics,
  getGDStudioSongUrl,
  isGDStudioOnlySource,
  isGDStudioSource,
  parseGDStudioSongFull,
  resolveAutosource,
  searchGDStudio,
} from "./gdStudio";
import {
  abortReasonError,
  buildFallbackQuery,
  firstSuccessfulWithConcurrency,
  hasPlayableId,
  isLikelySameSong,
  type SongMeta,
} from "./resolverMatch";
import type { Song } from "../types";

/**
 * 解析链路的公共可选项：
 * - signal 会贯穿到底层每一次 fetch，取消时以 AbortError reject（而非返回 null）；
 * - forceRefresh 跳过歌词 / 播放链接缓存读取。
 */
export interface ResolveOptions {
  signal?: AbortSignal;
  forceRefresh?: boolean;
  /** 播放先取 URL，歌词和封面由补充请求获取。 */
  deferMetadata?: boolean;
}

export type ParsedSongFull = {
  url: string | null;
  lrc: string;
  pic: string;
  resolvedSource: string;
  resolvedId?: string | number;
  resolvedLyricId?: string | number;
  resolvedPicId?: string;
};

const _lyricsCache = new BoundedCache<string, string>(200, 30 * 60_000);
const _lyricsPending = new Map<string, Promise<string>>();

// 跨音源 fallback（与 Flutter / 移动 PWA 对齐）：
// 原源解析失败时，用「歌名 + 歌手」在其它音源搜索同曲并解析。
const FALLBACK_SEARCH_LIMIT = 6;
const FALLBACK_CANDIDATE_LIMIT = 3;
const FALLBACK_SOURCE_CONCURRENCY = 3;
const FALLBACK_TOTAL_TIMEOUT_MS = 15_000;
const NATIVE_URL_TIMEOUT_MS = 8_000;
const FALLBACK_SOURCES = ["netease", "qq", "kuwo", "joox", "bilibili"] as const;
type FallbackSource = typeof FALLBACK_SOURCES[number];
const KUWO_FALLBACK_SOURCES = ["qq", "netease", "joox", "bilibili"] as const;
const NATIVE_LYRIC_SOURCES = new Set(["netease", "qq", "kuwo"]);

const readJsonBody = async (resp: Response): Promise<any> => {
  try {
    return await resp.json();
  } catch {
    return null;
  }
};

export const fetchNativeUrl = async (
  id: string,
  platform: string,
  quality: string,
  signal?: AbortSignal,
): Promise<string | null> => {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), NATIVE_URL_TIMEOUT_MS);
  try {
    const resp = await fetch(
      `${API_PREFIX}/api/url?platform=${encodeURIComponent(platform)}&id=${encodeURIComponent(id)}&quality=${encodeURIComponent(quality)}`,
      { signal: controller.signal, headers: buildLocalServerHeaders() },
    );
    const data = await readJsonBody(resp);
    if (signal?.aborted) throw abortReasonError(signal);
    // 后端 /api/url 失败时会返回结构化 error 字段，必须落日志，
    // 否则代理白名单 403 与"平台不可用"完全不可区分。
    const detail = typeof data?.error === "string" ? `：${data.error}` : "";
    if (resp.ok) {
      if (data?.url) return data.url as string;
      console.warn(`[Resolver] /api/url 未返回可用链接 (${platform}:${id})${detail}`);
    } else {
      console.warn(
        `[Resolver] /api/url 请求失败 (${platform}:${id}) HTTP ${resp.status}${detail}`,
      );
    }
  } catch {
    if (signal?.aborted) throw abortReasonError(signal);
    // native resolver unavailable
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromCaller);
  }
  return null;
};

export const fetchFallbackLyrics = async (
  id: string | number,
  source: string,
  options?: ResolveOptions,
): Promise<string> => {
  const cacheKey = `lrc:${source}:${id}`;
  if (!options?.forceRefresh) {
    const cached = _lyricsCache.get(cacheKey);
    if (cached !== undefined) return cached;

    // 可取消请求不共享 in-flight Promise，避免一次 abort 波及其它调用方。
    const pending = _lyricsPending.get(cacheKey);
    if (pending && !options?.signal) return pending;
  }

  const request = (async () => {
    let lrc = "";

    try {
      if (source === "netease") {
        lrc = await fetchNeteaseLyrics(id, options?.signal);
      } else if (source === "qq") {
        lrc = await fetchQQLyrics(id, options?.signal);
      } else if (source === "kuwo") {
        lrc = await fetchKuwoLyrics(id, options?.signal);
      }

      if (!lrc && isGDStudioSource(source)) {
        lrc = await getGDStudioLyrics(id, source, options);
      }
    } catch (e) {
      if (options?.signal?.aborted) throw abortReasonError(options.signal);
      console.warn(`[Resolver] fetchFallbackLyrics failed (${source}:${id}):`, e);
    } finally {
      if (!options?.signal) _lyricsPending.delete(cacheKey);
    }

    if (lrc) _lyricsCache.set(cacheKey, lrc);
    return lrc;
  })();

  if (!options?.signal) _lyricsPending.set(cacheKey, request);
  return request;
};

export const getLyrics = async (
  id: string | number,
  source: string,
  songMeta?: SongMeta,
  options?: ResolveOptions,
): Promise<string> => {
  const lyricId = songMeta?.lyricId || id;

  if (isGDStudioOnlySource(source)) {
    return getGDStudioLyrics(lyricId, source, options);
  }

  if (NATIVE_LYRIC_SOURCES.has(source)) {
    return fetchFallbackLyrics(lyricId, source, options);
  }

  if (isGDStudioSource(source)) {
    const gdLyrics = await getGDStudioLyrics(lyricId, source, options);
    if (gdLyrics) return gdLyrics;
  }

  return fetchFallbackLyrics(lyricId, source, options);
};

const getDirectSongUrl = async (
  id: string | number,
  source: string,
  quality: string = "320k",
  options?: ResolveOptions,
): Promise<string | null> => {
  if (!hasPlayableId(id) || !source || source === "undefined") {
    return null;
  }

  if (isGDStudioSource(source)) {
    const gdUrl = await getGDStudioSongUrl(id, source, quality, options);
    if (gdUrl) return gdUrl;
  }

  if (isGDStudioOnlySource(source)) {
    return null;
  }

  const nativeUrl = await fetchNativeUrl(String(id), source, quality, options?.signal);
  if (nativeUrl) return normalizeMusicUrl(nativeUrl) || null;

  return null;
};

const searchFallbackSource = async (
  keyword: string,
  source: FallbackSource,
  signal?: AbortSignal,
): Promise<Song[]> => {
  if (source === "netease") return searchNetease(keyword, 1, FALLBACK_SEARCH_LIMIT, signal);
  if (source === "qq") return searchQQ(keyword, 1, FALLBACK_SEARCH_LIMIT, signal);
  if (source === "kuwo") return searchKuwo(keyword, 1, FALLBACK_SEARCH_LIMIT, signal);
  return searchGDStudio(keyword, source, 1, FALLBACK_SEARCH_LIMIT, signal);
};

const resolveDirectSongFull = async (
  id: string | number,
  platform: string,
  quality: string = "320k",
  songMeta?: SongMeta,
  options?: ResolveOptions,
): Promise<ParsedSongFull | null> => {
  if (!hasPlayableId(id) || !platform || platform === "undefined") {
    return null;
  }

  if (isGDStudioOnlySource(platform)) {
    const parsed = await parseGDStudioSongFull(id, platform, quality, songMeta, options);
    return parsed ? {
      ...parsed,
      resolvedSource: platform,
      resolvedId: id,
      resolvedLyricId: songMeta?.lyricId || id,
      resolvedPicId: songMeta?.picId,
    } : null;
  }

  rememberTrackMeta(id, platform, songMeta || {});
  const [url, lrc] = await Promise.all([
    getDirectSongUrl(id, platform, quality, options),
    options?.deferMetadata ? Promise.resolve('') : getLyrics(id, platform, songMeta, options),
  ]);
  const pic = songMeta?.pic ? normalizeMusicUrl(songMeta.pic) : "";

  if (!url && !lrc && !pic) return null;

  return {
    url,
    lrc,
    pic,
    resolvedSource: platform,
    resolvedId: id,
    resolvedLyricId: songMeta?.lyricId || id,
    resolvedPicId: songMeta?.picId,
  };
};

const getFallbackSources = (originalSource: string): readonly FallbackSource[] => {
  if (originalSource === "kuwo") return KUWO_FALLBACK_SOURCES;
  return FALLBACK_SOURCES.filter((source) => source !== originalSource);
};

const resolveFallbackSongFull = async (
  originalSource: string,
  quality: string,
  songMeta?: SongMeta,
  options?: ResolveOptions,
): Promise<ParsedSongFull | null> => {
  const query = buildFallbackQuery(songMeta);
  if (!query) return null;

  const fallbackSources = getFallbackSources(originalSource);

  return firstSuccessfulWithConcurrency(
    fallbackSources,
    FALLBACK_SOURCE_CONCURRENCY,
    FALLBACK_TOTAL_TIMEOUT_MS,
    async (source, signal) => {
      try {
        const results = await searchFallbackSource(query, source, signal);
        if (signal.aborted || !Array.isArray(results)) return null;

        const candidates = results
          .filter(
            (song) =>
              hasPlayableId(song.id) &&
              song.source !== originalSource &&
              isLikelySameSong(song, songMeta),
          )
          .slice(0, FALLBACK_CANDIDATE_LIMIT);

        for (const candidate of candidates) {
          if (signal.aborted) return null;
          const parsed = await resolveDirectSongFull(
            candidate.id,
            candidate.source,
            quality,
            candidate,
            { ...options, signal },
          );

          if (signal.aborted) return null;
          if (parsed?.url) {
            return {
              url: parsed.url,
              lrc: parsed.lrc,
              pic: parsed.pic || candidate.pic || songMeta?.pic || "",
              resolvedSource: parsed.resolvedSource,
              resolvedId: parsed.resolvedId,
              resolvedLyricId: parsed.resolvedLyricId,
              resolvedPicId: parsed.resolvedPicId,
            };
          }
        }
      } catch (error) {
        if (!signal.aborted) {
          console.warn(`[Resolver] fallback source failed (${source}):`, error);
        }
      }
      return null;
    },
    options?.signal,
  );
};

export const getSongUrl = async (
  id: string | number,
  source: string,
  quality: string = "320k",
  songMeta?: SongMeta,
  options?: ResolveOptions,
): Promise<string | null> => {
  rememberTrackMeta(id, source, songMeta || {});
  options = { ...options, deferMetadata: true };
  // embeat 源：走 autosource 跨源匹配
  if (source === "embeat" && songMeta) {
    try {
      const autosource = await resolveAutosource({
        name: songMeta.name || "",
        artist: songMeta.artist || "",
        album: songMeta.album || "",
        source: "embeat",
      }, quality, options?.signal);
      if (autosource?.url) return autosource.url;
    } catch (e) {
      if (options?.signal?.aborted) throw abortReasonError(options.signal);
      console.warn("[Resolver] resolveAutosource failed in getSongUrl, falling back:", e);
    }
    // autosource 失败走常规 fallback
    const fallback = await resolveFallbackSongFull(source, quality, songMeta, options);
    return fallback?.url || null;
  }

  const directUrl = await getDirectSongUrl(id, source, quality, options);
  if (directUrl) return directUrl;

  const fallback = await resolveFallbackSongFull(source, quality, songMeta, options);
  return fallback?.url || null;
};

export const parseSongFull = async (
  id: string | number,
  platform: string,
  quality: string = "320k",
  songMeta?: SongMeta,
  options?: ResolveOptions,
): Promise<ParsedSongFull | null> => {
  if (!platform || platform === "undefined") return null;

  // embeat 源（AI 推荐歌曲）：走 autosource 一站式跨源匹配通道
  if (platform === "embeat" && songMeta) {
    try {
      const autosource = await resolveAutosource({
        name: songMeta.name || "",
        artist: songMeta.artist || "",
        album: songMeta.album || "",
        source: "embeat",
      }, quality, options?.signal);
      if (autosource?.url) {
        return {
          ...autosource,
          resolvedSource: autosource.resolvedSource || platform,
          resolvedId: autosource.resolvedId,
          resolvedLyricId: autosource.resolvedLyricId,
        };
      }
    } catch (e) {
      if (options?.signal?.aborted) throw abortReasonError(options.signal);
      console.warn("[Resolver] resolveAutosource failed in parseSongFull, falling back:", e);
    }
    // autosource 失败时走常规 fallback
    const fallback = await resolveFallbackSongFull(platform, quality, songMeta, options);
    if (fallback?.url) return fallback;
    return null;
  }

  const direct = await resolveDirectSongFull(id, platform, quality, songMeta, options);
  if (direct?.url) return direct;

  const fallback = await resolveFallbackSongFull(platform, quality, songMeta, options);
  if (fallback?.url) return fallback;

  return direct;
};
