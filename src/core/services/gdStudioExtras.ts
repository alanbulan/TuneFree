import type { Song } from '../types';
import { fixUrl } from './utils';
import { mergeLyricTracks } from '../utils/lyrics';
import { fetchGDStudioData, GDStudioApiError } from './gdStudioClient';
import {
  enrichAIRecommendationCovers,
  loadAIRecommendationTracks,
  mapAIRecommendationTracks,
} from './gdStudioAi';
import { normalizeBitrate, normalizeGDStudioSource, type GdStudioSource } from './gdStudioModel';
import { resolvePic } from './sources/registry';

/**
 * GD 音乐台的「非平台解析」能力。
 *
 * 平台解析（musicUrl / lyric / pic / search）已经由内置脚本
 * `sources/builtin/gdMusicScript.ts` 承担；这里保留的是 GD 独占的两个接口：
 *
 * - `types=autosource`：一次请求完成「按歌名找歌 + 取播放地址」，用于 embeat
 *   （AI 推荐歌曲）与按歌名匹配；
 * - `embeat_agent` / Pollinations：AI 推荐歌单。
 *
 * 两处都用注册表的 `resolvePic` 取封面，因此封面能力同样来自 provider 声明。
 */

/** 用注册表的通用封面能力替代原先的 GD 专用封面函数。 */
const resolveRecommendationCover = async (
  source: GdStudioSource,
  picId: string,
  _size: 300 | 500,
  songId?: string | number,
  signal?: AbortSignal,
): Promise<string> => {
  if (!picId) return '';
  return resolvePic({
    platform: source,
    id: songId === undefined ? picId : songId,
    quality: '320k',
    picId,
    signal,
  });
};

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

/** 调用 Embeat 大模型获取 AI 推荐歌曲 (支持大语言模型搜歌 / 情感电台) */
export const getAIRecommendedSongs = async (
  keyword: string,
  source: GdStudioSource = 'netease',
  count: number = 20,
  signal?: AbortSignal,
): Promise<Song[]> => {
  const tracks = await loadAIRecommendationTracks(keyword, source, count, signal);
  await enrichAIRecommendationCovers(tracks, resolveRecommendationCover);
  return mapAIRecommendationTracks(tracks);
};
