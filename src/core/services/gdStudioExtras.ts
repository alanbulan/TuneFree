import type { Song } from '../types';
import { fixUrl } from './utils';
import { mergeLyricTracks } from '../utils/lyrics';
import { fetchGDStudioData, GDStudioApiError } from './gdStudioClient';
import { normalizeBitrate, normalizeGDStudioSource } from './gdStudioModel';

/**
 * GD 音乐台的「非平台解析」能力。
 *
 * 平台解析（musicUrl / lyric / pic / search）由内置脚本
 * `sources/builtin/gdMusicScript.ts` 承担；这里只剩 GD 独占的 `types=autosource`：
 * 一次请求完成「按歌名找歌 + 取播放地址」。
 *
 * 它服务于**历史数据**：早期 AI 搜歌把歌曲存成 `source: 'embeat'`，这些歌还躺在
 * 用户的收藏与歌单里，没有平台 id，只能靠歌名跨源匹配。新的语境搜歌走
 * `services/contextSearch.ts`，产出的是带真实平台 id 的歌曲，不再经过这里。
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
