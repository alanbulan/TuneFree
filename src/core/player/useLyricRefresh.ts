import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getLyrics } from "../services/api";
import { isGDStudioSource, resolveGDStudioPic } from "../services/gdStudio";
import { getSongKey } from "../types";
import {
  LYRIC_DISPLAY_MODE_CHANGE_EVENT,
  LYRIC_DISPLAY_MODE_STORAGE_KEY,
} from "../utils/lyricDisplayMode";
import { evictParsedCacheForSong, shouldFetchBetterLyrics } from "./playerUtils";
import { getLyricRequest, updateCover, updateLyrics } from "./songMetadata";
import type { PlayerRuntime } from "./usePlayerRuntime";

export const useLyricRefresh = (runtime: PlayerRuntime): void => {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const { currentSong, refs } = runtime;
  const {
    lyricBindings: lyricBindingsRef, playRequestId: playRequestIdRef, lyricRefreshKey: lyricRefreshKeyRef,
    playAbort: playAbortRef, parsedSongCache: parsedSongCacheRef,
  } = refs;
  const runtimeRef = useRef(runtime);
  useLayoutEffect(() => { runtimeRef.current = runtime; }, [runtime]);

  useEffect(() => {
    const requestRefresh = () => setRefreshNonce((value) => value + 1);
    // storage 事件对同源所有键都会触发，这里只关心歌词显示模式（null 表示整体 clear）。
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === LYRIC_DISPLAY_MODE_STORAGE_KEY) requestRefresh();
    };
    window.addEventListener(LYRIC_DISPLAY_MODE_CHANGE_EVENT, requestRefresh);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(LYRIC_DISPLAY_MODE_CHANGE_EVENT, requestRefresh);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!currentSong?.url) return;
    const binding = lyricBindingsRef.current.get(getSongKey(currentSong));
    const lyricRequest = getLyricRequest(currentSong, binding);
    if (!lyricRequest) return;
    const needsLyrics = shouldFetchBetterLyrics({ source: lyricRequest.source }, currentSong.lrc);
    const needsCover = !currentSong.pic && isGDStudioSource(lyricRequest.source);
    if (!needsLyrics && !needsCover) return;
    const requestId = playRequestIdRef.current;
    const refreshKey = [
      getSongKey(currentSong),
      lyricRequest.source,
      lyricRequest.id,
      lyricRequest.songMeta.lyricId || "",
      currentSong.lrc?.length || 0,
      refreshNonce, currentSong.pic || "", requestId,
    ].join(":");
    if (lyricRefreshKeyRef.current === refreshKey) return;
    lyricRefreshKeyRef.current = refreshKey;

    const controller = new AbortController();
    const playbackSignal = playAbortRef.current?.signal;
    const abort = () => controller.abort();
    playbackSignal?.addEventListener('abort', abort, { once: true });
    if (playbackSignal?.aborted) abort();
    const lyrics = needsLyrics ? getLyrics(lyricRequest.id, lyricRequest.source,
      lyricRequest.songMeta, { signal: controller.signal, forceRefresh: refreshNonce > 0 }) : Promise.resolve('');
    const cover = needsCover && isGDStudioSource(lyricRequest.source)
      ? resolveGDStudioPic(lyricRequest.id, lyricRequest.source, lyricRequest.songMeta, controller.signal)
      : Promise.resolve('');
    void Promise.allSettled([lyrics, cover]).then(([lyricResult, coverResult]) => {
      if (controller.signal.aborted || requestId !== playRequestIdRef.current) return;
      if (lyricResult.status === 'fulfilled' && updateLyrics(runtimeRef.current, currentSong, binding, lyricResult.value)) {
        evictParsedCacheForSong(parsedSongCacheRef.current, currentSong);
      }
      if (coverResult.status === 'fulfilled' && coverResult.value) {
        updateCover(runtimeRef.current, currentSong, binding, coverResult.value);
      }
    });
    const releaseKey = () => {
      if (lyricRefreshKeyRef.current === refreshKey) lyricRefreshKeyRef.current = null;
    };
    return () => {
      controller.abort();
      playbackSignal?.removeEventListener('abort', abort);
      releaseKey();
    };
  }, [currentSong, refreshNonce, lyricBindingsRef, playRequestIdRef, lyricRefreshKeyRef, playAbortRef, parsedSongCacheRef]);
};
