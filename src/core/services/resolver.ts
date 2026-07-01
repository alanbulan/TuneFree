import { API_PREFIX } from "./config";
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
import type { Song } from "../types";

type SongMeta = Pick<Song, "pic" | "picId" | "urlId" | "lyricId"> &
  Partial<Pick<Song, "name" | "artist" | "album">>;

type ParsedSongFull = { url: string | null; lrc: string; pic: string };

const _lyricsCache = new Map<string, string>();
const _lyricsPending = new Map<string, Promise<string>>();

// 跨音源 fallback（与 Flutter / 移动 PWA 对齐）：
// 原源解析失败时，用「歌名 + 歌手」在其它音源搜索同曲并解析。
const FALLBACK_SEARCH_LIMIT = 6;
const FALLBACK_CANDIDATE_LIMIT = 3;
const FALLBACK_SOURCES = ["netease", "qq", "kuwo", "joox", "bilibili"] as const;
const KUWO_FALLBACK_SOURCES = ["qq", "netease", "joox", "bilibili"] as const;
const NATIVE_LYRIC_SOURCES = new Set(["netease", "qq", "kuwo"]);

const hasPlayableId = (id: string | number | undefined | null): boolean => {
  const normalized = id === null || id === undefined ? "" : String(id).trim();
  return !!normalized && !normalized.startsWith("temp_");
};

const normalizeComparableText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  return String(value)
    .toLowerCase()
    .replace(/[（(].*?[)）]/g, "")
    .replace(/[\s·・.。\-_—–,，、/\\|:：]+/g, "")
    .trim();
};

const isUnknownText = (value: unknown): boolean => {
  const text = String(value || "").trim().toLowerCase();
  return !text || text === "unknown song" || text === "unknown artist";
};

const splitArtistTokens = (artist: unknown): string[] =>
  String(artist || "")
    .split(/[,&，、/\\|]+|\s+(?:and|feat\.?|ft\.?)\s+/i)
    .map(normalizeComparableText)
    .filter((token) => token.length > 1);

const buildFallbackQuery = (songMeta?: SongMeta): string => {
  if (!songMeta || isUnknownText(songMeta.name)) return "";
  const parts = [songMeta.name];
  if (!isUnknownText(songMeta.artist)) parts.push(songMeta.artist);
  return parts.join(" ").trim();
};

const isLikelySameSong = (candidate: Song, songMeta?: SongMeta): boolean => {
  if (!songMeta || isUnknownText(songMeta.name)) return true;

  const targetName = normalizeComparableText(songMeta.name);
  const candidateName = normalizeComparableText(candidate.name);
  if (!targetName || !candidateName) return false;

  const nameMatches =
    candidateName === targetName ||
    candidateName.includes(targetName) ||
    targetName.includes(candidateName);
  if (!nameMatches) return false;

  const targetArtists = splitArtistTokens(songMeta.artist);
  if (targetArtists.length === 0) return true;

  const candidateArtist = normalizeComparableText(candidate.artist);
  if (!candidateArtist) return true;

  return targetArtists.some(
    (artist) => candidateArtist.includes(artist) || artist.includes(candidateArtist),
  );
};

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
    // native resolver unavailable
  }
  return null;
};

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
        lrc = await fetchNeteaseLyrics(id);
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

export const getLyrics = async (
  id: string | number,
  source: string,
  songMeta?: SongMeta,
): Promise<string> => {
  const lyricId = songMeta?.lyricId || id;

  if (isGDStudioOnlySource(source)) {
    return getGDStudioLyrics(lyricId, source);
  }

  if (NATIVE_LYRIC_SOURCES.has(source)) {
    return fetchFallbackLyrics(lyricId, source);
  }

  if (isGDStudioSource(source)) {
    const gdLyrics = await getGDStudioLyrics(lyricId, source);
    if (gdLyrics) return gdLyrics;
  }

  return fetchFallbackLyrics(lyricId, source);
};

const getDirectSongUrl = async (
  id: string | number,
  source: string,
  quality: string = "320k",
): Promise<string | null> => {
  if (!hasPlayableId(id) || !source || source === "undefined") {
    return null;
  }

  if (isGDStudioSource(source)) {
    const gdUrl = await getGDStudioSongUrl(id, source, quality);
    if (gdUrl) return gdUrl;
  }

  if (isGDStudioOnlySource(source)) {
    return null;
  }

  const nativeUrl = await fetchNativeUrl(String(id), source, quality);
  if (nativeUrl) return normalizeMusicUrl(nativeUrl) || null;

  return null;
};

