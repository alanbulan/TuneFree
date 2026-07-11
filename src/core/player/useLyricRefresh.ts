import { useEffect, useState } from "react";
import { getLyrics } from "../services/api";
import { getSongKey, isSameSong } from "../types";
import { LYRIC_DISPLAY_MODE_CHANGE_EVENT } from "../utils/lyricDisplayMode";
import { shouldFetchBetterLyrics, shouldUseLyricCandidate } from "./playerUtils";
import type { PlayerRuntime } from "./usePlayerRuntime";

export const useLyricRefresh = (runtime: PlayerRuntime): void => {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const { currentSong, refs, setCurrentSong, setQueue } = runtime;

  useEffect(() => {
    const requestRefresh = () => setRefreshNonce((value) => value + 1);
    window.addEventListener(LYRIC_DISPLAY_MODE_CHANGE_EVENT, requestRefresh);
    window.addEventListener("storage", requestRefresh);
    return () => {
      window.removeEventListener(LYRIC_DISPLAY_MODE_CHANGE_EVENT, requestRefresh);
      window.removeEventListener("storage", requestRefresh);
    };
  }, []);

  useEffect(() => {
    if (!currentSong || !shouldFetchBetterLyrics(currentSong, currentSong.lrc)) return;
    const refreshKey = `${getSongKey(currentSong)}:${currentSong.lrc?.length || 0}:${refreshNonce}`;
    if (refs.lyricRefreshKey.current === refreshKey) return;
    refs.lyricRefreshKey.current = refreshKey;

    let cancelled = false;
    void getLyrics(currentSong.id, currentSong.source, currentSong).then((lrc) => {
      if (cancelled || !shouldUseLyricCandidate(refs.currentSong.current?.lrc, lrc)) return;
      refs.parsedSongCache.current.clear();
      setCurrentSong((previous) => {
        if (!previous || !isSameSong(previous, currentSong) ||
            !shouldUseLyricCandidate(previous.lrc, lrc)) return previous;
        const nextSong = { ...previous, lrc };
        refs.currentSong.current = nextSong;
        return nextSong;
      });
      setQueue((previous) => {
        const nextQueue = previous.map((song) =>
          isSameSong(song, currentSong) && shouldUseLyricCandidate(song.lrc, lrc)
            ? { ...song, lrc } : song,
        );
        refs.queue.current = nextQueue;
        return nextQueue;
      });
    });
    return () => { cancelled = true; };
  }, [currentSong, refreshNonce, refs, setCurrentSong, setQueue]);
};
