import { useCallback, useMemo } from "react";
import { logRecommendationEvent } from "../services/recommendation";
import { getSongKey } from "../types";
import type { AudioQuality, Song } from "../types";
import { createPlaybackSessionId, getFiniteAudioDuration } from "./playerUtils";
import type { PlayerNotice } from "./types";
import type { PlayerRuntime } from "./usePlayerRuntime";

export const useRecommendationPlayback = (runtime: PlayerRuntime) => {
  const { refs, setPlayerNotice } = runtime;
  const showPlayerNotice = useCallback(
    (message: string, tone: PlayerNotice["tone"] = "info") => {
      setPlayerNotice({ id: Date.now(), tone, message });
    },
    [setPlayerNotice],
  );

  const startPlaybackSession = useCallback(() => {
    if (!refs.playbackSessionId.current) {
      refs.playbackSessionId.current = createPlaybackSessionId();
    }
    return refs.playbackSessionId.current;
  }, [refs]);

  const logPlaybackEvent = useCallback((
    eventType: string,
    song: Song | null | undefined = refs.currentSong.current,
    positionSeconds?: number,
    durationSeconds?: number,
    quality?: AudioQuality,
  ) => {
    if (!song) return;
    void logRecommendationEvent({
      eventType,
      sessionId: refs.playbackSessionId.current || startPlaybackSession(),
      song, positionSeconds, durationSeconds,
      quality: quality || refs.audioQuality.current,
      context: "playback",
    }).catch(() => {});
  }, [refs, startPlaybackSession]);

  const logEarlySkipIfNeeded = useCallback(() => {
    const song = refs.currentSong.current;
    const audio = refs.audio.current;
    if (!song || !audio || audio.ended) return;
    const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    if (position > 0 && position < 30) {
      logPlaybackEvent("skip_early", song, position, getFiniteAudioDuration(audio));
    }
  }, [logPlaybackEvent, refs]);

  const resetPlaybackState = useCallback((song: Song) => {
    const key = getSongKey(song);
    refs.play30LoggedKey.current = null;
    refs.completeLoggedKey.current = null;
    return key;
  }, [refs]);

  return useMemo(() => ({
    showPlayerNotice, startPlaybackSession, logPlaybackEvent,
    logEarlySkipIfNeeded, resetPlaybackState,
  }), [logEarlySkipIfNeeded, logPlaybackEvent, resetPlaybackState,
    showPlayerNotice, startPlaybackSession]);
};

export type RecommendationPlayback = ReturnType<typeof useRecommendationPlayback>;
