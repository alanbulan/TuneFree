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
    refs.pendingQualityChange.current = refs.activeQuality.current !== quality;
    refs.audioQuality.current = quality;
    setAudioQualityState(quality);
    logPlaybackEvent(
      "quality_change", refs.currentSong.current, refs.audio.current?.currentTime,
      refs.audio.current ? getFiniteAudioDuration(refs.audio.current) : undefined, quality,
    );
    if (refs.currentSong.current && refs.audio.current && !refs.audio.current.paused) {
      void refs.playSong.current(refs.currentSong.current, quality);
    }
  }, [logPlaybackEvent, refs, setAudioQualityState]);

  return useMemo(() => ({ setLyricOffsetSeconds, adjustLyricOffsetSeconds, setAudioQuality }),
    [adjustLyricOffsetSeconds, setAudioQuality, setLyricOffsetSeconds]);
};
