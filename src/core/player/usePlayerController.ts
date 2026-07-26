import { useMemo } from "react";
import { NEAR_END_PROGRESS_RATIO } from "./playerUtils";
import type {
  PlayerActions,
  PlayerAnalyser,
  PlayerNoticeState,
  PlayerNowPlaying,
  PlayerProgress,
  PlayerQueueState,
  PlayerSettings,
} from "./types";
import { useAudioLifecycle } from "./useAudioLifecycle";
import { useLyricRefresh } from "./useLyricRefresh";
import { usePlaybackControls } from "./usePlaybackControls";
import { usePlaybackRecovery } from "./usePlaybackRecovery";
import { usePlayerRuntime } from "./usePlayerRuntime";
import { usePlayerSettingsActions } from "./usePlayerSettingsActions";
import { useQueueControls } from "./useQueueControls";
import { useRecommendationPlayback } from "./useRecommendationPlayback";
import { useSongPlayback } from "./useSongPlayback";
import { useSongResolver } from "./useSongResolver";

export interface PlayerController {
  actionsValue: PlayerActions;
  nowPlayingValue: PlayerNowPlaying;
  queueStateValue: PlayerQueueState;
  settingsValue: PlayerSettings;
  analyserValue: PlayerAnalyser;
  progressValue: PlayerProgress;
  noticeValue: PlayerNoticeState;
}

export const usePlayerController = (): PlayerController => {
  const runtime = usePlayerRuntime();
  useLyricRefresh(runtime);
  const recommendation = useRecommendationPlayback(runtime);
  const recovery = usePlaybackRecovery(runtime, recommendation);
  const audio = useAudioLifecycle(runtime, recommendation, recovery);
  const resolver = useSongResolver(runtime);
  const playback = usePlaybackControls(runtime, audio, resolver, recommendation, recovery);
  const playSong = useSongPlayback(runtime, audio, playback, recovery, recommendation, resolver);
  runtime.refs.playSong.current = playSong;
  const queue = useQueueControls(runtime, audio, playback, recommendation, resolver);
  const settings = usePlayerSettingsActions(runtime, recommendation);

  const actionsValue = useMemo<PlayerActions>(() => ({
    playSong, playQueue: queue.playQueue, togglePlay: playback.togglePlay,
    pausePlayback: playback.pausePlayback, resumePlayback: playback.resumePlayback,
    seek: playback.seek, setLyricOffsetSeconds: settings.setLyricOffsetSeconds,
    adjustLyricOffsetSeconds: settings.adjustLyricOffsetSeconds,
    playNext: queue.playNext, playPrev: queue.playPrev, addToQueue: queue.addToQueue,
    removeFromQueue: queue.removeFromQueue, togglePlayMode: queue.togglePlayMode,
    clearQueue: queue.clearQueue, setAudioQuality: settings.setAudioQuality,
    initAudioContext: audio.initAudioContext,
  }), [audio.initAudioContext, playSong, playback, queue, settings]);

  // 布尔量而不是进度本身进入低频 context，翻转时才会触发订阅方重渲染。
  const isNearEnd = runtime.duration > 0 &&
    runtime.currentTime / runtime.duration > NEAR_END_PROGRESS_RATIO;
  const nowPlayingValue = useMemo<PlayerNowPlaying>(() => ({
    currentSong: runtime.currentSong,
    isPlaying: runtime.isPlaying,
    isLoading: runtime.isLoading,
    isNearEnd,
  }), [isNearEnd, runtime.currentSong, runtime.isLoading, runtime.isPlaying]);
  const queueStateValue = useMemo(() => ({
    queue: runtime.queue, playMode: runtime.playMode,
  }), [runtime.playMode, runtime.queue]);
  const settingsValue = useMemo(() => ({ audioQuality: runtime.audioQuality }),
    [runtime.audioQuality]);
  const analyserValue = useMemo(() => ({ analyser: runtime.analyser }), [runtime.analyser]);
  const progressValue = useMemo(() => ({
    currentTime: runtime.currentTime,
    duration: runtime.duration,
    lyricOffsetSeconds: runtime.lyricOffsetSeconds,
  }), [runtime.currentTime, runtime.duration, runtime.lyricOffsetSeconds]);
  const noticeValue = useMemo(() => ({ playerNotice: runtime.playerNotice }),
    [runtime.playerNotice]);

  return {
    actionsValue, nowPlayingValue, queueStateValue,
    settingsValue, analyserValue, progressValue, noticeValue,
  };
};
