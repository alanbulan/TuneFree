import { useCallback, useMemo } from "react";
import type { AudioLifecycle } from "./useAudioLifecycle";
import type { PlaybackRecovery } from "./usePlaybackRecovery";
import type { PlayerRuntime } from "./usePlayerRuntime";
import type { RecommendationPlayback } from "./useRecommendationPlayback";
import type { SongResolver } from "./useSongResolver";

export const usePlaybackControls = (
  runtime: PlayerRuntime,
  audioLifecycle: AudioLifecycle,
  resolver: SongResolver,
  recommendation: RecommendationPlayback,
  recovery: PlaybackRecovery,
) => {
  const { refs, setIsLoading, setIsPlaying } = runtime;
  const pausePlayback = useCallback(() => {
    const audio = refs.audio.current;
    const song = refs.currentSong.current;
    if (!audio || !song) return;
    refs.playRequestId.current += 1;
    audio.pause();
    setIsPlaying(false);
    setIsLoading(false);
    audioLifecycle.updateMediaSession(song, "paused");
  }, [audioLifecycle, refs, setIsLoading, setIsPlaying]);

  const resumePlayback = useCallback(async () => {
    const audio = refs.audio.current;
    const song = refs.currentSong.current;
    if (!song) return;
    if (refs.pendingQualityChange.current &&
        refs.activeQuality.current !== refs.audioQuality.current) {
      await refs.playSong.current(song, refs.audioQuality.current);
      return;
    }
    if (!audio?.src || audio.src === window.location.href) {
      await refs.playSong.current(song);
      return;
    }
    if (refs.audioContext.current?.state === "suspended") {
      await refs.audioContext.current.resume().catch(() => {});
    }
    const requestId = ++refs.playRequestId.current;
    setIsLoading(true);
    try {
      await audio.play();
      if (requestId !== refs.playRequestId.current) return;
      audioLifecycle.syncPlaybackTime(true);
      setIsPlaying(true);
      setIsLoading(false);
      audioLifecycle.updateMediaSession(song, "playing");
      resolver.preloadNextSong(song);
    } catch (error: unknown) {
      if (requestId !== refs.playRequestId.current) return;
      console.error("Resume playback failed:", error);
      const isNotAllowed = error instanceof Error && error.name === "NotAllowedError";
      if (isNotAllowed) {
        recommendation.showPlayerNotice("播放被浏览器阻止，请再次点击播放", "warning");
        setIsPlaying(false);
        setIsLoading(false);
        return;
      }
      recovery.evictActiveParsedSong();
      audioLifecycle.clearActiveAudioSource();
      await refs.playSong.current(song);
    }
  }, [audioLifecycle, recommendation, recovery, refs, resolver, setIsLoading, setIsPlaying]);

  const togglePlay = useCallback(() => {
    const audio = refs.audio.current;
    if (!audio || !refs.currentSong.current) return;
    if (audio.src && audio.src !== window.location.href && !audio.paused) {
      pausePlayback();
    } else {
      void resumePlayback();
    }
  }, [pausePlayback, refs, resumePlayback]);

  const seek = useCallback((time: number) => {
    if (!refs.audio.current) return;
    refs.audio.current.currentTime = time;
    audioLifecycle.updateCurrentTimeState(time);
    audioLifecycle.updatePositionState();
  }, [audioLifecycle, refs]);

  return useMemo(() => ({ pausePlayback, resumePlayback, togglePlay, seek }),
    [pausePlayback, resumePlayback, seek, togglePlay]);
};

export type PlaybackControls = ReturnType<typeof usePlaybackControls>;
