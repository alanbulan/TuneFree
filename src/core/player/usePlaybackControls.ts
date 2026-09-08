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
  const {
    audio: audioRef, currentSong: currentSongRef, playRequestId: playRequestIdRef,
    pendingQualityChange: pendingQualityChangeRef, activeQuality: activeQualityRef, audioQuality: audioQualityRef,
    playSong: playSongRef, audioContext: audioContextRef,
  } = refs;
  const pausePlayback = useCallback(() => {
    const audio = audioRef.current;
    const song = currentSongRef.current;
    if (!audio || !song) return;
    playRequestIdRef.current += 1;
    audio.pause();
    setIsPlaying(false);
    setIsLoading(false);
    audioLifecycle.updateMediaSession(song, "paused");
  }, [audioLifecycle, setIsLoading, setIsPlaying, audioRef, currentSongRef, playRequestIdRef]);

  const resumePlayback = useCallback(async () => {
    const audio = audioRef.current;
    const song = currentSongRef.current;
    if (!song) return;
    if (pendingQualityChangeRef.current &&
        activeQualityRef.current !== audioQualityRef.current) {
      await playSongRef.current(song, audioQualityRef.current);
      return;
    }
    if (!audio?.src || audio.src === window.location.href) {
      await playSongRef.current(song);
      return;
    }
    if (audioContextRef.current?.state === "suspended") {
      await audioContextRef.current.resume().catch(() => {});
    }
    const requestId = ++playRequestIdRef.current;
    setIsLoading(true);
    try {
      await audio.play();
      if (requestId !== playRequestIdRef.current) return;
      audioLifecycle.syncPlaybackTime(true);
      setIsPlaying(true);
      setIsLoading(false);
      audioLifecycle.updateMediaSession(song, "playing");
      resolver.preloadNextSong(song);
    } catch (error: unknown) {
      if (requestId !== playRequestIdRef.current) return;
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
      await playSongRef.current(song);
    }
  }, [audioLifecycle, recommendation, recovery, resolver, setIsLoading, setIsPlaying, audioRef, currentSongRef, playRequestIdRef, pendingQualityChangeRef, activeQualityRef, audioQualityRef, playSongRef, audioContextRef]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentSongRef.current) return;
    if (audio.src && audio.src !== window.location.href && !audio.paused) {
      pausePlayback();
    } else {
      void resumePlayback();
    }
  }, [pausePlayback, resumePlayback, audioRef, currentSongRef]);

  const seek = useCallback((time: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    audioLifecycle.updateCurrentTimeState(time);
    audioLifecycle.updatePositionState();
  }, [audioLifecycle, audioRef]);

  return useMemo(() => ({ pausePlayback, resumePlayback, togglePlay, seek }),
    [pausePlayback, resumePlayback, seek, togglePlay]);
};

export type PlaybackControls = ReturnType<typeof usePlaybackControls>;
