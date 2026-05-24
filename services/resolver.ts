import { API_PREFIX } from "./config";
import { fixUrl } from "./utils";
import { fetchNeteaselyrics, searchNetease } from "./netease";
import { fetchQQLyrics, searchQQ } from "./qq";
import { fetchKuwoLyrics, searchKuwo } from "./kuwo";
import {
  getGDStudioLyrics,
  getGDStudioSongUrl,
  parseGDStudioSongFull,
  searchGDStudio,
} from "./gdStudio";
import {
  SEARCHABLE_MUSIC_SOURCES,
  isGDStudioOnlySource,
  normalizeMusicSource,
} from "../utils/musicSource";
import type { Song } from "../types";

type SongMeta = Pick<Song, "pic" | "picId" | "urlId" | "lyricId"> &
  Partial<Pick<Song, "name" | "artist" | "album">>;

type ParsedSongFull = { url: string | null; lrc: string; pic: string };

const _lyricsCache = new Map<string, string>();
const _lyricsPending = new Map<string, Promise<string>>();
const FALLBACK_SEARCH_LIMIT = 6;
const FALLBACK_CANDIDATE_LIMIT = 3;
const KUWO_FALLBACK_SOURCES = ["qq", "netease", "joox", "bilibili"] as const;

const normalizeCacheId = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const hasPlayableId = (id: string | number): boolean => {
  const normalized = normalizeCacheId(id);
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

  if (candidateName === targetName) return true;

  const nameMatches =
    candidateName.includes(targetName) || targetName.includes(candidateName);
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
    return null;
  }
  return null;
};

export const fetchFallbackLyrics = async (
  id: string | number,
  source: string,
  songMeta?: SongMeta,
): Promise<string> => {
  const normalizedSource = normalizeMusicSource(source);
  const lyricCacheId = normalizeCacheId(songMeta?.lyricId) || normalizeCacheId(id);
  const cacheKey = `lrc:${normalizedSource}:${lyricCacheId}`;
  const cached = _lyricsCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const pending = _lyricsPending.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    let lrc = "";

    try {
      if (isGDStudioOnlySource(normalizedSource)) {
        lrc = await getGDStudioLyrics(id, normalizedSource, songMeta);
      } else if (normalizedSource === "netease") {
        lrc = await fetchNeteaselyrics(id);
      } else if (normalizedSource === "qq") {
        lrc = await fetchQQLyrics(id);
      } else if (normalizedSource === "kuwo") {
        lrc = await fetchKuwoLyrics(id);
      }

    } catch (e) {
      console.warn(`[Resolver] fetchFallbackLyrics failed (${normalizedSource}:${id}):`, e);
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
  const normalizedSource = normalizeMusicSource(source);
  if (!id || !normalizedSource || normalizedSource === "undefined") return "";
  return fetchFallbackLyrics(id, normalizedSource, songMeta);
};

const getDirectSongUrl = async (
  id: string | number,
  source: string,
  quality: string = "320k",
  songMeta?: SongMeta,
): Promise<string | null> => {
  const normalizedSource = normalizeMusicSource(source);
  if (!hasPlayableId(id) || !normalizedSource || normalizedSource === "undefined") {
    return null;
  }

  if (isGDStudioOnlySource(normalizedSource)) {
    return getGDStudioSongUrl(id, normalizedSource, quality, songMeta);
  }

  const nativeUrl = await fetchNativeUrl(String(id), normalizedSource, quality);
  if (nativeUrl) return fixUrl(nativeUrl) || null;

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
  const normalizedPlatform = normalizeMusicSource(platform);
  if (!hasPlayableId(id) || !normalizedPlatform || normalizedPlatform === "undefined") {
    return null;
  }

  if (isGDStudioOnlySource(normalizedPlatform)) {
    return parseGDStudioSongFull(id, normalizedPlatform, quality, songMeta);
  }

  const [url, lrc] = await Promise.all([
    getDirectSongUrl(id, normalizedPlatform, quality, songMeta),
    getLyrics(id, normalizedPlatform, songMeta),
  ]);
  const pic = songMeta?.pic ? fixUrl(songMeta.pic) : "";

  if (!url && !lrc && !pic) return null;

  return { url, lrc, pic };
};

const getFallbackSources = (originalSource: string): readonly string[] => {
  const normalizedOriginalSource = normalizeMusicSource(originalSource);
  if (normalizedOriginalSource === "kuwo") return KUWO_FALLBACK_SOURCES;

  return SEARCHABLE_MUSIC_SOURCES.filter(
    (source) => normalizeMusicSource(source) !== normalizedOriginalSource,
  );
};

const resolveFallbackSongFull = async (
  originalSource: string,
  quality: string,
  songMeta?: SongMeta,
): Promise<ParsedSongFull | null> => {
  const query = buildFallbackQuery(songMeta);
  if (!query) return null;

  const normalizedOriginalSource = normalizeMusicSource(originalSource);
  const fallbackSources = getFallbackSources(normalizedOriginalSource);

  for (const source of fallbackSources) {
    try {
      const results = await searchFallbackSource(query, source);
      const candidates = results
        .filter((song) =>
          hasPlayableId(song.id) &&
          normalizeMusicSource(song.source) !== normalizedOriginalSource &&
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
  const normalizedSource = normalizeMusicSource(source);
  const directUrl = await getDirectSongUrl(id, normalizedSource, quality, songMeta);
  if (directUrl) return directUrl;

  const fallback = await resolveFallbackSongFull(normalizedSource, quality, songMeta);
  return fallback?.url || null;
};

export const parseSongFull = async (
  id: string | number,
  platform: string,
  quality: string = "320k",
  songMeta?: SongMeta,
): Promise<ParsedSongFull | null> => {
  const normalizedPlatform = normalizeMusicSource(platform);
  if (!normalizedPlatform || normalizedPlatform === "undefined") return null;

  const direct = await resolveDirectSongFull(id, normalizedPlatform, quality, songMeta);
  if (direct?.url) return direct;

  const fallback = await resolveFallbackSongFull(normalizedPlatform, quality, songMeta);
  if (fallback?.url) return fallback;

  return direct;
};
