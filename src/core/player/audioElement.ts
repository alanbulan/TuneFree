import { getSongKey } from "../types";
import {
  getFiniteAudioDuration,
  getMediaErrorSummary,
  MEDIA_ERR_SRC_NOT_SUPPORTED_CODE,
} from "./playerUtils";
import { notifyLyricTimelineMismatch } from "./songMetadata";
import type { AudioHandlers } from "./types";
import type { PlaybackRecovery } from "./usePlaybackRecovery";
import type { PlayerRuntime } from "./usePlayerRuntime";
import type { RecommendationPlayback } from "./useRecommendationPlayback";

interface CreateAudioOptions {
  withCors: boolean;
  runtime: PlayerRuntime;
  recommendation: RecommendationPlayback;
  recovery: PlaybackRecovery;
  clearActiveAudioSource: () => void;
  syncPlaybackTime: (force?: boolean) => void;
}

export const detachAudioHandlers = (
  audio: HTMLAudioElement,
  handlers: AudioHandlers | null,
): void => {
  if (!handlers) return;
  audio.removeEventListener("timeupdate", handlers.timeupdate);
  audio.removeEventListener("loadedmetadata", handlers.loadedmetadata);
  audio.removeEventListener("durationchange", handlers.durationchange);
  audio.removeEventListener("ended", handlers.ended);
  audio.removeEventListener("error", handlers.error);
  audio.removeEventListener("waiting", handlers.waiting);
  audio.removeEventListener("canplay", handlers.canplay);
};

const resetAudioContext = (runtime: PlayerRuntime): void => {
  const { refs, setAnalyser } = runtime;
  if (!refs.audioContext.current) return;
  void refs.audioContext.current.close().catch(() => {});
  refs.audioContext.current = null;
  refs.sourceNode.current = null;
  refs.audioContextConnected.current = false;
  refs.analyser.current = null;
  setAnalyser(null);
};

const syncMediaPosition = (audio: HTMLAudioElement, runtime: PlayerRuntime): number => {
  const duration = getFiniteAudioDuration(audio);
  if (duration > 0) runtime.setDuration(duration);
  if (!("mediaSession" in navigator) || duration <= 0) return duration;
  try {
    navigator.mediaSession.setPositionState({
      duration, playbackRate: audio.playbackRate, position: audio.currentTime,
    });
  } catch {
    // 浏览器可能在元数据未完全就绪时拒绝位置更新。
  }
  return duration;
};

const handleAudioFailure = (
  audio: HTMLAudioElement,
  options: CreateAudioOptions,
): void => {
  const { runtime, recommendation, recovery, clearActiveAudioSource } = options;
  const { refs, setIsLoading, setIsPlaying } = runtime;
  const song = refs.currentSong.current;
  const isSourceError = audio.error?.code === MEDIA_ERR_SRC_NOT_SUPPORTED_CODE;
  console.error(`Audio Element Error: Code=${audio.error?.code}, Msg=${audio.error?.message}`);

  if (isSourceError && song && !refs.forceNoCorsPlayback.current && refs.retryCount.current === 0) {
    recommendation.showPlayerNotice("当前音源不支持频谱解析，已切换兼容播放模式", "warning");
    refs.forceNoCorsPlayback.current = true;
    refs.retryCount.current = 1;
    void refs.playSong.current(song, refs.activeQuality.current);
    return;
  }
  if (song && recovery.retryCachedSongResolution(song, refs.activeQuality.current)) return;
  if (song && refs.activeQuality.current !== "128k" && refs.retryCount.current <= 1) {
    recommendation.showPlayerNotice("当前音质不可播放，已尝试切换到 128K", "warning");
    refs.retryCount.current = 2;
    void refs.playSong.current(song, "128k");
    return;
  }
  recovery.evictActiveParsedSong();
  if (song && recovery.playNextRecommendationAfterFailure(song)) return;
  console.error(
    isSourceError ? "Playback source is not supported." : "Playback failed.",
    getMediaErrorSummary(audio.error),
  );
  clearActiveAudioSource();
  recommendation.showPlayerNotice("这首歌暂时无法播放，请换源或稍后再试", "error");
  setIsLoading(false);
  setIsPlaying(false);
  refs.retryCount.current = 0;
};

const createHandlers = (
  audio: HTMLAudioElement,
  options: CreateAudioOptions,
): AudioHandlers => {
  const { runtime, recommendation, syncPlaybackTime } = options;
  const { refs, setIsLoading } = runtime;
  return {
    timeupdate: () => {
      syncPlaybackTime(true);
      const duration = syncMediaPosition(audio, runtime);
      const song = refs.currentSong.current;
      if (!song) return;
      const key = getSongKey(song);
      const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      if (position >= 30 && refs.play30LoggedKey.current !== key) {
        refs.play30LoggedKey.current = key;
        recommendation.logPlaybackEvent("play_30s", song, position, duration);
      }
      if (duration > 0 && position / duration >= 0.8 && refs.completeLoggedKey.current !== key) {
        refs.completeLoggedKey.current = key;
        recommendation.logPlaybackEvent("play_complete", song, position, duration);
      }
    },
    loadedmetadata: () => {
      syncPlaybackTime(true);
      const duration = syncMediaPosition(audio, runtime);
      const song = refs.currentSong.current;
      if (song) notifyLyricTimelineMismatch(runtime, song, song.lrc || "", duration);
      setIsLoading(false);
      refs.retryCount.current = 0;
    },
    durationchange: () => {
      const duration = syncMediaPosition(audio, runtime);
      const song = refs.currentSong.current;
      if (song) notifyLyricTimelineMismatch(runtime, song, song.lrc || "", duration);
    },
    ended: () => {
      const song = refs.currentSong.current;
      if (song && refs.completeLoggedKey.current !== getSongKey(song)) {
        refs.completeLoggedKey.current = getSongKey(song);
        const duration = getFiniteAudioDuration(audio);
        recommendation.logPlaybackEvent("play_complete", song, duration, duration);
      }
      refs.playNext.current?.(false);
    },
    error: () => handleAudioFailure(audio, options),
    waiting: () => setIsLoading(true),
    canplay: () => setIsLoading(false),
  };
};

export const createManagedAudioElement = (options: CreateAudioOptions): HTMLAudioElement => {
  const { runtime, withCors } = options;
  const { refs } = runtime;
  const oldAudio = refs.audio.current;
  if (oldAudio) {
    oldAudio.pause();
    oldAudio.removeAttribute("src");
    detachAudioHandlers(oldAudio, refs.handlers.current);
  }
  resetAudioContext(runtime);

  const audio = new Audio();
  audio.preload = "auto";
  (audio as HTMLAudioElement & { playsInline: boolean }).playsInline = true;
  if (withCors) audio.crossOrigin = "anonymous";
  const handlers = createHandlers(audio, options);
  audio.addEventListener("timeupdate", handlers.timeupdate);
  audio.addEventListener("loadedmetadata", handlers.loadedmetadata);
  audio.addEventListener("durationchange", handlers.durationchange);
  audio.addEventListener("ended", handlers.ended);
  audio.addEventListener("error", handlers.error);
  audio.addEventListener("waiting", handlers.waiting);
  audio.addEventListener("canplay", handlers.canplay);
  refs.handlers.current = handlers;
  refs.audio.current = audio;
  return audio;
};
