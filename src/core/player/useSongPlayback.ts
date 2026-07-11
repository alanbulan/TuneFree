import { useCallback, useRef } from "react";
import type { AudioQuality, Song } from "../types";
import { executeSongPlayback } from "./songPlaybackController";
import type { AudioLifecycle } from "./useAudioLifecycle";
import type { PlaybackControls } from "./usePlaybackControls";
import type { PlaybackRecovery } from "./usePlaybackRecovery";
import type { PlayerRuntime } from "./usePlayerRuntime";
import type { RecommendationPlayback } from "./useRecommendationPlayback";
import type { SongResolver } from "./useSongResolver";

export const useSongPlayback = (
  runtime: PlayerRuntime,
  audio: AudioLifecycle,
  controls: PlaybackControls,
  recovery: PlaybackRecovery,
  recommendation: RecommendationPlayback,
  resolver: SongResolver,
) => {
  const dependenciesRef = useRef({ runtime, audio, controls, recovery, recommendation, resolver });
  dependenciesRef.current = { runtime, audio, controls, recovery, recommendation, resolver };
  return useCallback(
    (song: Song, forceQuality?: AudioQuality) =>
      executeSongPlayback(dependenciesRef.current, song, forceQuality),
    [],
  );
};
