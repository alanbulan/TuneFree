import { normalizeMusicUrl } from "./utils";
import { resolveAutosource } from "./gdStudioExtras";
import {
  abortReasonError,
  buildFallbackQuery,
  firstSuccessfulWithConcurrency,
  hasPlayableId,
  isLikelySameSong,
  type SongMeta,
} from "./resolverMatch";
import {
  fallbackPlatformsFor,
  getNameMatchCandidates,
  resolveDirectUrl,
  resolveFull,
  resolveLyrics,
  resolvePic,
  searchSongs as searchPlatformSongs,
} from "./sources/registry";
import { toSourceResolveRequest, type SourceResolveRequest } from "./sources/types";

/**
 * 解析链路的编排层。
 *
 * 这里**不再判断任何具体平台**：谁是某个平台的解析器、歌词从哪来、兜底去搜哪些平台，
 * 全部由 `sources/registry.ts` 依据各 provider 的声明派生。
 */

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
  /** 跨源匹配结果的元数据，供延后获取歌词和封面时使用。 */
  resolvedSongMeta?: SongMeta;
};

// 跨音源 fallback（与 Flutter / 移动 PWA 对齐）：
// 原源解析失败时，用「歌名 + 歌手」在其它音源搜索同曲并解析。
const FALLBACK_SEARCH_LIMIT = 6;
const FALLBACK_CANDIDATE_LIMIT = 3;
const FALLBACK_SOURCE_CONCURRENCY = 3;
const FALLBACK_TOTAL_TIMEOUT_MS = 15_000;
const NAME_MATCH_TOTAL_TIMEOUT_MS = 8_000;

// 内置平台的解析与歌词已抽到 sources/ 下，这里保留原导出名以便调用方无感。
export { fetchNativeUrl } from "./sources/nativeUrl";
export { fetchNativeLyrics, fetchNativeLyrics as fetchFallbackLyrics } from "./sources/nativeLyrics";

/** 统一的解析请求构造：歌曲元数据供 provider 使用（按歌名匹配、脚本内部缓存、GD 专属平台）。 */
const toSourceRequest = (
  id: string | number,
  source: string,
  quality: string,
  songMeta?: SongMeta,
  options?: ResolveOptions,
): SourceResolveRequest => toSourceResolveRequest({ ...songMeta, id, source }, quality, options);

/** 歌词：由注册表按 provider 声明的优先级接力（自定义源 → 原生 → GD）。 */
export const getLyrics = async (
  id: string | number,
  source: string,
  songMeta?: SongMeta,
  options?: ResolveOptions,
): Promise<string> => {
  return resolveLyrics(toSourceRequest(id, source, "320k", songMeta, options));
};

