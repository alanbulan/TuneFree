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

type GdStudioSource = "netease" | "kuwo" | "joox" | "bilibili" | "qq" | "embeat";

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
  "embeat",
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
  let response;

  if (params.types === "embeat_agent") {
    // 1. AI 推荐搜歌：只支持 POST 请求，且强制校验时间戳 md5 签名 s
    const nameValue = params.name ? String(params.name) : "tunefree";
    const encodedName = params.name ? String(params.name) : gdUrlEncode(nameValue);

    if (!timeSynced) {
      await syncServerTime();
    }
    const currentServerTime = Date.now() + lastTimeDiff;
    const tsPrefix = String(currentServerTime).slice(0, 9);
    
    const textToHash = `${tsPrefix}|music.gdstudio.org|20260616|${encodedName}`;
    const md5Hex = await calculateMD5(textToHash);
    const calculatedS = params.s ? String(params.s) : md5Hex.slice(-8).toUpperCase();

    const bodyParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "source" && value === "qq") {
        bodyParams.set(key, "tencent");
      } else if (key !== "name" && key !== "s") {
        bodyParams.set(key, String(value));
      }
    }
    bodyParams.set("name", encodedName);
    bodyParams.set("s", calculatedS);

    console.log(`[GDStudio] POST Requesting types=embeat_agent with body:`, bodyParams.toString());

    try {
      response = await proxyFetch(GD_STUDIO_API_BASE, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        body: bodyParams.toString()
      } as any, 12000);
    } catch (err) {
      console.error("[GDStudio] proxyFetch POST network error:", err);
      throw new Error("GD_STUDIO_UNAVAILABLE");
    }
  } else {
    // 2. 通用接口（types=url/lyric/pic/playlist/autosource等）：GET 请求，使用与网站一致的 md5 时间戳签名
    if (!timeSynced) {
      await syncServerTime();
    }
    const currentServerTime = Date.now() + lastTimeDiff;
    const tsPrefix = String(currentServerTime).slice(0, 9);

    // 签名主体：优先用 name 参数（autosource/search），其次用 urlEncode(id)
    let signSubject = "";
    if (params.name !== undefined) {
      signSubject = String(params.name);
    } else if (params.id !== undefined) {
      signSubject = gdUrlEncode(String(params.id));
    } else {
      signSubject = gdUrlEncode(String(params.types || ""));
    }

    const textToHash = `${tsPrefix}|music.gdstudio.org|20260616|${signSubject}`;
    const md5Hex = await calculateMD5(textToHash);
    const calculatedS = md5Hex.slice(-8).toUpperCase();

    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "source" && value === "qq") {
        search.set(key, "tencent");
      } else if (key !== "s") {
        search.set(key, String(value));
      }
    }
    search.set("s", calculatedS);

    const url = `${GD_STUDIO_API_BASE}?${search.toString()}`;
    console.log("[GDStudio] GET Requesting URL:", url);

    try {
      response = await proxyFetch(url, {}, 12000);
    } catch (err) {
      console.error("[GDStudio] proxyFetch GET network error:", err);
      throw new Error("GD_STUDIO_UNAVAILABLE");
    }
  }

  if (!response) {
    console.error(`[GDStudio] proxyFetch returned null for types=${params.types}`);
    throw new Error("GD_STUDIO_UNAVAILABLE");
  }

  const text = decodeResponseText(await response.arrayBuffer());
  console.log(`[GDStudio] Response status:`, response.status, `Body preview:`, text.slice(0, 500));
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

  const cacheKey = `${source}:${picId}:${size}`;
  if (picCache.has(cacheKey)) {
    return picCache.get(cacheKey) || "";
  }

  // 1. 若已经是完整网址，直接返回
  const directPic = fixUrl(picId);
  if (directPic && (picId.startsWith("http") || picId.startsWith("//"))) {
    picCache.set(cacheKey, directPic);
    return directPic;
  }

  // 2. 网易云：使用官方原生详情 API 配合代理安全获取，彻底绕过 .xyz/.org 的 types=pic 不稳定代理
  if (source === "netease") {
    try {
      const url = `https://music.163.com/api/song/detail/?id=${picId}&ids=[${picId}]`;
      const response = await proxyFetch(url, {}, 8000);
      if (response) {
        const text = decodeResponseText(await response.arrayBuffer());
        const data = tryParseJson(text);
        const picUrl = data?.songs?.[0]?.album?.picUrl;
        if (picUrl) {
          const pic = fixUrl(picUrl);
          picCache.set(cacheKey, pic);
          return pic;
        }
      }
    } catch (err) {
      console.warn("[GDStudio] Failed to fetch native netease cover:", err);
    }
  }

  // 3. QQ音乐：官方 CDN 高清直接拼接，免去任何网络请求
  if (source === "qq") {
    const pic = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${picId}.jpg`;
    picCache.set(cacheKey, pic);
    return pic;
  }

  // 4. Joox 音乐：直接用原厂模板
  if (source === "joox") {
    const pic = fixUrl(buildJooxCoverUrl(picId, size));
    picCache.set(cacheKey, pic);
    return pic;
  }

  // 5. 其余平台兜底
  try {
    const data = await fetchGDStudioData<{ url?: string }>({
      types: "pic",
      source,
      id: picId,
      size,
    });

    const pic = fixUrl(typeof data?.url === "string" ? data.url : "");
    if (pic) {
      picCache.set(cacheKey, pic);
      return pic;
    }
  } catch {
    // skip
  }

  return "";
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
 * 调用 GD Studio 的 autosource 接口：一步到位获取 embeat 源歌曲的播放URL、歌词、封面。
 * 传入 name | artist | album 拼接串，服务器自动跨源匹配返回真实可播放的音源数据。
 */
export const resolveAutosource = async (
  song: Pick<Song, "name" | "artist" | "album" | "source">,
): Promise<{ url: string | null; lrc: string; pic: string; resolvedSource?: string } | null> => {
  const nameParts = [song.name || ""];
  if (song.artist) nameParts.push(song.artist);
  if (song.album) nameParts.push(song.album);
  const nameStr = gdUrlEncode(nameParts.join(" | "));

  try {
    const data = await fetchGDStudioData<{
      url?: string;
      br?: number;
      size?: number;
      pic?: string;
      lyric?: string;
      tlyric?: string;
      source?: string;
      id?: string | number;
    }>({
      types: "autosource",
      source: song.source || "embeat",
      name: nameStr,
    });

    const url = fixUrl(typeof data?.url === "string" ? data.url : "");
    const pic = fixUrl(typeof data?.pic === "string" ? data.pic : "");
    let lrc = typeof data?.lyric === "string" ? data.lyric : "";
    if (data?.tlyric) {
      lrc = mergeLyricTracks({ main: lrc, translation: data.tlyric });
    }

    if (!url) return null;

    return {
      url,
      lrc,
      pic,
      resolvedSource: data?.source || undefined,
    };
  } catch (err) {
    console.warn("[GDStudio] resolveAutosource failed:", err);
    return null;
  }
};

/**
 * 纯 JavaScript 经典 MD5 算法实现 (完美规避部分浏览器 WebView 对 Web Crypto MD5 的不支持限制)
 */
async function calculateMD5(str: string): Promise<string> {
  let k: number[] = [], i = 0;
  for (; i < 64; ) {
    k[i] = Math.sin(++i) * 4294967296 | 0;
  }
  
  let s = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  
  let utf8 = unescape(encodeURIComponent(str));
  let l = utf8.length, blocks = [(l + 8 >> 6) + 1 << 4], j = 0;
  for (; j < l; j++) {
    blocks[j >> 2] |= utf8.charCodeAt(j) << (j % 4 << 3);
  }
  blocks[j >> 2] |= 0x80 << (j % 4 << 3);
  
  // 确保 blocks 数组最后一个位置被填充
  const lastIndex = (blocks.length > 2) ? blocks.length - 2 : 0;
  blocks[lastIndex] = l * 8;
  
  for (j = 0; j < blocks.length; j += 16) {
    let olda = a, oldb = b, oldc = c, oldd = d;
    for (i = 0; i < 64; i++) {
      let f = 0, g = 0;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      let temp = d;
      d = c;
      c = b;
      b = (b + rol(a + f + k[i] + (blocks[j + g] || 0), s[(i >> 4 << 2) + i % 4])) | 0;
      a = temp;
    }
    a = (a + olda) | 0;
    b = (b + oldb) | 0;
    c = (c + oldc) | 0;
    d = (d + oldd) | 0;
  }
  
  return wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);

  function rol(num: number, cnt: number): number {
    return (num << cnt) | (num >>> (32 - cnt));
  }
  
  function wordToHex(num: number): string {
    let hex = '', tmp = 0;
    for (; tmp < 4; tmp++) {
      hex += ((num >> (tmp << 3)) & 0xff).toString(16).padStart(2, '0');
    }
    return hex;
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
      lastTimeDiff = (serverTime * 1000) - (start + latency);
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
      : "";

    if (id) {
      rememberTrackMeta(id, "embeat", {
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
      source: "embeat" as const,
    };
  });
};
