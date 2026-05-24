import { Song } from "../types";
import {
  isGDStudioOnlySource,
  isGDStudioSource,
  normalizeMusicSource,
  toGDStudioApiSource,
} from "../utils/musicSource";
import { GD_STUDIO_API_BASE } from "./config";
import { proxyFetch } from "./proxy";
import { fixUrl } from "./utils";

export { isGDStudioOnlySource, isGDStudioSource } from "../utils/musicSource";

type GdStudioArtist = string | { name?: string } | null | undefined;

type GdStudioTrack = {
  id?: string | number;
  name?: string;
  artist?: GdStudioArtist[] | string;
  album?: string;
  pic_id?: string | number;
  url_id?: string | number;
  lyric_id?: string | number;
  source?: string;
};

type CachedTrackMeta = {
  pic?: string;
  picId?: string;
  lyricId?: string;
  urlId?: string;
};

type SongMeta = Pick<Song, "pic" | "picId" | "urlId" | "lyricId">;

const buildJooxCoverUrl = (picId: string, size: 300 | 500 = 500): string =>
  `https://image.joox.com/JOOXcover/0/${picId}/${size}`;

const trackMetaCache = new Map<string, CachedTrackMeta>();
const lyricCache = new Map<string, string>();
const picCache = new Map<string, string>();
const urlCache = new Map<string, { url: string; expiresAt: number }>();

const URL_CACHE_TTL = 5 * 60 * 1000;

const countDecodeArtifacts = (text: string): number =>
  (text.match(/�/g) || []).length;

const decodeResponseText = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const utf8 = new TextDecoder("utf-8").decode(bytes);

  try {
    const gb18030 = new TextDecoder("gb18030").decode(bytes);
    return countDecodeArtifacts(gb18030) < countDecodeArtifacts(utf8)
      ? gb18030
      : utf8;
  } catch {
    return utf8;
  }
};

const tryParseJson = (text: string): any | null => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const looksLikeRateLimitResponse = (status: number, text: string): boolean => {
  if (status === 429) return true;
  if (status === 403 && /__cf_chl_|Just a moment|cf-browser-verification/i.test(text)) {
    return true;
  }
  return /频率|rate limit|too many requests/i.test(text);
};

const getGDStudioErrorText = (data: unknown, fallback: string): string => {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
  }
  return fallback;
};

const looksLikeUnsupportedSourceResponse = (
  status: number,
  text: string,
  data: unknown,
): boolean => {
  if (status !== 400) return false;
  return /source.*not supported/i.test(getGDStudioErrorText(data, text));
};

const fetchGDStudioData = async <T = any>(
  params: Record<string, string | number>,
): Promise<T> => {
  const response = await proxyFetch(buildApiUrl(params), {}, 12000);
  if (!response) {
    throw new Error("GD_STUDIO_UNAVAILABLE");
  }

  const text = decodeResponseText(await response.arrayBuffer());
  const data = tryParseJson(text);

  if (!response.ok) {
    if (looksLikeRateLimitResponse(response.status, text)) {
      throw new Error("GD_STUDIO_RATE_LIMIT");
    }
    if (looksLikeUnsupportedSourceResponse(response.status, text, data)) {
      throw new Error("GD_STUDIO_UNSUPPORTED_SOURCE");
    }
    throw new Error("GD_STUDIO_UNAVAILABLE");
  }

  if (!data) {
    if (looksLikeRateLimitResponse(response.status, text)) {
      throw new Error("GD_STUDIO_RATE_LIMIT");
    }
    throw new Error("GD_STUDIO_BAD_RESPONSE");
  }

  if (typeof data?.error === "string") {
    if (looksLikeRateLimitResponse(response.status, data.error)) {
      throw new Error("GD_STUDIO_RATE_LIMIT");
    }
    throw new Error("GD_STUDIO_UNAVAILABLE");
  }

  return data as T;
};

const normalizeId = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const pickFirstId = (...values: unknown[]): string =>
  values.map(normalizeId).find((value) => value.length > 0) || "";

const getTrackKey = (id: string | number, source: string): string =>
  `${normalizeMusicSource(source)}:${String(id)}`;

const getUrlCacheKey = (
  id: string | number,
  source: string,
  quality: string,
): string => `${normalizeMusicSource(source)}:${String(id)}:${quality}`;

const buildApiUrl = (params: Record<string, string | number>): string => {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    search.set(key, String(value));
  }

  return `${GD_STUDIO_API_BASE}?${search.toString()}`;
};

