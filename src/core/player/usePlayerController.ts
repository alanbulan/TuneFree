import { useMemo } from "react";
import type {
  PlayerActions,
  PlayerAnalyser,
  PlayerContextValue,
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
  contextValue: PlayerContextValue;
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

  const nowPlayingValue = useMemo(() => ({
    currentSong: runtime.currentSong,
    isPlaying: runtime.isPlaying,
    isLoading: runtime.isLoading,
  }), [runtime.currentSong, runtime.isLoading, runtime.isPlaying]);
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

  const contextValue = useMemo<PlayerContextValue>(() => ({
    currentSong: runtime.currentSong, isPlaying: runtime.isPlaying,
    isLoading: runtime.isLoading, currentTime: runtime.currentTime,
    duration: runtime.duration, lyricOffsetSeconds: runtime.lyricOffsetSeconds,
    volume: runtime.volume, playMode: runtime.playMode, queue: runtime.queue,
    analyser: runtime.analyser, audioQuality: runtime.audioQuality,
    playerNotice: runtime.playerNotice, ...actionsValue,
  }), [actionsValue, runtime.analyser, runtime.audioQuality, runtime.currentSong,
    runtime.currentTime, runtime.duration, runtime.isLoading, runtime.isPlaying,
    runtime.lyricOffsetSeconds, runtime.playMode, runtime.playerNotice,
    runtime.queue, runtime.volume]);

  return {
    contextValue, actionsValue, nowPlayingValue, queueStateValue,
    settingsValue, analyserValue, progressValue, noticeValue,
  };
};
