import type { Song } from '../types';
import { mergeLyricTracks } from '../utils/lyrics';
import {
  decodeResponseText,
  fetchGDStudioData,
  GDStudioApiError,
  tryParseJson,
} from './gdStudioClient';
import {
  enrichAIRecommendationCovers,
  loadAIRecommendationTracks,
  mapAIRecommendationTracks,
} from './gdStudioAi';
import {
  buildJooxCoverUrl,
  GD_STUDIO_ONLY_SOURCES,
  GD_STUDIO_SOURCES,
  getTrackKey,
  getUrlCacheKey,
  joinArtists,
  lyricCache,
  normalizeGDStudioSource,
  normalizeBitrate,
  picCache,
  rememberTrackMeta,
  resolveTrackMeta,
  URL_CACHE_TTL,
  urlCache,
  type GdStudioSource,
  type GdStudioTrack,
} from './gdStudioModel';
import { proxyFetch, throwIfAborted } from './proxy';
import { fixUrl } from './utils';

export { syncServerTime } from './gdStudioClient';

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
  signal?: AbortSignal,
): Promise<Song[]> => {
  const data = await fetchGDStudioData<GdStudioTrack[]>({
    types: "search",
    source,
    name: keyword,
    count: limit,
    pages: page,
  }, signal);

  if (!Array.isArray(data)) {
    throw new GDStudioApiError('BAD_RESPONSE', 200, 'search response must be an array');
  }
  const songs: Song[] = [];
  const seen = new Set<string>();
  for (const value of data) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new GDStudioApiError('BAD_RESPONSE', 200, 'search track must be an object');
    }
    const item = value as GdStudioTrack;
    const artistValid = typeof item.artist === 'string'
      || (Array.isArray(item.artist) && item.artist.every((artist) => typeof artist === 'string'));
    const responseSource = normalizeGDStudioSource(item.source);
    if (
      !artistValid
      || typeof item.name !== 'string'
      || typeof item.album !== 'string'
      || typeof item.pic_id !== 'string'
      || !['string', 'number'].includes(typeof item.id)
      || !['string', 'number'].includes(typeof item.url_id)
      || !['string', 'number'].includes(typeof item.lyric_id)
      || !responseSource
    ) {
      throw new GDStudioApiError('BAD_RESPONSE', 200, 'search track fields are invalid');
    }
    if (responseSource !== source) {
      throw new GDStudioApiError(
        'BAD_RESPONSE',
        200,
        `source mismatch: requested ${source}, received ${responseSource}`,
      );
    }
    const id = String(item.id).trim();
    const name = item.name.trim();
    const picId = item.pic_id.trim();
    const lyricId = String(item.lyric_id).trim();
    const urlId = String(item.url_id).trim();
    if (!id || !name || !lyricId || !urlId) {
      throw new GDStudioApiError('BAD_RESPONSE', 200, 'search track identity fields are empty');
    }
    const key = getTrackKey(id, responseSource);
    if (seen.has(key)) continue;
    seen.add(key);
    const pic = picId.startsWith("http") || picId.startsWith("//")
      ? fixUrl(picId)
      : source === "joox" && picId
        ? fixUrl(buildJooxCoverUrl(picId, 500))
        : "";
    rememberTrackMeta(id, responseSource, { pic, picId, lyricId, urlId });
    songs.push({
      id,
      name,
      artist: joinArtists(item.artist),
      album: item.album,
      pic,
      picId,
      lyricId,
      urlId,
      source: responseSource,
    });
  }
  return songs;
};

export const getGDStudioSongUrl = async (
  id: string | number,
  source: GdStudioSource,
  quality: string = "320k",
  options?: { signal?: AbortSignal; forceRefresh?: boolean },
): Promise<string | null> => {
  const cacheKey = getUrlCacheKey(id, source, quality);
  const cached = options?.forceRefresh ? undefined : urlCache.get(cacheKey);

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
    }, options?.signal);

    const url = fixUrl(typeof data?.url === "string" ? data.url : "");
    if (!url) return null;

    urlCache.set(cacheKey, {
      url,
      expiresAt: Date.now() + URL_CACHE_TTL,
    });

    return url;
  } catch {
    throwIfAborted(options?.signal);
    return null;
  }
};

export const getGDStudioLyrics = async (
  id: string | number,
  source: GdStudioSource,
  options?: { signal?: AbortSignal; forceRefresh?: boolean },
): Promise<string> => {
  const trackMeta = resolveTrackMeta(id, source);
  const requestId = trackMeta.lyricId || String(id);
  const cacheKey = getTrackKey(requestId, source);

  if (!options?.forceRefresh && lyricCache.has(cacheKey)) {
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
      krc?: string;
      klyric?: string;
      mrc?: string;
      karaoke?: string;
    }>({
      types: "lyric",
      source,
      id: requestId,
    }, options?.signal);

    const main = (typeof data?.lyric === "string" ? data.lyric : data?.lrc || "").trim();
    const trans = [data?.tlyric, data?.trans, data?.translation, data?.translations]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim())
      .join("\n");
    const romanization = [data?.rlyric, data?.romalrc, data?.roma, data?.romanization]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0)
      ?.trim() || "";
    const pronunciation = typeof data?.pronunciation === "string" ? data.pronunciation.trim() : "";
    const karaoke = [data?.qrc, data?.yrc, data?.krc, data?.klyric, data?.mrc, data?.karaoke]
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

    if (lrc) lyricCache.set(cacheKey, lrc);
    rememberTrackMeta(id, source, { lyricId: requestId });
    return lrc;
  } catch {
    throwIfAborted(options?.signal);
    return "";
  }
};

