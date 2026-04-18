import { Song } from "../types";
import { GD_STUDIO_API_BASE } from "./config";
import { proxyFetch } from "./proxy";
import { fixUrl } from "./utils";

type GdStudioTrack = {
  id?: string | number;
  name?: string;
  artist?: string[] | string;
  album?: string;
  pic_id?: string;
  url_id?: string;
  lyric_id?: string;
  source?: string;
};

type GdStudioSource = "netease" | "kuwo" | "joox" | "bilibili";

type CachedTrackMeta = {
  pic?: string;
  picId?: string;
  lyricId?: string;
  urlId?: string;
};

const GD_STUDIO_SOURCES: readonly GdStudioSource[] = [
  "netease",
  "kuwo",
  "joox",
  "bilibili",
];

const GD_STUDIO_ONLY_SOURCES = ["joox", "bilibili"] as const;

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

const getTrackKey = (id: string | number, source: string): string =>
  `${source}:${String(id)}`;

const getUrlCacheKey = (
  id: string | number,
  source: string,
  quality: string,
): string => `${source}:${String(id)}:${quality}`;

const buildApiUrl = (params: Record<string, string | number>): string => {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    search.set(key, String(value));
  }

  return `${GD_STUDIO_API_BASE}?${search.toString()}`;
};

const joinArtists = (artist: string[] | string | undefined): string => {
  if (Array.isArray(artist)) return artist.join(", ");
  return typeof artist === "string" ? artist : "";
};

const normalizeBitrate = (quality: string): string => {
  if (quality === "128k") return "128";
  if (quality === "320k") return "320";
  if (quality === "flac") return "740";
  if (quality === "flac24bit") return "999";
  return "320";
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

const resolveTrackMeta = (
  id: string | number,
  source: string,
): CachedTrackMeta => trackMetaCache.get(getTrackKey(id, source)) || {};

export const isGDStudioSource = (source: string): source is GdStudioSource =>
  GD_STUDIO_SOURCES.includes(source as GdStudioSource);

export const isGDStudioOnlySource = (
  source: string,
): source is (typeof GD_STUDIO_ONLY_SOURCES)[number] =>
  GD_STUDIO_ONLY_SOURCES.includes(
    source as (typeof GD_STUDIO_ONLY_SOURCES)[number],
  );

export const searchGDStudio = async (
  keyword: string,
  source: GdStudioSource,
  page: number,
  limit: number,
): Promise<Song[]> => {
  const data = await fetchGDStudioData<GdStudioTrack[]>({
    types: "search",
    source,
    name: keyword,
    count: limit,
    pages: page,
  });

  if (!Array.isArray(data)) return [];

  return data.map((item: GdStudioTrack) => {
    const id = String(item.id || item.url_id || item.lyric_id || "").trim();
    const picId = String(item.pic_id || "").trim();
    const lyricId = String(item.lyric_id || id).trim();
    const urlId = String(item.url_id || id).trim();
    const pic = picId.startsWith("http") || picId.startsWith("//") ? fixUrl(picId) : "";

    if (id) {
      rememberTrackMeta(id, source, {
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
      source,
    };
  });
};

export const getGDStudioSongUrl = async (
  id: string | number,
  source: GdStudioSource,
  quality: string = "320k",
): Promise<string | null> => {
  const cacheKey = getUrlCacheKey(id, source, quality);
  const cached = urlCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const trackMeta = resolveTrackMeta(id, source);
  const requestId = trackMeta.urlId || String(id);

  try {
    const data = await fetchGDStudioData<{ url?: string }>({
      types: "url",
      source,
      id: requestId,
      br: normalizeBitrate(quality),
    });

    const url = fixUrl(typeof data?.url === "string" ? data.url : "");
    if (!url) return null;

    urlCache.set(cacheKey, {
      url,
      expiresAt: Date.now() + URL_CACHE_TTL,
    });

    return url;
  } catch {
    return null;
  }
};

export const getGDStudioLyrics = async (
  id: string | number,
  source: GdStudioSource,
): Promise<string> => {
  const trackMeta = resolveTrackMeta(id, source);
  const requestId = trackMeta.lyricId || String(id);
  const cacheKey = getTrackKey(requestId, source);

  if (lyricCache.has(cacheKey)) {
    return lyricCache.get(cacheKey) || "";
  }

  try {
    const data = await fetchGDStudioData<{ lyric?: string; tlyric?: string }>({
      types: "lyric",
      source,
      id: requestId,
    });

    const main = typeof data?.lyric === "string" ? data.lyric.trim() : "";
    const trans = typeof data?.tlyric === "string" ? data.tlyric.trim() : "";
    const lrc = main && trans ? `${main}\n${trans}` : main;

    lyricCache.set(cacheKey, lrc);
    rememberTrackMeta(id, source, { lyricId: requestId });
    return lrc;
  } catch {
    lyricCache.set(cacheKey, "");
    return "";
  }
};

export const getGDStudioPic = async (
  source: GdStudioSource,
  picId: string,
  size: 300 | 500 = 500,
): Promise<string> => {
  if (!picId) return "";

  const directPic = fixUrl(picId);
  if (directPic && (picId.startsWith("http") || picId.startsWith("//"))) {
    picCache.set(`${source}:${picId}`, directPic);
    return directPic;
  }

  const cacheKey = `${source}:${picId}:${size}`;
  if (picCache.has(cacheKey)) {
    return picCache.get(cacheKey) || "";
  }

  try {
    const data = await fetchGDStudioData<{ url?: string }>({
      types: "pic",
      source,
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
  source: GdStudioSource,
  songMeta?: Pick<Song, "pic" | "picId">,
): Promise<string> => {
  if (songMeta?.pic) return fixUrl(songMeta.pic);

  const trackMeta = resolveTrackMeta(id, source);
  const picId = songMeta?.picId || trackMeta.picId || "";

  if (!picId) return "";

  const pic = await getGDStudioPic(source, picId, 500);
  if (pic) {
    rememberTrackMeta(id, source, { pic, picId });
  }

  return pic;
};

export const parseGDStudioSongFull = async (
  id: string | number,
  source: GdStudioSource,
  quality: string = "320k",
  songMeta?: Pick<Song, "pic" | "picId">,
): Promise<{ url: string | null; lrc: string; pic: string } | null> => {
  const [url, lrc, pic] = await Promise.all([
    getGDStudioSongUrl(id, source, quality),
    getGDStudioLyrics(id, source),
    resolveGDStudioPic(id, source, songMeta),
  ]);

  if (!url && !lrc && !pic) return null;

  return {
    url,
    lrc,
    pic,
  };
};
