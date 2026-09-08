import { getSongKey, isSameSong } from "../types";
import type { AudioQuality, Song } from "../types";
import {
  getFiniteAudioDuration,
  isAbortError,
  isUnsupportedSourcePlayError,
  shouldUseCors,
} from "./playerUtils";
import { applyParsedMetadata } from "./songMetadata";
import type { AudioLifecycle } from "./useAudioLifecycle";
import type { PlaybackControls } from "./usePlaybackControls";
import type { PlaybackRecovery } from "./usePlaybackRecovery";
import type { PlayerRuntime } from "./usePlayerRuntime";
import type { RecommendationPlayback } from "./useRecommendationPlayback";
import type { SongResolver } from "./useSongResolver";

export interface SongPlaybackDependencies {
  runtime: PlayerRuntime;
  audio: AudioLifecycle;
  controls: PlaybackControls;
  recovery: PlaybackRecovery;
  recommendation: RecommendationPlayback;
  resolver: SongResolver;
}

interface PlaybackRequest {
  requestId: number;
  targetQuality: AudioQuality;
  isCurrentSong: boolean;
  isDifferentQuality: boolean;
  fullSong: Song;
  signal: AbortSignal;
}

const reuseCurrentPlayback = async (
  dependencies: SongPlaybackDependencies,
  song: Song,
  forceQuality?: AudioQuality,
): Promise<boolean> => {
  const { runtime, audio, controls, resolver } = dependencies;
  const isCurrent = isSameSong(runtime.refs.currentSong.current, song);
  const targetQuality = forceQuality || runtime.refs.audioQuality.current;
  if (!isCurrent || targetQuality !== runtime.refs.activeQuality.current || forceQuality) return false;
  const activeAudio = runtime.refs.audio.current;
  if (!activeAudio?.src || activeAudio.src === window.location.href) return false;
  if (activeAudio.paused) {
    await controls.resumePlayback();
  } else {
    runtime.setIsPlaying(true);
    runtime.setIsLoading(false);
    audio.updateMediaSession(runtime.refs.currentSong.current, "playing");
    resolver.preloadNextSong(song);
  }
  return true;
};

const beginPlaybackRequest = (
  dependencies: SongPlaybackDependencies,
  song: Song,
  forceQuality?: AudioQuality,
): PlaybackRequest => {
  const { runtime, audio, recommendation } = dependencies;
  const { refs } = runtime;
  const targetQuality = forceQuality || refs.audioQuality.current;
  if (!forceQuality || targetQuality === refs.audioQuality.current) {
    refs.pendingQualityChange.current = false;
  }
  const isCurrentSong = isSameSong(refs.currentSong.current, song);
  if (!forceQuality) {
    recommendation.startPlaybackSession();
    refs.refreshedCacheKeys.current.clear();
    if (refs.failedRecommendationRequestId.current !== song.recommendationRequestId) {
      refs.failedRecommendationRequestId.current = song.recommendationRequestId || null;
      refs.failedRecommendationSongKeys.current.clear();
    }
    refs.failedRecommendationSongKeys.current.delete(getSongKey(song));
  }
  const requestId = ++refs.playRequestId.current;
  // 快速切歌时旧的解析链路必须真正中止，否则会继续占用网络并写回过期结果。
  refs.playAbort.current?.abort();
  const controller = new AbortController();
  refs.playAbort.current = controller;
  refs.lyricBindings.current.clear();
  runtime.setIsLoading(true);
  if (!forceQuality) refs.recoveryStage.current = "initial";
  if (!isCurrentSong && refs.audio.current) {
    refs.forceNoCorsPlayback.current = false;
    refs.activeParsedCacheKey.current = null;
    refs.audio.current.pause();
    refs.audio.current.removeAttribute("src");
    refs.audio.current.load();
    runtime.setIsPlaying(false);
    audio.updateCurrentTimeState(0);
    runtime.setDuration(0);
  }
  const fullSong = { ...song };
  runtime.commitCurrentSong(fullSong);
  runtime.commitQueue((previous) => previous.some((queued) => isSameSong(queued, song))
    ? previous : [...previous, fullSong]);
  return { requestId, targetQuality, isCurrentSong, signal: controller.signal,
    isDifferentQuality: isCurrentSong && targetQuality !== refs.activeQuality.current, fullSong };
};

const configureAudioSource = (
  dependencies: SongPlaybackDependencies,
  request: PlaybackRequest,
  url: string,
  cacheKey: string | null,
): HTMLAudioElement | null => {
  const { runtime, audio } = dependencies;
  const { refs } = runtime;
  const resumeTime = request.isCurrentSong && request.isDifferentQuality
    ? refs.audio.current?.currentTime || 0 : 0;
  const needsCors = !refs.forceNoCorsPlayback.current && shouldUseCors(url);
  if (refs.isIOS.current || !needsCors) {
    if (refs.audioContextConnected.current || refs.audio.current?.crossOrigin) {
      audio.createAudioElement(false);
    }
  } else {
    if (!refs.audioContextConnected.current) audio.createAudioElement(true);
    audio.initAudioContext();
  }
  const activeAudio = refs.audio.current;
  if (!activeAudio) return null;
  refs.activeQuality.current = request.targetQuality;
  refs.activeParsedCacheKey.current = cacheKey;
  activeAudio.src = url;
  activeAudio.load();
  if (resumeTime > 0) activeAudio.currentTime = resumeTime;
  if (refs.audioContext.current?.state === "suspended") {
    void refs.audioContext.current.resume().catch((error: unknown) => console.warn('恢复音频上下文失败', error));
  }
  return activeAudio;
};