const searchFallbackSource = async (
  keyword: string,
  source: string,
): Promise<Song[]> => {
  if (source === "netease") return searchNetease(keyword, 1, FALLBACK_SEARCH_LIMIT);
  if (source === "qq") return searchQQ(keyword, 1, FALLBACK_SEARCH_LIMIT);
  if (source === "kuwo") return searchKuwo(keyword, 1, FALLBACK_SEARCH_LIMIT);
  if (isGDStudioOnlySource(source)) {
    return searchGDStudio(keyword, source, 1, FALLBACK_SEARCH_LIMIT);
  }
  return [];
};

const resolveDirectSongFull = async (
  id: string | number,
  platform: string,
  quality: string = "320k",
  songMeta?: SongMeta,
): Promise<ParsedSongFull | null> => {
  if (!hasPlayableId(id) || !platform || platform === "undefined") {
    return null;
  }

  if (isGDStudioOnlySource(platform)) {
    return parseGDStudioSongFull(id, platform, quality, songMeta);
  }

  const [url, lrc] = await Promise.all([
    getDirectSongUrl(id, platform, quality),
    getLyrics(id, platform, songMeta),
  ]);
  const pic = songMeta?.pic ? normalizeMusicUrl(songMeta.pic) : "";

  if (!url && !lrc && !pic) return null;

  return { url, lrc, pic };
};

const getFallbackSources = (originalSource: string): readonly string[] => {
  if (originalSource === "kuwo") return KUWO_FALLBACK_SOURCES;
  return FALLBACK_SOURCES.filter((source) => source !== originalSource);
};

const resolveFallbackSongFull = async (
  originalSource: string,
  quality: string,
  songMeta?: SongMeta,
): Promise<ParsedSongFull | null> => {
  const query = buildFallbackQuery(songMeta);
  if (!query) return null;

  const fallbackSources = getFallbackSources(originalSource);

  for (const source of fallbackSources) {
    try {
      const results = await searchFallbackSource(query, source);
      if (!Array.isArray(results)) continue;

      const candidates = results
        .filter(
          (song) =>
            hasPlayableId(song.id) &&
            song.source !== originalSource &&
            isLikelySameSong(song, songMeta),
        )
        .slice(0, FALLBACK_CANDIDATE_LIMIT);

      for (const candidate of candidates) {
        const parsed = await resolveDirectSongFull(
          candidate.id,
          candidate.source,
          quality,
          candidate,
        );

        if (parsed?.url) {
          return {
            url: parsed.url,
            lrc: parsed.lrc,
            pic: parsed.pic || candidate.pic || songMeta?.pic || "",
          };
        }
      }
    } catch (error) {
      console.warn(`[Resolver] fallback source failed (${source}):`, error);
    }
  }

  return null;
};

export const getSongUrl = async (
  id: string | number,
  source: string,
  quality: string = "320k",
  songMeta?: SongMeta,
): Promise<string | null> => {
  // embeat 源：走 autosource 跨源匹配
  if (source === "embeat" && songMeta) {
    try {
      const autosource = await resolveAutosource({
        name: songMeta.name || "",
        artist: songMeta.artist || "",
        album: songMeta.album || "",
        source: "embeat",
      });
      if (autosource?.url) return autosource.url;
    } catch (e) {
      console.warn("[Resolver] resolveAutosource failed in getSongUrl, falling back:", e);
    }
    // autosource 失败走常规 fallback
    const fallback = await resolveFallbackSongFull(source, quality, songMeta);
    return fallback?.url || null;
  }

  const directUrl = await getDirectSongUrl(id, source, quality);
  if (directUrl) return directUrl;

  const fallback = await resolveFallbackSongFull(source, quality, songMeta);
  return fallback?.url || null;
};

export const parseSongFull = async (
  id: string | number,
  platform: string,
  quality: string = "320k",
  songMeta?: SongMeta,
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
      });
      if (autosource?.url) return autosource;
    } catch (e) {
      console.warn("[Resolver] resolveAutosource failed in parseSongFull, falling back:", e);
    }
    // autosource 失败时走常规 fallback
    const fallback = await resolveFallbackSongFull(platform, quality, songMeta);
    if (fallback?.url) return fallback;
    return null;
  }

  const direct = await resolveDirectSongFull(id, platform, quality, songMeta);
  if (direct?.url) return direct;

  const fallback = await resolveFallbackSongFull(platform, quality, songMeta);
  if (fallback?.url) return fallback;

  return direct;
};
