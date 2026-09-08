import { useCallback, useMemo } from "react";
import type { AudioQuality } from "../types";
import { getFiniteAudioDuration } from "./playerUtils";
import type { PlayerRuntime } from "./usePlayerRuntime";
import type { RecommendationPlayback } from "./useRecommendationPlayback";

export const usePlayerSettingsActions = (
  runtime: PlayerRuntime,
  recommendation: RecommendationPlayback,
) => {
  const { refs, setAudioQuality: setAudioQualityState,
    setLyricOffsetSeconds: setLyricOffsetSecondsState } = runtime;
  const {
    pendingQualityChange: pendingQualityChangeRef, activeQuality: activeQualityRef, audioQuality: audioQualityRef,
    currentSong: currentSongRef, audio: audioRef, playSong: playSongRef,
  } = refs;
  const { logPlaybackEvent } = recommendation;
  const setLyricOffsetSeconds = useCallback((offset: number) => {
    const nextOffset = Number.isFinite(offset) ? Math.max(-10, Math.min(10, offset)) : 0;
    setLyricOffsetSecondsState(nextOffset);
  }, [setLyricOffsetSecondsState]);

  const adjustLyricOffsetSeconds = useCallback((delta: number) => {
    setLyricOffsetSecondsState((current) => {
      const nextOffset = current + (Number.isFinite(delta) ? delta : 0);
      return Math.max(-10, Math.min(10, nextOffset));
    });
  }, [setLyricOffsetSecondsState]);

  const setAudioQuality = useCallback((quality: AudioQuality) => {
    pendingQualityChangeRef.current = activeQualityRef.current !== quality;
    audioQualityRef.current = quality;
    setAudioQualityState(quality);
    logPlaybackEvent(
      "quality_change", currentSongRef.current, audioRef.current?.currentTime,
      audioRef.current ? getFiniteAudioDuration(audioRef.current) : undefined, quality,
    );
    if (currentSongRef.current && audioRef.current && !audioRef.current.paused) {
      void playSongRef.current(currentSongRef.current, quality);
    }
  }, [logPlaybackEvent, setAudioQualityState, pendingQualityChangeRef, activeQualityRef, audioQualityRef, currentSongRef, audioRef, playSongRef]);

  return useMemo(() => ({ setLyricOffsetSeconds, adjustLyricOffsetSeconds, setAudioQuality }),
    [adjustLyricOffsetSeconds, setAudioQuality, setLyricOffsetSeconds]);
};
