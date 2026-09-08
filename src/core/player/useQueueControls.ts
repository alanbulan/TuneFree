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
  const {
    preloadedResolutionKey: preloadedResolutionKeyRef, audio: audioRef, currentSong: currentSongRef,
    playSong: playSongRef, queue: queueRef, playMode: playModeRef,
    refreshedCacheKeys: refreshedCacheKeysRef, audioQuality: audioQualityRef, playRequestId: playRequestIdRef,
    playAbort: playAbortRef, playNext: playNextRef,
  } = refs;
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
    preloadedResolutionKeyRef.current = null;
    commitQueue(nextQueue);
    const activeAudio = audioRef.current;
    if (isSameSong(currentSongRef.current, targetSong) && activeAudio?.src &&
        activeAudio.src !== window.location.href && !activeAudio.paused) {
      commitCurrentSong({ ...currentSongRef.current, ...targetSong } as Song);
      resolver.preloadNextSong(targetSong);
      return;
    }
    await playSongRef.current(targetSong);
  }, [commitCurrentSong, commitQueue, resolver, preloadedResolutionKeyRef, audioRef, currentSongRef, playSongRef]);

  const playNext = useCallback((force = true) => {
    const queue = queueRef.current;
    const current = currentSongRef.current;
    if (queue.length === 0) return;
    if (force) recommendation.logEarlySkipIfNeeded();
    if (!force && playModeRef.current === "loop") {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audio.updateCurrentTimeState(0);
        void audioRef.current.play().catch((error) =>
          console.error("单曲循环重播失败:", error));
      }
      return;
    }
    const nextIndex = resolveQueueStepIndex(refs, current, 1);
    const nextSong = nextIndex >= 0 ? queue[nextIndex] : undefined;
    if (!nextSong) return;
    if (current && isSameSong(nextSong, current)) {
      recommendation.startPlaybackSession();
      refreshedCacheKeysRef.current.clear();
      void playSongRef.current(nextSong, audioQualityRef.current);
    } else {
      void playSongRef.current(nextSong);
    }
  }, [audio, recommendation, refs, audioRef, currentSongRef, playSongRef, queueRef, playModeRef, refreshedCacheKeysRef, audioQualityRef]);

  const playPrev = useCallback(() => {
    const activeAudio = audioRef.current;
    if (activeAudio && activeAudio.currentTime > 3) {
      activeAudio.currentTime = 0;
      audio.updateCurrentTimeState(0);
      audio.updatePositionState();
      return;
    }
    if (queueRef.current.length === 0) return;
    recommendation.logEarlySkipIfNeeded();
    const prevIndex = resolveQueueStepIndex(refs, currentSongRef.current, -1);
    if (prevIndex >= 0) void playSongRef.current(queueRef.current[prevIndex]);
  }, [audio, recommendation, refs, audioRef, currentSongRef, playSongRef, queueRef]);

  const addToQueue = useCallback((song: Song) => {
    commitQueue((previous) => previous.some((queued) => isSameSong(queued, song))
      ? previous : [...previous, song]);
  }, [commitQueue]);

  const removeFromQueue = useCallback((songId: string | number, source?: string) => {
    const matches = (song: Song) => String(song.id) === String(songId) &&
      (!source || song.source === source);
    const previousQueue = queueRef.current;
    const removedIndex = previousQueue.findIndex(matches);
    if (removedIndex < 0) return;
    const nextQueue = previousQueue.filter((song) => !matches(song));
    commitQueue(nextQueue);
    preloadedResolutionKeyRef.current = null;
    if (!currentSongRef.current || !matches(currentSongRef.current)) return;
    if (nextQueue.length === 0) {
      playRequestIdRef.current += 1;
      playAbortRef.current?.abort();
      const activeAudio = audioRef.current;
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
    if (nextSong) void playSongRef.current(nextSong);
  }, [audio, commitCurrentSong, commitQueue, setDuration, setIsLoading, setIsPlaying, preloadedResolutionKeyRef, audioRef, currentSongRef, playSongRef, queueRef, playRequestIdRef, playAbortRef]);

  const clearQueue = useCallback(() => {
    preloadedResolutionKeyRef.current = null;
    commitQueue(currentSongRef.current ? [currentSongRef.current] : []);
  }, [commitQueue, preloadedResolutionKeyRef, currentSongRef]);

  const togglePlayMode = useCallback(() => {
    setPlayMode((previous) => previous === "sequence" ? "loop" :
      previous === "loop" ? "shuffle" : "sequence");
  }, [setPlayMode]);

  useEffect(() => { playNextRef.current = playNext; }, [playNext, playNextRef]);
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
  // 函数内部读的是 queueRef.current，始终是最新值。
  useEffect(() => {
    if (runtime.currentSong && runtime.isPlaying) resolver.preloadNextSong(runtime.currentSong);
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- 预加载回调读 ref，音质或播放模式变化仍须重新计算下一首。
  }, [resolver, runtime.audioQuality, runtime.currentSong,
    runtime.isPlaying, runtime.playMode]);

  return useMemo(() => ({
    playQueue, playNext, playPrev, addToQueue, removeFromQueue, clearQueue, togglePlayMode,
  }), [addToQueue, clearQueue, playNext, playPrev, playQueue, removeFromQueue, togglePlayMode]);
};

export type QueueControls = ReturnType<typeof useQueueControls>;