const handlePlayError = (
  dependencies: SongPlaybackDependencies,
  song: Song,
  quality: AudioQuality,
  error: unknown,
): void => {
  const { runtime, audio, recovery, recommendation } = dependencies;
  const { refs } = runtime;
  if (isAbortError(error)) return;
  if (error instanceof Error && error.name === "NotAllowedError") {
    recommendation.showPlayerNotice("播放被浏览器阻止，请再次点击播放", "warning");
    runtime.setIsPlaying(false);
    runtime.setIsLoading(false);
    return;
  }
  recovery.runRecovery({
    song, quality, trigger: "playRejected",
    canRetryWithoutCors: isUnsupportedSourcePlayError(error) &&
      !refs.forceNoCorsPlayback.current,
    onGiveUp: () => {
      audio.clearActiveAudioSource();
      recommendation.showPlayerNotice("播放失败，请稍后再试", "error");
      runtime.setIsPlaying(false);
      runtime.setIsLoading(false);
    },
  });
};

const startResolvedAudio = async (
  dependencies: SongPlaybackDependencies,
  request: PlaybackRequest,
  cacheKey: string | null,
): Promise<void> => {
  const { runtime, audio, recommendation, resolver } = dependencies;
  const { refs } = runtime;
  const url = request.fullSong.url;
  if (!url) return;
  const activeAudio = configureAudioSource(dependencies, request, url, cacheKey);
  if (!activeAudio) return;
  try {
    await activeAudio.play();
    if (request.requestId !== refs.playRequestId.current) return;
    recommendation.resetPlaybackState(request.fullSong);
    audio.syncPlaybackTime(true);
    runtime.setIsPlaying(true);
    runtime.setIsLoading(false);
    audio.updateMediaSession(request.fullSong, "playing");
    resolver.preloadNextSong(request.fullSong);
    recommendation.logPlaybackEvent(
      "play_start", request.fullSong, 0,
      getFiniteAudioDuration(activeAudio), request.targetQuality,
    );
  } catch (error: unknown) {
    if (request.requestId === refs.playRequestId.current) {
      handlePlayError(dependencies, request.fullSong, request.targetQuality, error);
    }
  }
};

const handleMissingUrl = (
  dependencies: SongPlaybackDependencies,
  song: Song,
  quality: AudioQuality,
): void => {
  const { runtime, audio, recovery, recommendation } = dependencies;
  console.error(`No valid URL for ${song.name} [${quality}]`);
  recovery.runRecovery({
    song, quality, trigger: "missingUrl", canRetryWithoutCors: false,
    onGiveUp: () => {
      audio.clearActiveAudioSource();
      recommendation.showPlayerNotice("这首歌暂时无法播放，请换源或稍后再试", "error");
      runtime.setIsLoading(false);
      runtime.setIsPlaying(false);
    },
  });
};

export const executeSongPlayback = async (
  dependencies: SongPlaybackDependencies,
  song: Song,
  forceQuality?: AudioQuality,
): Promise<void> => {
  if (!dependencies.runtime.refs.audio.current) return;
  if (await reuseCurrentPlayback(dependencies, song, forceQuality)) return;
  const request = beginPlaybackRequest(dependencies, song, forceQuality);
  try {
    const resolution = await dependencies.resolver.resolveParsedSong(
      song, request.targetQuality, {
        signal: request.signal,
        ...(forceQuality && dependencies.runtime.refs.refreshedCacheKeys.current.has(
          `${getSongKey(song)}:${request.targetQuality}`,
        ) ? { forceRefresh: true } : {}),
      },
    );
    if (request.requestId !== dependencies.runtime.refs.playRequestId.current ||
        !isSameSong(dependencies.runtime.refs.currentSong.current, song)) return;
    request.fullSong = applyParsedMetadata(
      dependencies.runtime, song, request.fullSong, resolution.parsed,
    );
    if (resolution.parsed?.url) {
      await startResolvedAudio(dependencies, request, resolution.cacheKey);
    } else {
      handleMissingUrl(dependencies, song, request.targetQuality);
    }
  } catch (error) {
    if (isAbortError(error)) return;
    if (request.requestId === dependencies.runtime.refs.playRequestId.current) {
      dependencies.runtime.setIsLoading(false);
      dependencies.runtime.setIsPlaying(false);
      dependencies.recovery.evictActiveParsedSong();
      if (!dependencies.recovery.playNextRecommendationAfterFailure(song)) {
        dependencies.audio.clearActiveAudioSource();
      }
    }
    console.error("Error in playSong", error);
  }
};
