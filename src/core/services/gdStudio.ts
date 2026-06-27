import { Song } from "../types";
import { mergeLyricTracks } from "../utils/lyrics";
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

type GdStudioSource = "netease" | "kuwo" | "joox" | "bilibili" | "qq";

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
  "qq",
];

const GD_STUDIO_ONLY_SOURCES = ["joox", "bilibili"] as const;

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
  // 针对 AI 推荐接口做特化手动拼接，以防止 name 参数中已有的百分号编码被 URLSearchParams 进行二次转义
  if (params.types === "embeat_agent") {
    const { types, count, source, pages, name, s } = params;
    const sourceValue = source === "qq" ? "tencent" : source;
    return `${GD_STUDIO_API_BASE}?types=${types}&count=${count}&source=${sourceValue}&pages=${pages}&name=${name}&s=${s}`;
  }

  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (key === "source" && value === "qq") {
      search.set(key, "tencent");
    } else {
      search.set(key, String(value));
    }
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
    const pic = picId.startsWith("http") || picId.startsWith("//")
      ? fixUrl(picId)
      : source === "joox" && picId
        ? fixUrl(buildJooxCoverUrl(picId, 500))
        : "";

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
    const data = await fetchGDStudioData<{
      lyric?: string;
      lrc?: string;
      tlyric?: string;
      trans?: string;
      translation?: string;
      translations?: string;
      rlyric?: string;
      romalrc?: string;
      roma?: string;
      romanization?: string;
      pronunciation?: string;
      qrc?: string;
      yrc?: string;
      karaoke?: string;
    }>({
      types: "lyric",
      source,
      id: requestId,
    });

    const main = (typeof data?.lyric === "string" ? data.lyric : data?.lrc || "").trim();
    const trans = [data?.tlyric, data?.trans, data?.translation, data?.translations]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim())
      .join("\n");
    const romanization = [data?.rlyric, data?.romalrc, data?.roma, data?.romanization]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0)
      ?.trim() || "";
    const pronunciation = typeof data?.pronunciation === "string" ? data.pronunciation.trim() : "";
    const karaoke = [data?.qrc, data?.yrc, data?.karaoke]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0)
      ?.trim() || "";
    const lrc = mergeLyricTracks({
      main,
      translation: trans,
      romanization,
      pronunciation,
      karaoke,
      source,
    });

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

  if (source === "joox") {
    const pic = fixUrl(buildJooxCoverUrl(picId, size));
    picCache.set(`${source}:${picId}:${size}`, pic);
    return pic;
  }

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

/**
 * 原生高效率 Web Crypto MD5 算法
 */
async function calculateMD5(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  
  const cryptoObj = typeof window !== 'undefined' 
    ? (window.crypto || (window as any).msCrypto)
    : (globalThis.crypto);

  if (cryptoObj?.subtle) {
    const hashBuffer = await cryptoObj.subtle.digest('MD5', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  
  // Node.js 单元测试 fallback
  try {
    const nodeCrypto = require('crypto');
    return nodeCrypto.createHash('md5').update(str).digest('hex');
  } catch {
    throw new Error("[GDStudio] MD5 encryption not available.");
  }
}

/**
 * 对应 ajax.js 中的 urlEncode 实现
 */
function gdUrlEncode(a: string): string {
  return encodeURIComponent(a)
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

let lastTimeDiff = 0;
let timeSynced = false;

/**
 * 同步 GD 音乐台的时间戳以保证签名处于有效期（10秒）内
 */
export async function syncServerTime(): Promise<void> {
  try {
    const start = Date.now();
    const resp = await fetch('https://music.gdstudio.org/time', { method: 'GET' });
    const text = await resp.text();
    const serverTime = Number(text.trim());
    if (!isNaN(serverTime) && serverTime > 0) {
      const end = Date.now();
      const latency = (end - start) / 2;
      lastTimeDiff = serverTime - (start + latency);
      timeSynced = true;
    }
  } catch (err) {
    console.warn("[GDStudio] Failed to sync server time, using local time:", err);
  }
}

/**
 * 调用 Embeat 大模型获取 AI 推荐歌曲 (支持大语言模型搜歌 / 情感电台)
 */
export const getAIRecommendedSongs = async (
  keyword: string,
  source: GdStudioSource = 'netease',
  count: number = 20
): Promise<Song[]> => {
  if (!timeSynced) {
    await syncServerTime();
  }

  const encodedName = gdUrlEncode(keyword);
  // 计算当前服务器的秒级时间戳前 9 位 (对应 crc32 中的 slice(0, 9))
  const currentServerTime = Date.now() + lastTimeDiff;
  const tsPrefix = String(currentServerTime).slice(0, 9);

  // 拼接签名主体：tsPrefix | host | version | query
  const textToHash = `${tsPrefix}|music.gdstudio.org|20260616|${encodedName}`;
  const md5Hex = await calculateMD5(textToHash);
  const calculatedS = md5Hex.slice(-8).toUpperCase();

  const data = await fetchGDStudioData<GdStudioTrack[]>({
    types: "embeat_agent",
    count,
    source,
    pages: 1,
    name: encodedName,
    s: calculatedS
  });

  if (!Array.isArray(data)) return [];

  return data.map((item: GdStudioTrack) => {
    const id = String(item.id || item.url_id || item.lyric_id || "").trim();
    const picId = String(item.pic_id || "").trim();
    const lyricId = String(item.lyric_id || id).trim();
    const urlId = String(item.url_id || id).trim();
    const pic = picId.startsWith("http") || picId.startsWith("//")
      ? fixUrl(picId)
      : source === "joox" && picId
        ? fixUrl(buildJooxCoverUrl(picId, 500))
        : "";

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