const joinArtists = (artist: GdStudioArtist[] | string | undefined): string => {
  if (Array.isArray(artist)) {
    return artist
      .map((item) => (typeof item === "string" ? item : item?.name || ""))
      .filter(Boolean)
      .join(", ");
  }
  return typeof artist === "string" ? artist : "";
};

const normalizeBitrate = (quality: string): string => {
  if (quality === "128k") return "128";
  if (quality === "192k") return "192";
  if (quality === "320k") return "320";
  if (quality === "flac") return "740";
  if (quality === "flac24bit") return "999";
  return "320";
};

const extractTracks = (data: any): GdStudioTrack[] => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.songs)) return data.songs;
  return [];
};

const rememberTrackMeta = (
  id: string | number,
  source: string,
  meta: CachedTrackMeta,
): void => {
  const cacheKey = getTrackKey(id, source);
  const previous = trackMetaCache.get(cacheKey) || {};
  trackMetaCache.set(cacheKey, { ...previous, ...meta });
};

const seedTrackMeta = (
  id: string | number,
  source: string,
  songMeta?: SongMeta,
): void => {
  if (!normalizeId(id) || !songMeta) return;

  const meta: CachedTrackMeta = {};
  const pic = fixUrl(songMeta.pic || "");
  const picId = normalizeId(songMeta.picId);
  const lyricId = normalizeId(songMeta.lyricId);
  const urlId = normalizeId(songMeta.urlId);

  if (pic) meta.pic = pic;
  if (picId) meta.picId = picId;
  if (lyricId) meta.lyricId = lyricId;
  if (urlId) meta.urlId = urlId;

  if (Object.keys(meta).length > 0) {
    rememberTrackMeta(id, source, meta);
  }
};

const resolveTrackMeta = (
  id: string | number,
  source: string,
): CachedTrackMeta => trackMetaCache.get(getTrackKey(id, source)) || {};

const resolveSearchResultPic = (source: string, picId: string): string => {
  if (!picId) return "";
  if (picId.startsWith("http") || picId.startsWith("//")) return fixUrl(picId);
  if (source === "joox") return fixUrl(buildJooxCoverUrl(picId, 500));
  return "";
};

