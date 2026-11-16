import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Song } from "../types";
import { createManagedAudioElement, detachAudioHandlers } from "./audioElement";
import { getFiniteAudioDuration } from "./playerUtils";
import type { PlaybackRecovery } from "./usePlaybackRecovery";
import type { PlayerRuntime } from "./usePlayerRuntime";
import type { RecommendationPlayback } from "./useRecommendationPlayback";
import type { PlayerRefs } from "./types";
import { canAnalyseMediaUrl } from '../services/playbackMediaUrl';

const disposeAudio = (refs: PlayerRefs): void => {
  const audio = refs.audio.current;
  if (audio) {
    audio.pause();
    detachAudioHandlers(audio, refs.handlers.current);
    audio.removeAttribute("src");
    audio.load();
    refs.audio.current = null;
    refs.handlers.current = null;
  }
  refs.playAbort.current?.abort();
  refs.preloadAbort.current?.abort();
  if (refs.progressFrame.current !== null) {
    window.cancelAnimationFrame(refs.progressFrame.current);
    refs.progressFrame.current = null;
  }
  if (refs.audioContext.current) void refs.audioContext.current.close().catch(() => {});
  refs.audioContext.current = null;
  refs.sourceNode.current = null;
  refs.analyser.current = null;
  refs.audioContextConnected.current = false;
};

const cancelProgressFrame = (refs: PlayerRefs): void => {
  if (refs.progressFrame.current === null) return;
  window.cancelAnimationFrame(refs.progressFrame.current);
  refs.progressFrame.current = null;
};

