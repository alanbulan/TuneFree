import { useCallback, useMemo } from "react";
import { parseSongFull } from "../services/api";
import type { ResolveOptions } from "../services/resolver";
import { resolveOfflinePlayback } from "../services/offlineDownloads";
import { getSongKey, isSameSong } from "../types";
import type { AudioQuality, Song } from "../types";
import { isAbortError, PARSED_SONG_CACHE_TTL_MS } from "./playerUtils";
import { resolveQueueStepIndex } from "./queueNavigation";
import type { ParsedSongResolution } from "./types";
import type { PlayerRuntime } from "./usePlayerRuntime";

export const useSongResolver = (runtime: PlayerRuntime) => {
  const { commitQueue, refs } = runtime;
  const getParsedSongCacheKey = useCallback(
    (song: Pick<Song, "id" | "source">, quality: AudioQuality) =>
      `${getSongKey(song)}:${quality}`,
    [],
  );

  const resolveParsedSong = useCallback(async (
    song: Song,
    quality: AudioQuality,
    options?: ResolveOptions,
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
    if (options?.forceRefresh) refs.parsedSongCache.current.delete(cacheKey);
    const cached = refs.parsedSongCache.current.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { parsed: cached.data, cacheKey };
    if (cached) refs.parsedSongCache.current.delete(cacheKey);
    try {
      const parsed = await parseSongFull(song.id, song.source, quality, song, options);
      if (parsed?.url) {
        refs.parsedSongCache.current.set(cacheKey, {
          data: parsed, expiresAt: Date.now() + PARSED_SONG_CACHE_TTL_MS,
        });
      } else {
        refs.parsedSongCache.current.delete(cacheKey);
      }
      return { parsed, cacheKey };
    } catch (error) {
      // 主动取消不是解析失败，不能污染缓存状态。
      if (!isAbortError(error)) refs.parsedSongCache.current.delete(cacheKey);
      throw error;
    }
  }, [getParsedSongCacheKey, refs]);

  const applyPreloadPatch = useCallback((nextSong: Song, patch: Partial<Song>) => {
    commitQueue((previous) => {
      let changed = false;
      const nextQueue = previous.map((queuedSong) => {
        if (!isSameSong(queuedSong, nextSong)) return queuedSong;
        const hasNewValue = (Object.keys(patch) as (keyof Song)[])
          .some((key) => queuedSong[key] !== patch[key]);
        if (!hasNewValue) return queuedSong;
        changed = true;
        return { ...queuedSong, ...patch };
      });
      // 补丁没带来任何变化时返回原引用，避免无谓的 setState → effect → 再预加载链。
      return changed ? nextQueue : previous;
    });
  }, [commitQueue]);

  const preloadNextSong = useCallback((song: Song) => {
    const nextIndex = resolveQueueStepIndex(refs, song, 1);
    if (nextIndex < 0) return;
    const nextSong = refs.queue.current[nextIndex];
    if (!nextSong || isSameSong(nextSong, song)) return;
    const quality = refs.audioQuality.current;
    const cacheKey = getParsedSongCacheKey(nextSong, quality);
    if (refs.preloadedResolutionKey.current === cacheKey) return;
    refs.preloadedResolutionKey.current = cacheKey;
    refs.preloadAbort.current?.abort();
    const controller = new AbortController();
    refs.preloadAbort.current = controller;

    const releaseKey = () => {
      if (refs.preloadedResolutionKey.current === cacheKey) {
        refs.preloadedResolutionKey.current = null;
      }
    };

    void resolveParsedSong(nextSong, quality, { signal: controller.signal })
      .then(({ parsed }) => {
        if (!parsed?.url || controller.signal.aborted ||
            getParsedSongCacheKey(nextSong, refs.audioQuality.current) !== cacheKey) {
          releaseKey();
          return;
        }
        const patch: Partial<Song> = { url: parsed.url };
        if (parsed.pic && !nextSong.pic) patch.pic = parsed.pic;
        if (parsed.lrc) patch.lrc = parsed.lrc;
        applyPreloadPatch(nextSong, patch);
      })
      .catch((error) => {
        releaseKey();
        if (isAbortError(error)) return;
        console.error("Preload next song failed:", error);
      })
      .finally(() => {
        if (refs.preloadAbort.current === controller) refs.preloadAbort.current = null;
      });
  }, [applyPreloadPatch, getParsedSongCacheKey, refs, resolveParsedSong]);

  return useMemo(() => ({ getParsedSongCacheKey, resolveParsedSong, preloadNextSong }),
    [getParsedSongCacheKey, preloadNextSong, resolveParsedSong]);
};

export type SongResolver = ReturnType<typeof useSongResolver>;
