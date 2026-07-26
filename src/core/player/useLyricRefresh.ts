import { useEffect, useRef, useState } from "react";
import { getLyrics } from "../services/api";
import { getSongKey } from "../types";
import {
  LYRIC_DISPLAY_MODE_CHANGE_EVENT,
  LYRIC_DISPLAY_MODE_STORAGE_KEY,
} from "../utils/lyricDisplayMode";
import { evictParsedCacheForSong, shouldFetchBetterLyrics } from "./playerUtils";
import { getLyricRequest, updateLyrics } from "./songMetadata";
import type { PlayerRuntime } from "./usePlayerRuntime";

export const useLyricRefresh = (runtime: PlayerRuntime): void => {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const { currentSong, refs } = runtime;
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

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
    if (!currentSong) return;
    const binding = refs.lyricBindings.current.get(getSongKey(currentSong));
    const lyricRequest = getLyricRequest(currentSong, binding);
    if (!lyricRequest) return;
    if (!shouldFetchBetterLyrics({ source: lyricRequest.source }, currentSong.lrc)) return;
    const refreshKey = [
      getSongKey(currentSong),
      lyricRequest.source,
      lyricRequest.id,
      lyricRequest.songMeta.lyricId || "",
      currentSong.lrc?.length || 0,
      refreshNonce,
    ].join(":");
    if (refs.lyricRefreshKey.current === refreshKey) return;
    refs.lyricRefreshKey.current = refreshKey;

    let cancelled = false;
    void getLyrics(lyricRequest.id, lyricRequest.source, lyricRequest.songMeta).then((lrc) => {
      if (cancelled) return;
      if (!updateLyrics(runtimeRef.current, currentSong, binding, lrc)) return;
      // 只作废当前歌曲的解析缓存，整表清空会连刚预加载好的下一首一起丢掉。
      evictParsedCacheForSong(refs.parsedSongCache.current, currentSong);
    });
    return () => { cancelled = true; };
  }, [currentSong, refreshNonce, refs]);
};