export const useAudioLifecycle = (
  runtime: PlayerRuntime,
  recommendation: RecommendationPlayback,
  recovery: PlaybackRecovery,
) => {
  const { refs, isPlaying, setAnalyser, setCurrentTime, setDuration, setPlaybackOrigin } = runtime;
  const dependenciesRef = useRef({ runtime, recommendation, recovery });
  dependenciesRef.current = { runtime, recommendation, recovery };
  const updateCurrentTimeState = useCallback((time: number) => {
    const nextTime = Number.isFinite(time) ? Math.max(0, time) : 0;
    refs.lastProgressTime.current = nextTime;
    setCurrentTime(nextTime);
  }, [refs, setCurrentTime]);

  const clearActiveAudioSource = useCallback(() => {
    const audio = refs.audio.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    updateCurrentTimeState(0);
    setDuration(0);
    setPlaybackOrigin(null);
  }, [refs, setDuration, setPlaybackOrigin, updateCurrentTimeState]);

  const syncPlaybackTime = useCallback((force = false) => {
    const audio = refs.audio.current;
    if (!audio) return;
    const nextTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    if (force || Math.abs(nextTime - refs.lastProgressTime.current) >= 0.1) {
      updateCurrentTimeState(nextTime);
    }
  }, [refs, updateCurrentTimeState]);

  const getPlaybackClock = useCallback(() => {
    const audio = refs.audio.current;
    return {
      currentTime: audio && Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0,
      playbackRate: audio && Number.isFinite(audio.playbackRate) && audio.playbackRate > 0 ? audio.playbackRate : 1,
      advancing: !!audio && !audio.paused && !audio.ended && !audio.seeking && audio.readyState >= 3,
    };
  }, [refs]);

  const createAudioElement = useCallback((withCors: boolean) =>
    createManagedAudioElement({
      withCors, ...dependenciesRef.current,
      clearActiveAudioSource, syncPlaybackTime,
    }), [clearActiveAudioSource, syncPlaybackTime]);

  useEffect(() => {
    createAudioElement(false);
    return () => disposeAudio(refs);
    // Audio 元素只在 Provider 生命周期内初始化一次，重建由播放源策略显式触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restorePlainAudio = useCallback((media: HTMLAudioElement): HTMLAudioElement => {
    const settings = { src: media.src, time: media.currentTime, volume: media.volume,
      muted: media.muted, playbackRate: media.playbackRate };
    const replacement = createAudioElement(false);
    replacement.volume = settings.volume;
    replacement.muted = settings.muted;
    if (settings.src && settings.src !== window.location.href) {
      replacement.src = settings.src;
      replacement.load();
      if (Number.isFinite(settings.time) && settings.time > 0) {
        try { replacement.currentTime = settings.time; }
        catch {
          replacement.addEventListener('loadedmetadata', () => {
            if (refs.audio.current === replacement && replacement.src === settings.src) replacement.currentTime = settings.time;
          }, { once: true });
        }
      }
    }
    // HTMLMediaElement.load() 会复位 playbackRate；必须在载入源之后恢复真实倍速。
    replacement.playbackRate = settings.playbackRate;
    return replacement;
  }, [createAudioElement, refs]);

  const initAudioContext = useCallback(() => {
    if (refs.isIOS.current || refs.audioContext.current || !refs.audio.current) return;
    // 没有 CORS 的跨域媒体接入 Web Audio 会被规范强制静音，不能为了频谱破坏播放。
    if (!refs.audio.current.crossOrigin && !canAnalyseMediaUrl(refs.audio.current.src)) return;
    let context: AudioContext | undefined;
    const media = refs.audio.current;
    let boundToContext = false;
    try {
      const AudioContextClass = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      context = new AudioContextClass();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.7;
      const source = context.createMediaElementSource(media);
      boundToContext = true;
      source.connect(analyser);
      analyser.connect(context.destination);
      refs.audioContext.current = context;
      refs.sourceNode.current = source;
      refs.audioContextConnected.current = true;
      refs.analyser.current = analyser;
      setAnalyser(analyser);
    } catch (error) {
      // 已绑定 MediaElementSource 的元素不能从关闭的 context 脱离；更换元素恢复普通播放。
      void context?.close().catch(() => {});
      if (boundToContext) restorePlainAudio(media);
      console.warn("音频分析不可用，频谱已停止，普通播放仍可使用", error);
    }
  }, [refs, setAnalyser, restorePlainAudio]);

  const resumeAudioContext = useCallback(async (): Promise<HTMLAudioElement | null> => {
    const media = refs.audio.current, context = refs.audioContext.current;
    if (!media || !context || context.state === 'running') return media;
    const requestId = refs.playRequestId.current;
    let timer = 0;
    try {
      if (context.state !== 'closed') await Promise.race([
        context.resume(),
        new Promise<void>((resolve) => { timer = window.setTimeout(resolve, 1000); }),
      ]);
    } catch (error) { console.warn('恢复音频分析失败，改用普通播放', error); }
    finally { window.clearTimeout(timer); }
    // 恢复期间切歌/关闭播放器的响应不可再替换新元素。
    if (refs.audio.current !== media || refs.audioContext.current !== context
      || refs.playRequestId.current !== requestId) return null;
    if (String(context.state) === 'running') return media;
    console.warn('当前环境无法恢复音频分析，已停止频谱并保留普通播放');
    return restorePlainAudio(media);
  }, [refs, restorePlainAudio]);

  useEffect(() => {
    const handleVisibility = async () => {
      const context = refs.audioContext.current;
      if (document.visibilityState === "visible" && context && ['suspended', 'interrupted'].includes(context.state)) {
        const wasPlaying = refs.audio.current && !refs.audio.current.paused;
        const previous = refs.audio.current;
        const media = await resumeAudioContext();
        if (wasPlaying && media && media !== previous && refs.audio.current === media) {
          void media.play().catch((error: unknown) => console.warn('恢复普通播放失败', error));
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [refs, resumeAudioContext]);

  const updateMediaSession = useCallback((song: Song | null, state: "playing" | "paused") => {
    if (!("mediaSession" in navigator) || !song) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.name, artist: song.artist, album: song.album || "TuneFree Music",
      artwork: song.pic ? [96, 128, 192, 256, 384, 512].map((size) => ({
        src: song.pic as string, sizes: `${size}x${size}`, type: "image/jpeg",
      })) : [],
    });
    navigator.mediaSession.playbackState = state;
  }, []);

  const updatePositionState = useCallback(() => {
    const audio = refs.audio.current;
    if (!("mediaSession" in navigator) || !audio) return;
    const duration = getFiniteAudioDuration(audio);
    if (duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration, playbackRate: audio.playbackRate, position: audio.currentTime,
      });
    } catch {
      // 元数据未就绪时忽略位置同步。
    }
  }, [refs]);

  useEffect(() => {
    if (!isPlaying) {
      cancelProgressFrame(refs);
      syncPlaybackTime(true);
      return;
    }
    const tick = () => {
      syncPlaybackTime();
      refs.progressFrame.current = window.requestAnimationFrame(tick);
    };
    refs.progressFrame.current = window.requestAnimationFrame(tick);
    return () => cancelProgressFrame(refs);
  }, [isPlaying, refs, syncPlaybackTime]);

  return useMemo(() => ({
    clearActiveAudioSource, syncPlaybackTime, createAudioElement,
    initAudioContext, resumeAudioContext, updateCurrentTimeState, updateMediaSession, updatePositionState, getPlaybackClock,
  }), [clearActiveAudioSource, createAudioElement, initAudioContext, syncPlaybackTime,
    resumeAudioContext, updateCurrentTimeState, updateMediaSession, updatePositionState, getPlaybackClock]);
};

export type AudioLifecycle = ReturnType<typeof useAudioLifecycle>;
