import { useCallback, useLayoutEffect, useRef } from "react";
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
  useLayoutEffect(() => {
    dependenciesRef.current = { runtime, audio, controls, recovery, recommendation, resolver };
  }, [runtime, audio, controls, recovery, recommendation, resolver]);
  const playSong = useCallback(
    (song: Song, forceQuality?: AudioQuality) =>
      executeSongPlayback(dependenciesRef.current, song, forceQuality),
    [],
  );
  const playSongRef = runtime.refs.playSong;
  // oxlint-disable-next-line react/refs -- 依赖是回调和 ref 对象；current 只在提交后的布局 effect 中写入。
  useLayoutEffect(() => { playSongRef.current = playSong; }, [playSong, playSongRef]);
  return playSong;
};
