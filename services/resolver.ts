import { API_PREFIX } from "./config";
import { fixUrl } from "./utils";
import { fetchNeteaselyrics } from "./netease";
import { fetchQQLyrics } from "./qq";
import { fetchKuwoLyrics } from "./kuwo";
import {
  getGDStudioLyrics,
  getGDStudioSongUrl,
  isGDStudioOnlySource,
  isGDStudioSource,
  parseGDStudioSongFull,
} from "./gdStudio";
import type { Song } from "../types";

const _lyricsCache = new Map<string, string>();
const _lyricsPending = new Map<string, Promise<string>>();

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
): Promise<string> => {
  const cacheKey = `lrc:${source}:${id}`;
  const cached = _lyricsCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const pending = _lyricsPending.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    let lrc = "";

    try {
      if (isGDStudioOnlySource(source)) {
        lrc = await getGDStudioLyrics(id, source);
      } else if (source === "netease") {
        lrc = await fetchNeteaselyrics(id);
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
): Promise<string> => {
  if (!id || !source || source === "undefined") return "";
  return fetchFallbackLyrics(id, source);
};

export const getSongUrl = async (
  id: string | number,
  source: string,
  quality: string = "320k",
): Promise<string | null> => {
  if (!id || !source || source === "undefined" || String(id).startsWith("temp_")) {
    return null;
  }

  if (isGDStudioOnlySource(source)) {
    return getGDStudioSongUrl(id, source, quality);
  }

  const nativeUrl = await fetchNativeUrl(String(id), source, quality);
  if (nativeUrl) return fixUrl(nativeUrl) || null;

  if (isGDStudioSource(source)) {
    return getGDStudioSongUrl(id, source, quality);
  }

  return null;
};

export const parseSongFull = async (
  id: string | number,
  platform: string,
  quality: string = "320k",
  songMeta?: Pick<Song, "pic" | "picId">,
): Promise<{ url: string | null; lrc: string; pic: string } | null> => {
  if (!id || !platform || platform === "undefined" || String(id).startsWith("temp_")) {
    return null;
  }

  if (isGDStudioOnlySource(platform)) {
    return parseGDStudioSongFull(id, platform, quality, songMeta);
  }

  const [url, lrc] = await Promise.all([
    getSongUrl(id, platform, quality),
    getLyrics(id, platform),
  ]);
  const pic = songMeta?.pic ? fixUrl(songMeta.pic) : "";

  if (!url && !lrc && !pic) return null;

  return { url, lrc, pic };
};
