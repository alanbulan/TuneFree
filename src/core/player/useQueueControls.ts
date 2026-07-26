import { useCallback, useEffect, useMemo } from "react";
import { getSongKey, isSameSong } from "../types";
import type { Song } from "../types";
import { resolveQueueStepIndex } from "./queueNavigation";
import type { AudioLifecycle } from "./useAudioLifecycle";
import type { PlaybackControls } from "./usePlaybackControls";
import type { PlayerRuntime } from "./usePlayerRuntime";
import type { RecommendationPlayback } from "./useRecommendationPlayback";
import type { SongResolver } from "./useSongResolver";

export const useQueueControls = (
  runtime: PlayerRuntime,
  audio: AudioLifecycle,
  playback: PlaybackControls,
  recommendation: RecommendationPlayback,
  resolver: SongResolver,
) => {
  const { commitCurrentSong, commitQueue, refs, setDuration,
    setIsLoading, setIsPlaying, setPlayMode } = runtime;
  const playQueue = useCallback(async (songs: Song[], startSong?: Song) => {
    const seen = new Set<string>();
    const nextQueue = songs.filter((song) => {
      const key = getSongKey(song);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (nextQueue.length === 0) return;
    const targetSong = startSong
      ? nextQueue.find((song) => isSameSong(song, startSong)) || nextQueue[0]
      : nextQueue[0];
    if (!targetSong) return;
    refs.preloadedResolutionKey.current = null;
    commitQueue(nextQueue);
    const activeAudio = refs.audio.current;
    if (isSameSong(refs.currentSong.current, targetSong) && activeAudio?.src &&
        activeAudio.src !== window.location.href && !activeAudio.paused) {
      commitCurrentSong({ ...refs.currentSong.current, ...targetSong } as Song);
      resolver.preloadNextSong(targetSong);
      return;
    }
    await refs.playSong.current(targetSong);
  }, [commitCurrentSong, commitQueue, refs, resolver]);

  const playNext = useCallback((force = true) => {
    const queue = refs.queue.current;
    const current = refs.currentSong.current;
    if (queue.length === 0) return;
    if (force) recommendation.logEarlySkipIfNeeded();
    if (!force && refs.playMode.current === "loop") {
      if (refs.audio.current) {
        refs.audio.current.currentTime = 0;
        audio.updateCurrentTimeState(0);
        void refs.audio.current.play().catch((error) =>
          console.error("单曲循环重播失败:", error));
      }
      return;
    }
    const nextIndex = resolveQueueStepIndex(refs, current, 1);
    const nextSong = nextIndex >= 0 ? queue[nextIndex] : undefined;
    if (!nextSong) return;
    if (current && isSameSong(nextSong, current)) {
      recommendation.startPlaybackSession();
      refs.refreshedCacheKeys.current.clear();
      void refs.playSong.current(nextSong, refs.audioQuality.current);
    } else {
      void refs.playSong.current(nextSong);
    }
  }, [audio, recommendation, refs]);

  const playPrev = useCallback(() => {
    const activeAudio = refs.audio.current;
    if (activeAudio && activeAudio.currentTime > 3) {
      activeAudio.currentTime = 0;
      audio.updateCurrentTimeState(0);
      audio.updatePositionState();
      return;
    }
    if (refs.queue.current.length === 0) return;
    recommendation.logEarlySkipIfNeeded();
    const prevIndex = resolveQueueStepIndex(refs, refs.currentSong.current, -1);
    if (prevIndex >= 0) void refs.playSong.current(refs.queue.current[prevIndex]);
  }, [audio, recommendation, refs]);

  const addToQueue = useCallback((song: Song) => {
    commitQueue((previous) => previous.some((queued) => isSameSong(queued, song))
      ? previous : [...previous, song]);
  }, [commitQueue]);

  const removeFromQueue = useCallback((songId: string | number, source?: string) => {
    const matches = (song: Song) => String(song.id) === String(songId) &&
      (!source || song.source === source);
    const previousQueue = refs.queue.current;
    const removedIndex = previousQueue.findIndex(matches);
    if (removedIndex < 0) return;
    const nextQueue = previousQueue.filter((song) => !matches(song));
    commitQueue(nextQueue);
    refs.preloadedResolutionKey.current = null;
    if (!refs.currentSong.current || !matches(refs.currentSong.current)) return;
    if (nextQueue.length === 0) {
      refs.playRequestId.current += 1;
      refs.playAbort.current?.abort();
      const activeAudio = refs.audio.current;
      if (activeAudio) {
        activeAudio.pause();
        activeAudio.removeAttribute("src");
        activeAudio.load();
      }
      commitCurrentSong(null);
      audio.updateCurrentTimeState(0);
      setDuration(0);
      setIsPlaying(false);
      setIsLoading(false);
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "none";
        navigator.mediaSession.metadata = null;
      }
      return;
    }
    const nextSong = nextQueue[Math.min(removedIndex, nextQueue.length - 1)] || nextQueue[0];
    if (nextSong) void refs.playSong.current(nextSong);
  }, [audio, commitCurrentSong, commitQueue, refs, setDuration, setIsLoading, setIsPlaying]);

  const clearQueue = useCallback(() => {
    refs.preloadedResolutionKey.current = null;
    commitQueue(refs.currentSong.current ? [refs.currentSong.current] : []);
  }, [commitQueue, refs]);

  const togglePlayMode = useCallback(() => {
    setPlayMode((previous) => previous === "sequence" ? "loop" :
      previous === "loop" ? "shuffle" : "sequence");
  }, [setPlayMode]);

  useEffect(() => { refs.playNext.current = playNext; }, [playNext, refs]);
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => void playback.resumePlayback());
    navigator.mediaSession.setActionHandler("pause", playback.pausePlayback);
    navigator.mediaSession.setActionHandler("previoustrack", playPrev);
    navigator.mediaSession.setActionHandler("nexttrack", () => playNext(true));
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined) playback.seek(details.seekTime);
    });
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
      navigator.mediaSession.setActionHandler("seekto", null);
    };
  }, [playNext, playPrev, playback]);
  useEffect(() => {
    if (runtime.currentSong) {
      audio.updateMediaSession(runtime.currentSong, runtime.isPlaying ? "playing" : "paused");
    }
  }, [audio, runtime.currentSong, runtime.isPlaying]);
  // 依赖里刻意不含 runtime.queue：预加载成功后必然 patch 队列，
  // 把队列引用列进依赖会让本 effect 自我触发，形成级联解析。
  // 函数内部读的是 refs.queue.current，始终是最新值。
  useEffect(() => {
    if (runtime.currentSong && runtime.isPlaying) resolver.preloadNextSong(runtime.currentSong);
  }, [resolver, runtime.audioQuality, runtime.currentSong,
    runtime.isPlaying, runtime.playMode]);

  return useMemo(() => ({
    playQueue, playNext, playPrev, addToQueue, removeFromQueue, clearQueue, togglePlayMode,
  }), [addToQueue, clearQueue, playNext, playPrev, playQueue, removeFromQueue, togglePlayMode]);
};

export type QueueControls = ReturnType<typeof useQueueControls>;
