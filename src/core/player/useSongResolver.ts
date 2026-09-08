import { useCallback, useMemo } from "react";
import { parseSongFull } from "../services/api";
import { pruneExpiredEntries } from "../utils/boundedCache";
import { throwIfAborted } from "../services/proxy";
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
  const {
    parsedSongCache: parsedSongCacheRef, queue: queueRef, audioQuality: audioQualityRef,
    preloadedResolutionKey: preloadedResolutionKeyRef, preloadAbort: preloadAbortRef,
  } = refs;
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
    throwIfAborted(options?.signal);
    const local = await resolveOfflinePlayback(song, quality).catch(() => null);
    throwIfAborted(options?.signal);
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
    if (options?.forceRefresh) parsedSongCacheRef.current.delete(cacheKey);
    pruneExpiredEntries(parsedSongCacheRef.current, 100);
    const cached = parsedSongCacheRef.current.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { parsed: cached.data, cacheKey };
    if (cached) parsedSongCacheRef.current.delete(cacheKey);
    try {
      const parsed = await parseSongFull(song.id, song.source, quality, song, { ...options, deferMetadata: true });
      throwIfAborted(options?.signal);
      if (parsed?.url) {
        parsedSongCacheRef.current.set(cacheKey, {
          data: parsed, expiresAt: Date.now() + PARSED_SONG_CACHE_TTL_MS,
        });
        pruneExpiredEntries(parsedSongCacheRef.current, 100);
      } else {
        parsedSongCacheRef.current.delete(cacheKey);
      }
      return { parsed, cacheKey };
    } catch (error) {
      // 主动取消不是解析失败，不能污染缓存状态。
      if (!isAbortError(error)) parsedSongCacheRef.current.delete(cacheKey);
      throw error;
    }
  }, [getParsedSongCacheKey, parsedSongCacheRef]);

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
    const nextSong = queueRef.current[nextIndex];
    if (!nextSong || isSameSong(nextSong, song)) return;
    const quality = audioQualityRef.current;
    const cacheKey = getParsedSongCacheKey(nextSong, quality);
    if (preloadedResolutionKeyRef.current === cacheKey) return;
    preloadedResolutionKeyRef.current = cacheKey;
    preloadAbortRef.current?.abort();
    const controller = new AbortController();
    preloadAbortRef.current = controller;

    const releaseKey = () => {
      if (preloadedResolutionKeyRef.current === cacheKey) {
        preloadedResolutionKeyRef.current = null;
      }
    };

    void resolveParsedSong(nextSong, quality, { signal: controller.signal })
      .then(({ parsed }) => {
        if (!parsed?.url || controller.signal.aborted ||
            getParsedSongCacheKey(nextSong, audioQualityRef.current) !== cacheKey) {
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
        if (preloadAbortRef.current === controller) preloadAbortRef.current = null;
      });
  }, [applyPreloadPatch, getParsedSongCacheKey, refs, resolveParsedSong, queueRef, audioQualityRef, preloadedResolutionKeyRef, preloadAbortRef]);

  return useMemo(() => ({ getParsedSongCacheKey, resolveParsedSong, preloadNextSong }),
    [getParsedSongCacheKey, preloadNextSong, resolveParsedSong]);
};

export type SongResolver = ReturnType<typeof useSongResolver>;
