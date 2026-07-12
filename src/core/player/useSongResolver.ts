import { useCallback, useMemo } from "react";
import { getNextQueueIndex } from "../contexts/playerQueue";
import { parseSongFull } from "../services/api";
import { resolveOfflinePlayback } from "../services/offlineDownloads";
import { getSongKey, isSameSong } from "../types";
import type { AudioQuality, Song } from "../types";
import { PARSED_SONG_CACHE_TTL_MS } from "./playerUtils";
import type { ParsedSongResolution } from "./types";
import type { PlayerRuntime } from "./usePlayerRuntime";

export const useSongResolver = (runtime: PlayerRuntime) => {
  const { refs, setQueue } = runtime;
  const getParsedSongCacheKey = useCallback(
    (song: Pick<Song, "id" | "source">, quality: AudioQuality) =>
      `${getSongKey(song)}:${quality}`,
    [],
  );

  const resolveParsedSong = useCallback(async (
    song: Song,
    quality: AudioQuality,
    forceRefresh = false,
  ): Promise<ParsedSongResolution> => {
    const local = await resolveOfflinePlayback(song, quality).catch(() => null);
    if (local?.url) {
      return {
        parsed: {
          url: local.url,
          lrc: local.lrc,
          pic: local.pic,
          resolvedSource: song.source,
          resolvedId: song.id,
          resolvedLyricId: song.lyricId || song.id,
        },
        cacheKey: null,
      };
    }
    const cacheKey = getParsedSongCacheKey(song, quality);
    if (forceRefresh) refs.parsedSongCache.current.delete(cacheKey);
    const cached = refs.parsedSongCache.current.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { parsed: cached.data, cacheKey };
    if (cached) refs.parsedSongCache.current.delete(cacheKey);
    try {
      const parsed = await parseSongFull(song.id, song.source, quality, song);
      if (parsed?.url) {
        refs.parsedSongCache.current.set(cacheKey, {
          data: parsed, expiresAt: Date.now() + PARSED_SONG_CACHE_TTL_MS,
        });
      } else {
        refs.parsedSongCache.current.delete(cacheKey);
      }
      return { parsed, cacheKey };
    } catch (error) {
      refs.parsedSongCache.current.delete(cacheKey);
      throw error;
    }
  }, [getParsedSongCacheKey, refs]);

  const preloadNextSong = useCallback((song: Song) => {
    const nextIndex = getNextQueueIndex(refs.queue.current, song, refs.playMode.current);
    if (nextIndex < 0) return;
    const nextSong = refs.queue.current[nextIndex];
    if (!nextSong || isSameSong(nextSong, song)) return;
    const quality = refs.audioQuality.current;
    const cacheKey = getParsedSongCacheKey(nextSong, quality);
    if (refs.preloadedResolutionKey.current === cacheKey) return;
    refs.preloadedResolutionKey.current = cacheKey;

    void resolveParsedSong(nextSong, quality).then(({ parsed }) => {
      if (!parsed?.url || getParsedSongCacheKey(nextSong, refs.audioQuality.current) !== cacheKey) {
        if (refs.preloadedResolutionKey.current === cacheKey) {
          refs.preloadedResolutionKey.current = null;
        }
        return;
      }
      const patch: Partial<Song> = { url: parsed.url };
      if (parsed.pic && !nextSong.pic) patch.pic = parsed.pic;
      if (parsed.lrc) patch.lrc = parsed.lrc;
      setQueue((previous) => {
        const nextQueue = previous.map((queuedSong) =>
          isSameSong(queuedSong, nextSong) ? { ...queuedSong, ...patch } : queuedSong,
        );
        refs.queue.current = nextQueue;
        return nextQueue;
      });
    }).catch((error) => {
      if (refs.preloadedResolutionKey.current === cacheKey) {
        refs.preloadedResolutionKey.current = null;
      }
      console.error("Preload next song failed:", error);
    });
  }, [getParsedSongCacheKey, refs, resolveParsedSong, setQueue]);

  return useMemo(() => ({ getParsedSongCacheKey, resolveParsedSong, preloadNextSong }),
    [getParsedSongCacheKey, preloadNextSong, resolveParsedSong]);
};

export type SongResolver = ReturnType<typeof useSongResolver>;