const getDirectSongUrl = async (
  id: string | number,
  source: string,
  quality: string = "320k",
  songMeta?: SongMeta,
  options?: ResolveOptions,
): Promise<string | null> => {
  if (!hasPlayableId(id) || !source || source === "undefined") {
    return null;
  }
  return resolveDirectUrl(toSourceRequest(id, source, quality, songMeta, options));
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

  const request = toSourceRequest(id, platform, quality, songMeta, options);
  // 专属平台（如 GD 的 joox / bilibili）由 provider 一次性拿 url + 歌词 + 封面。
  const full = await resolveFull(request);
  if (full) {
    return {
      ...full,
      resolvedSource: platform,
      resolvedId: id,
      resolvedLyricId: songMeta?.lyricId || id,
      resolvedPicId: songMeta?.picId,
    };
  }

  const [url, lrc] = await Promise.all([
    getDirectSongUrl(id, platform, quality, songMeta, options),
    options?.deferMetadata ? Promise.resolve('') : getLyrics(id, platform, songMeta, options),
  ]);
  const declaredPic = songMeta?.pic ? normalizeMusicUrl(songMeta.pic) : "";
  // 自定义音源常在 pic action 里给封面；只有缺封面时才多花一次请求。
  const pic = declaredPic || (options?.deferMetadata ? '' : await resolvePic(request));

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

/**
 * 兜底末段：按歌名 + 歌手尝试开启了「按歌名匹配」的自定义音源。
 *
 * 这类调用只能拿到 URL、无法像
 * 搜索结果那样校验候选，存在匹配到翻唱的风险，因此每个音源默认关闭。
 */
const resolveNameMatchFallback = async (
  originalSource: string,
  originalId: string | number,
  quality: string,
  songMeta?: SongMeta,
  options?: ResolveOptions,
): Promise<ParsedSongFull | null> => {
  const candidates = getNameMatchCandidates();
  if (candidates.length === 0 || !songMeta?.name) return null;

  return firstSuccessfulWithConcurrency(
    candidates,
    2,
    NAME_MATCH_TOTAL_TIMEOUT_MS,
    async (candidate, signal) => {
      try {
        const url = await candidate.provider.getUrl?.({
          platform: candidate.platform,
          id: "",
          quality,
          name: songMeta.name,
          artist: songMeta.artist,
          album: songMeta.album,
          signal,
        });
        if (!url) return null;
        // 保持原平台与原 id 的元数据绑定，避免播放器把曲目认成另一首歌。
        return {
          url: normalizeMusicUrl(url) || url,
          lrc: "",
          pic: songMeta.pic ? normalizeMusicUrl(songMeta.pic) : "",
          resolvedSource: originalSource,
          resolvedId: originalId,
          resolvedLyricId: songMeta.lyricId || originalId,
          resolvedPicId: songMeta.picId,
        };
      } catch (error) {
        if (!signal.aborted) {
          console.warn("[Resolver] 按歌名匹配自定义音源失败：", error);
        }
        return null;
      }
    },
    options?.signal,
  );
};

const resolveFallbackSongFull = async (
  originalSource: string,
  originalId: string | number,
  quality: string,
  songMeta?: SongMeta,
  options?: ResolveOptions,
): Promise<ParsedSongFull | null> => {
  const query = buildFallbackQuery(songMeta);
  if (!query) return null;

  // 候选平台由注册表按 provider 声明派生（含「仅在存在自定义音源时参与」的 kg / mg）。
  const fallbackSources = fallbackPlatformsFor(originalSource);
  if (fallbackSources.length === 0) {
    return resolveNameMatchFallback(originalSource, originalId, quality, songMeta, options);
  }

  const matched = await firstSuccessfulWithConcurrency(
    fallbackSources,
    FALLBACK_SOURCE_CONCURRENCY,
    FALLBACK_TOTAL_TIMEOUT_MS,
    async (source, signal) => {
      try {
        const results = await searchPlatformSongs(query, source, 1, FALLBACK_SEARCH_LIMIT, signal);
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
              resolvedSongMeta: candidate,
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

  if (matched) return matched;
  return resolveNameMatchFallback(originalSource, originalId, quality, songMeta, options);
};

export const getSongUrl = async (
  id: string | number,
  source: string,
  quality: string = "320k",
  songMeta?: SongMeta,
  options?: ResolveOptions,
): Promise<string | null> => {
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
    const fallback = await resolveFallbackSongFull(source, id, quality, songMeta, options);
    return fallback?.url || null;
  }

  const directUrl = await getDirectSongUrl(id, source, quality, songMeta, options);
  if (directUrl) return directUrl;

  const fallback = await resolveFallbackSongFull(source, id, quality, songMeta, options);
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
    const fallback = await resolveFallbackSongFull(platform, id, quality, songMeta, options);
    if (fallback?.url) return fallback;
    return null;
  }

  const direct = await resolveDirectSongFull(id, platform, quality, songMeta, options);
  if (direct?.url) return direct;

  const fallback = await resolveFallbackSongFull(platform, id, quality, songMeta, options);
  if (fallback?.url) return fallback;

  return direct;
};