export const getGDStudioPic = async (
  source: GdStudioSource,
  picId: string,
  size: 300 | 500 = 500,
  songId?: string | number,
  signal?: AbortSignal,
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

  // 2. 网易云：使用官方原生详情 API 配合代理安全获取，透传正确的歌曲 ID
  if (source === "netease") {
    try {
      const targetId = songId || picId;
      const url = `https://music.163.com/api/song/detail/?id=${targetId}&ids=[${targetId}]`;
      const response = await proxyFetch(url, { signal }, 8000);
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
      throwIfAborted(signal);
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
    }, signal);

    const pic = fixUrl(typeof data?.url === "string" ? data.url : "");
    if (pic) {
      picCache.set(cacheKey, pic);
      return pic;
    }
  } catch {
    throwIfAborted(signal);
    // skip
  }

  return "";
};

export const resolveGDStudioPic = async (
  id: string | number,
  source: GdStudioSource,
  songMeta?: Pick<Song, "pic" | "picId">,
  signal?: AbortSignal,
): Promise<string> => {
  if (songMeta?.pic) return fixUrl(songMeta.pic);

  const trackMeta = resolveTrackMeta(id, source);
  const picId = songMeta?.picId || trackMeta.picId || "";

  if (!picId) return "";

  const pic = await getGDStudioPic(source, picId, 500, id, signal);
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
  options?: { signal?: AbortSignal; forceRefresh?: boolean },
): Promise<{ url: string | null; lrc: string; pic: string } | null> => {
  const [url, lrc, pic] = await Promise.all([
    getGDStudioSongUrl(id, source, quality, options),
    getGDStudioLyrics(id, source, options),
    resolveGDStudioPic(id, source, songMeta, options?.signal),
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
  quality: string = "320k",
  signal?: AbortSignal,
): Promise<{
  url: string;
  lrc: string;
  pic: string;
  resolvedSource?: string;
  resolvedId?: string | number;
  resolvedLyricId?: string | number;
}> => {
  const nameParts = [song.name || ""];
  if (song.artist) nameParts.push(song.artist);
  if (song.album) nameParts.push(song.album);
  const nameStr = nameParts.join(" | ");

  const data = await fetchGDStudioData<{
    url?: string;
    br?: number;
    size?: number;
    pic?: string;
    lyric?: string;
    tlyric?: string;
    trans?: string;
    translation?: string;
    qrc?: string;
    yrc?: string;
    krc?: string;
    klyric?: string;
    mrc?: string;
    karaoke?: string;
    source?: string;
    id?: string | number;
  }>({
    types: "autosource",
    source: song.source || "embeat",
    name: nameStr,
    br: normalizeBitrate(quality),
  }, signal);

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new GDStudioApiError('BAD_RESPONSE', 200, 'autosource response must be an object');
  }

  const url = fixUrl(typeof data?.url === "string" ? data.url : "");
  const pic = fixUrl(typeof data?.pic === "string" ? data.pic : "");
  const main = typeof data?.lyric === "string" ? data.lyric : "";
  const translation = [data?.tlyric, data?.trans, data?.translation]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())
    .join("\n");
  const karaoke = [data?.qrc, data?.yrc, data?.krc, data?.klyric, data?.mrc, data?.karaoke]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim() || "";
  const lrc = mergeLyricTracks({
    main,
    translation,
    karaoke,
    source: data?.source || song.source,
  });

  if (!url) {
    throw new GDStudioApiError('BAD_RESPONSE', 200, 'autosource response is missing url');
  }

  const resolvedSource = data?.source === undefined
    ? undefined
    : normalizeGDStudioSource(data.source);
  if (data?.source !== undefined && !resolvedSource) {
    throw new GDStudioApiError('BAD_RESPONSE', 200, 'autosource response has invalid source');
  }
  const resolvedId = data?.id !== undefined && data?.id !== null && String(data.id).trim()
    ? data.id
    : undefined;

  return {
    url,
    lrc,
    pic,
    resolvedSource: resolvedSource || undefined,
    resolvedId,
    resolvedLyricId: resolvedId,
  };
};

/**
 * 调用 Embeat 大模型获取 AI 推荐歌曲 (支持大语言模型搜歌 / 情感电台)
 */
export const getAIRecommendedSongs = async (
  keyword: string,
  source: GdStudioSource = 'netease',
  count: number = 20,
  signal?: AbortSignal,
): Promise<Song[]> => {
  const tracks = await loadAIRecommendationTracks(keyword, source, count, signal);
  await enrichAIRecommendationCovers(tracks, getGDStudioPic);
  return mapAIRecommendationTracks(tracks);
};
