import { useCallback, useMemo } from "react";
import { logRecommendationEvent } from "../services/recommendation";
import { getSongKey } from "../types";
import type { AudioQuality, Song } from "../types";
import { createPlaybackSessionId, getFiniteAudioDuration } from "./playerUtils";
import type { PlayerNotice } from "./types";
import type { PlayerRuntime } from "./usePlayerRuntime";

export const useRecommendationPlayback = (runtime: PlayerRuntime) => {
  const { refs, setPlayerNotice } = runtime;
  const {
    playbackSessionId: playbackSessionIdRef, currentSong: currentSongRef, audioQuality: audioQualityRef,
    audio: audioRef, play30LoggedKey: play30LoggedKeyRef, completeLoggedKey: completeLoggedKeyRef,
  } = refs;
  const showPlayerNotice = useCallback(
    (message: string, tone: PlayerNotice["tone"] = "info") => {
      setPlayerNotice({ id: Date.now(), tone, message });
    },
    [setPlayerNotice],
  );

  const startPlaybackSession = useCallback(() => {
    if (!playbackSessionIdRef.current) {
      playbackSessionIdRef.current = createPlaybackSessionId();
    }
    return playbackSessionIdRef.current;
  }, [playbackSessionIdRef]);

  const logPlaybackEvent = useCallback((
    eventType: string,
    song: Song | null | undefined = currentSongRef.current,
    positionSeconds?: number,
    durationSeconds?: number,
    quality?: AudioQuality,
  ) => {
    if (!song) return;
    void logRecommendationEvent({
      eventType,
      sessionId: playbackSessionIdRef.current || startPlaybackSession(),
      song, positionSeconds, durationSeconds,
      quality: quality || audioQualityRef.current,
      context: "playback",
    }).catch(() => {});
  }, [startPlaybackSession, playbackSessionIdRef, currentSongRef, audioQualityRef]);

  const logEarlySkipIfNeeded = useCallback(() => {
    const song = currentSongRef.current;
    const audio = audioRef.current;
    if (!song || !audio || audio.ended) return;
    const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    if (position > 0 && position < 30) {
      logPlaybackEvent("skip_early", song, position, getFiniteAudioDuration(audio));
    }
  }, [logPlaybackEvent, currentSongRef, audioRef]);

  const resetPlaybackState = useCallback((song: Song) => {
    const key = getSongKey(song);
    play30LoggedKeyRef.current = null;
    completeLoggedKeyRef.current = null;
    return key;
  }, [play30LoggedKeyRef, completeLoggedKeyRef]);

  return useMemo(() => ({
    showPlayerNotice, startPlaybackSession, logPlaybackEvent,
    logEarlySkipIfNeeded, resetPlaybackState,
  }), [logEarlySkipIfNeeded, logPlaybackEvent, resetPlaybackState,
    showPlayerNotice, startPlaybackSession]);
};

export type RecommendationPlayback = ReturnType<typeof useRecommendationPlayback>;
