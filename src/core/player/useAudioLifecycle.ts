import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Song } from "../types";
import { createManagedAudioElement, detachAudioHandlers } from "./audioElement";
import { getFiniteAudioDuration } from "./playerUtils";
import type { PlaybackRecovery } from "./usePlaybackRecovery";
import type { PlayerRuntime } from "./usePlayerRuntime";
import type { RecommendationPlayback } from "./useRecommendationPlayback";
import type { PlayerRefs } from "./types";

const disposeAudio = (refs: PlayerRefs): void => {
  const audio = refs.audio.current;
  if (audio) {
    audio.pause();
    detachAudioHandlers(audio, refs.handlers.current);
  }
  refs.playAbort.current?.abort();
  refs.preloadAbort.current?.abort();
  if (refs.progressFrame.current !== null) {
    window.cancelAnimationFrame(refs.progressFrame.current);
    refs.progressFrame.current = null;
  }
  if (refs.audioContext.current) void refs.audioContext.current.close();
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
  const { refs, isPlaying, setAnalyser, setCurrentTime, setDuration } = runtime;
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
  }, [refs, setDuration, updateCurrentTimeState]);

  const syncPlaybackTime = useCallback((force = false) => {
    const audio = refs.audio.current;
    if (!audio) return;
    const nextTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    if (force || Math.abs(nextTime - refs.lastProgressTime.current) >= 0.1) {
      updateCurrentTimeState(nextTime);
    }
  }, [refs, updateCurrentTimeState]);

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

  const initAudioContext = useCallback(() => {
    if (refs.isIOS.current || refs.audioContext.current || !refs.audio.current) return;
    try {
      const AudioContextClass = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      const source = context.createMediaElementSource(refs.audio.current);
      source.connect(analyser);
      analyser.connect(context.destination);
      refs.audioContext.current = context;
      refs.sourceNode.current = source;
      refs.audioContextConnected.current = true;
      refs.analyser.current = analyser;
      setAnalyser(analyser);
    } catch (error) {
      console.error("AudioContext 初始化失败，使用模拟可视化", error);
    }
  }, [refs, setAnalyser]);

  useEffect(() => {
    const handleVisibility = () => {
      const context = refs.audioContext.current;
      if (document.visibilityState === "visible" && context?.state === "suspended") {
        void context.resume();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [refs]);

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
    initAudioContext, updateCurrentTimeState, updateMediaSession, updatePositionState,
  }), [clearActiveAudioSource, createAudioElement, initAudioContext, syncPlaybackTime,
    updateCurrentTimeState, updateMediaSession, updatePositionState]);
};

export type AudioLifecycle = ReturnType<typeof useAudioLifecycle>;
