import type { Song } from '../types';
import { mergeLyricTracks } from '../utils/lyrics';
import {
  fetchGDStudioData,
  GDStudioApiError,
} from './gdStudioClient';
import {
  enrichAIRecommendationCovers,
  loadAIRecommendationTracks,
  mapAIRecommendationTracks,
} from './gdStudioAi';
import {
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
  type GdStudioMusicSource,
  type GdStudioSource,
  type GdStudioTrack,
} from './gdStudioModel';
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

const REQUIRED_GD_TRACK_FIELDS: Array<keyof GdStudioTrack> = [
  'id', 'name', 'artist', 'album', 'pic_id', 'url_id', 'lyric_id', 'source',
];

export const searchGDStudio = async (
  keyword: string,
  source: GdStudioMusicSource,
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

  return mapGDStudioTracks(data, source);
};

export const mapGDStudioTracks = (
  data: unknown,
  requestedSource: GdStudioMusicSource,
): Song[] => {
  if (!Array.isArray(data)) {
    throw new GDStudioApiError('BAD_RESPONSE', 200, 'search response must be an array');
  }
  const songs: Song[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new GDStudioApiError('BAD_RESPONSE', 200, 'track must be an object');
    }
    const missingFields = REQUIRED_GD_TRACK_FIELDS.filter((field) => !(field in item));
    if (missingFields.length > 0) {
      throw new GDStudioApiError(
        'BAD_RESPONSE',
        200,
        `track is missing fields: ${missingFields.join(', ')}`,
      );
    }
    const track = item as GdStudioTrack;
    const artistIsValid = typeof track.artist === 'string'
      || (Array.isArray(track.artist) && track.artist.every((artist) => typeof artist === 'string'));
    if (
      !artistIsValid
      || typeof track.album !== 'string'
      || typeof track.pic_id !== 'string'
      || !['string', 'number'].includes(typeof track.id)
      || typeof track.name !== 'string'
      || !['string', 'number'].includes(typeof track.url_id)
      || !['string', 'number'].includes(typeof track.lyric_id)
      || typeof track.source !== 'string'
    ) {
      throw new GDStudioApiError('BAD_RESPONSE', 200, 'track fields have invalid types');
    }
    const id = String(track.id || '').trim();
    const name = track.name.trim();
    const source = normalizeGDStudioSource(track.source);
    const urlId = String(track.url_id || '').trim();
    const lyricId = String(track.lyric_id || '').trim();
    if (!id || !name || !source || !urlId || !lyricId) {
      throw new GDStudioApiError(
        'BAD_RESPONSE',
        200,
        'track id, name, url_id, lyric_id and source must be non-empty',
      );
    }
    if (source !== requestedSource) {
      throw new GDStudioApiError(
        'BAD_RESPONSE',
        200,
        `source mismatch: requested ${requestedSource}, received ${source}`,
      );
    }
    const trackKey = getTrackKey(id, source);
    if (seen.has(trackKey)) continue;
    seen.add(trackKey);
    const picId = track.pic_id.trim();
    const pic = picId.startsWith("http") || picId.startsWith("//")
      ? fixUrl(picId)
      : "";
    rememberTrackMeta(id, source, { pic, picId, lyricId, urlId });
    songs.push({
      id,
      name,
      artist: joinArtists(track.artist),
      album: track.album,
      pic,
      picId,
      lyricId,
      urlId,
      source,
    });
  }
  return songs;
};

export const getGDStudioSongUrl = async (
  id: string | number,
  source: GdStudioMusicSource,
  quality: string = "320k",
): Promise<string> => {
  const cacheKey = getUrlCacheKey(id, source, quality);
  const cached = urlCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const trackMeta = resolveTrackMeta(id, source);
  const requestId = trackMeta.urlId || String(id);

  const data = await fetchGDStudioData<{ url?: string }>({
    types: "url",
    source,
    id: requestId,
    br: normalizeBitrate(quality),
  });
  const url = fixUrl(typeof data?.url === "string" ? data.url : "");
  if (!url) {
    throw new GDStudioApiError('BAD_RESPONSE', 200, 'url response is missing url');
  }
  urlCache.set(cacheKey, { url, expiresAt: Date.now() + URL_CACHE_TTL });
  return url;
};

export const getGDStudioLyrics = async (
  id: string | number,
  source: GdStudioMusicSource,
): Promise<string> => {
  const trackMeta = resolveTrackMeta(id, source);
  const requestId = trackMeta.lyricId || String(id);
  const cacheKey = getTrackKey(requestId, source);

  if (lyricCache.has(cacheKey)) {
    return lyricCache.get(cacheKey) || "";
  }

  const data = await fetchGDStudioData<{
    lyric?: string;
    tlyric?: string;
  }>({ types: "lyric", source, id: requestId });
  if (typeof data?.lyric !== 'string') {
    throw new GDStudioApiError('BAD_RESPONSE', 200, 'lyric response is missing lyric');
  }
  const lrc = mergeLyricTracks({
    main: data.lyric.trim(),
    translation: typeof data.tlyric === 'string' ? data.tlyric.trim() : '',
    source,
  });
  lyricCache.set(cacheKey, lrc);
  rememberTrackMeta(id, source, { lyricId: requestId });
  return lrc;
};

export const getGDStudioPic = async (
  source: GdStudioMusicSource,
  picId: string,
  size: 300 | 500 = 500,
): Promise<string> => {
  if (!picId) return "";

  const cacheKey = `${source}:${picId}:${size}`;
  if (picCache.has(cacheKey)) {
    return picCache.get(cacheKey) || "";
  }

  const directPic = fixUrl(picId);
  if (directPic && (picId.startsWith("http") || picId.startsWith("//"))) {
    picCache.set(cacheKey, directPic);
    return directPic;
  }
  const data = await fetchGDStudioData<{ url?: string }>({
    types: "pic",
    source,
    id: picId,
    size,
  });
  const pic = fixUrl(typeof data?.url === "string" ? data.url : "");
  if (!pic) {
    throw new GDStudioApiError('BAD_RESPONSE', 200, 'pic response is missing url');
  }
  picCache.set(cacheKey, pic);
  return pic;
};

export const resolveGDStudioPic = async (
  id: string | number,
  source: GdStudioMusicSource,
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
  source: GdStudioMusicSource,
  quality: string = "320k",
  songMeta?: Pick<Song, "pic" | "picId">,
): Promise<{ url: string; lrc: string; pic: string }> => {
  const [url, lrc, pic] = await Promise.all([
    getGDStudioSongUrl(id, source, quality),
    getGDStudioLyrics(id, source),
    resolveGDStudioPic(id, source, songMeta),
  ]);

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
  const nameStr = nameParts.join(" | ");

  try {
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
    });

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
 * 调用 Embeat 大模型获取 AI 推荐歌曲 (支持大语言模型搜歌 / 情感电台)
 */
export const getAIRecommendedSongs = async (
  keyword: string,
  source: GdStudioMusicSource = 'netease',
  count: number = 20,
): Promise<Song[]> => {
  const tracks = await loadAIRecommendationTracks(keyword, source, count);
  await enrichAIRecommendationCovers(tracks, getGDStudioPic);
  return mapAIRecommendationTracks(tracks);
};