export const searchGDStudio = async (
  keyword: string,
  source: string,
  page: number,
  limit: number,
): Promise<Song[]> => {
  const normalizedSource = normalizeMusicSource(source);
  if (!isGDStudioSource(normalizedSource)) return [];

  let data: unknown;
  try {
    data = await fetchGDStudioData<unknown>({
      types: "search",
      source: toGDStudioApiSource(normalizedSource),
      name: keyword,
      count: limit,
      pages: page,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "GD_STUDIO_UNSUPPORTED_SOURCE") {
      return [];
    }
    throw error;
  }

  return extractTracks(data).map((item: GdStudioTrack) => {
    const itemSource = normalizeMusicSource(normalizeId(item.source) || normalizedSource);
    const songSource = isGDStudioSource(itemSource) ? itemSource : normalizedSource;
    const id = pickFirstId(item.id, item.url_id, item.lyric_id);
    const picId = normalizeId(item.pic_id);
    const lyricId = normalizeId(item.lyric_id) || id;
    const urlId = normalizeId(item.url_id) || id;
    const pic = resolveSearchResultPic(songSource, picId);

    if (id) {
      rememberTrackMeta(id, songSource, {
        pic,
        picId,
        lyricId,
        urlId,
      });
    }

    return {
      id: id || `temp_${Math.random().toString(36).slice(2)}`,
      name: String(item.name || ""),
      artist: joinArtists(item.artist),
      album: String(item.album || ""),
      pic,
      picId,
      lyricId,
      urlId,
      source: songSource,
    };
  });
};

export const getGDStudioSongUrl = async (
  id: string | number,
  source: string,
  quality: string = "320k",
  songMeta?: SongMeta,
): Promise<string | null> => {
  const normalizedSource = normalizeMusicSource(source);
  if (!isGDStudioSource(normalizedSource)) return null;

  seedTrackMeta(id, normalizedSource, songMeta);
  const trackMeta = resolveTrackMeta(id, normalizedSource);
  const requestId = trackMeta.urlId || normalizeId(id);
  if (!requestId) return null;

  const cacheKey = getUrlCacheKey(requestId, normalizedSource, quality);
  const cached = urlCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  try {
    const data = await fetchGDStudioData<{ url?: string }>({
      types: "url",
      source: toGDStudioApiSource(normalizedSource),
      id: requestId,
      br: normalizeBitrate(quality),
    });

    const url = fixUrl(typeof data?.url === "string" ? data.url : "");
    if (!url) return null;

    urlCache.set(cacheKey, {
      url,
      expiresAt: Date.now() + URL_CACHE_TTL,
    });
    rememberTrackMeta(id, normalizedSource, { urlId: requestId });

    return url;
  } catch {
    return null;
  }
};

export const getGDStudioLyrics = async (
  id: string | number,
  source: string,
  songMeta?: SongMeta,
): Promise<string> => {
  const normalizedSource = normalizeMusicSource(source);
  if (!isGDStudioSource(normalizedSource)) return "";

  seedTrackMeta(id, normalizedSource, songMeta);
  const trackMeta = resolveTrackMeta(id, normalizedSource);
  const requestId = trackMeta.lyricId || normalizeId(id);
  if (!requestId) return "";

  const cacheKey = getTrackKey(requestId, normalizedSource);

  if (lyricCache.has(cacheKey)) {
    return lyricCache.get(cacheKey) || "";
  }

  try {
    const data = await fetchGDStudioData<{ lyric?: string; tlyric?: string }>({
      types: "lyric",
      source: toGDStudioApiSource(normalizedSource),
      id: requestId,
    });

    const main = typeof data?.lyric === "string" ? data.lyric.trim() : "";
    const trans = typeof data?.tlyric === "string" ? data.tlyric.trim() : "";
    const lrc = main && trans ? `${main}\n${trans}` : main;

    lyricCache.set(cacheKey, lrc);
    rememberTrackMeta(id, normalizedSource, { lyricId: requestId });
    return lrc;
  } catch {
    lyricCache.set(cacheKey, "");
    return "";
  }
};

export const getGDStudioPic = async (
  source: string,
  picId: string,
  size: 300 | 500 = 500,
): Promise<string> => {
  const normalizedSource = normalizeMusicSource(source);
  if (!picId || !isGDStudioSource(normalizedSource)) return "";

  if (normalizedSource === "joox") {
    const pic = fixUrl(buildJooxCoverUrl(picId, size));
    picCache.set(`${normalizedSource}:${picId}:${size}`, pic);
    return pic;
  }

  const directPic = fixUrl(picId);
  if (directPic && (picId.startsWith("http") || picId.startsWith("//"))) {
    picCache.set(`${normalizedSource}:${picId}`, directPic);
    return directPic;
  }

  const cacheKey = `${normalizedSource}:${picId}:${size}`;
  if (picCache.has(cacheKey)) {
    return picCache.get(cacheKey) || "";
  }

  try {
    const data = await fetchGDStudioData<{ url?: string }>({
      types: "pic",
      source: toGDStudioApiSource(normalizedSource),
      id: picId,
      size,
    });

    const pic = fixUrl(typeof data?.url === "string" ? data.url : "");
    if (!pic) return "";

    picCache.set(cacheKey, pic);
    return pic;
  } catch {
    return "";
  }
};

export const resolveGDStudioPic = async (
  id: string | number,
  source: string,
  songMeta?: SongMeta,
): Promise<string> => {
  const normalizedSource = normalizeMusicSource(source);
  if (!isGDStudioSource(normalizedSource)) return "";

  seedTrackMeta(id, normalizedSource, songMeta);
  const trackMeta = resolveTrackMeta(id, normalizedSource);
  const storedPic = fixUrl(trackMeta.pic || songMeta?.pic || "");
  if (storedPic) return storedPic;

  const picId = normalizeId(songMeta?.picId) || trackMeta.picId || "";
  if (!picId) return "";

  const pic = await getGDStudioPic(normalizedSource, picId, 500);
  if (pic) {
    rememberTrackMeta(id, normalizedSource, { pic, picId });
  }

  return pic;
};

export const parseGDStudioSongFull = async (
  id: string | number,
  source: string,
  quality: string = "320k",
  songMeta?: SongMeta,
): Promise<{ url: string | null; lrc: string; pic: string } | null> => {
  const normalizedSource = normalizeMusicSource(source);
  if (!isGDStudioSource(normalizedSource)) return null;

  seedTrackMeta(id, normalizedSource, songMeta);
  const [url, lrc, pic] = await Promise.all([
    getGDStudioSongUrl(id, normalizedSource, quality, songMeta),
    getGDStudioLyrics(id, normalizedSource, songMeta),
    resolveGDStudioPic(id, normalizedSource, songMeta),
  ]);

  if (!url && !lrc && !pic) return null;

  return {
    url,
    lrc,
    pic,
  };
};
