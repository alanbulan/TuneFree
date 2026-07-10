import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  Song,
  PlayMode,
  AudioQuality,
  getSongKey,
  isSameSong,
} from "../types";
import { getLyrics, parseSongFull } from "../services/api";
import { resolveOfflinePlayback } from "../services/offlineDownloads";
import { logRecommendationEvent } from "../services/recommendation";
import {
  loadStoredAudioQuality,
  loadStoredCurrentSong,
  loadStoredPlayMode,
  loadStoredQueue,
  persistAudioQuality,
  persistCurrentSong,
  persistPlayMode,
  persistQueue,
} from "./playerPersistence";
import {
  getNextQueueIndex,
  getNextRecommendationCandidateIndex,
  getPrevQueueIndex,
} from "./playerQueue";
import { hasTranslatedLyrics, parseLyrics, supportsTranslatedLyricFallback } from "../utils/lyrics";
import { LYRIC_DISPLAY_MODE_CHANGE_EVENT } from "../utils/lyricDisplayMode";

export interface PlayerNotice {
  id: number;
  tone: "info" | "success" | "warning" | "error";
  message: string;
}

interface PlayerContextType {
  currentSong: Song | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  lyricOffsetSeconds: number;
  volume: number;
  playMode: PlayMode;
  queue: Song[];
  analyser: AnalyserNode | null;
  audioQuality: AudioQuality;
  playerNotice: PlayerNotice | null;
  playSong: (song: Song, forceQuality?: AudioQuality) => Promise<void>;
  playQueue: (songs: Song[], startSong?: Song) => Promise<void>;
  togglePlay: () => void;
  pausePlayback: () => void;
  resumePlayback: () => Promise<void>;
  seek: (time: number) => void;
  setLyricOffsetSeconds: (offset: number) => void;
  adjustLyricOffsetSeconds: (delta: number) => void;
  playNext: (force?: boolean) => void;
  playPrev: () => void;
  addToQueue: (song: Song) => void;
  removeFromQueue: (songId: string | number, source?: string) => void;
  togglePlayMode: () => void;
  clearQueue: () => void;
  setAudioQuality: (quality: AudioQuality) => void;
  initAudioContext: () => void;
}

type PlayerActionsType = Pick<
  PlayerContextType,
  | "playSong"
  | "playQueue"
  | "togglePlay"
  | "pausePlayback"
  | "resumePlayback"
  | "seek"
  | "setLyricOffsetSeconds"
  | "adjustLyricOffsetSeconds"
  | "playNext"
  | "playPrev"
  | "addToQueue"
  | "removeFromQueue"
  | "togglePlayMode"
  | "clearQueue"
  | "setAudioQuality"
  | "initAudioContext"
>;

type PlayerNowPlayingType = Pick<
  PlayerContextType,
  "currentSong" | "isPlaying" | "isLoading"
>;

type PlayerQueueStateType = Pick<PlayerContextType, "queue" | "playMode">;

type PlayerSettingsType = Pick<PlayerContextType, "audioQuality">;

type PlayerAnalyserType = Pick<PlayerContextType, "analyser">;

type PlayerProgressType = Pick<PlayerContextType, "currentTime" | "duration" | "lyricOffsetSeconds">;
type PlayerNoticeContextType = Pick<PlayerContextType, "playerNotice">;

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);
const PlayerActionsContext =
  createContext<PlayerActionsType | undefined>(undefined);
const PlayerNowPlayingContext =
  createContext<PlayerNowPlayingType | undefined>(undefined);
const PlayerQueueStateContext =
  createContext<PlayerQueueStateType | undefined>(undefined);
const PlayerSettingsContext =
  createContext<PlayerSettingsType | undefined>(undefined);
const PlayerAnalyserContext =
  createContext<PlayerAnalyserType | undefined>(undefined);
const PlayerProgressContext =
  createContext<PlayerProgressType | undefined>(undefined);
const PlayerNoticeContext =
  createContext<PlayerNoticeContextType | undefined>(undefined);

type ParsedSongData = NonNullable<Awaited<ReturnType<typeof parseSongFull>>>;
type ParsedSongCacheEntry = {
  data: ParsedSongData;
  expiresAt: number;
};
type ParsedSongResolution = {
  parsed: ParsedSongData | null;
  cacheKey: string | null;
};

const PARSED_SONG_CACHE_TTL_MS = 10 * 60 * 1000;

const createPlaybackSessionId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `playback:${crypto.randomUUID()}`;
  }
  return `playback:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const getFiniteAudioDuration = (audio: HTMLAudioElement): number =>
  Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;

const MEDIA_ERR_SRC_NOT_SUPPORTED_CODE = 4;

const getMediaErrorSummary = (error: MediaError | null | undefined) => ({
  code: error?.code ?? 0,
  message: error?.message || "",
});

const isUnsupportedSourcePlayError = (error: unknown): boolean => {
  if (error instanceof Error) {
    return error.name === "NotSupportedError" ||
      String(error.message || "").toLowerCase().includes("source");
  }
  return false;
};

const getLyricStats = (lrc?: string) => {
  const rows = parseLyrics(lrc);
  return {
    hasRows: rows.length > 0,
    hasTranslation: hasTranslatedLyrics(rows),
    hasTimedWords: rows.some((row) => (row.words?.length || 0) > 1),
  };
};

const shouldUseLyricCandidate = (existingLrc?: string, candidateLrc?: string): boolean => {
  if (!candidateLrc?.trim() || candidateLrc === existingLrc) return false;

  const candidateStats = getLyricStats(candidateLrc);
  if (!candidateStats.hasRows) return false;

  const existingStats = getLyricStats(existingLrc);
  if (!existingStats.hasRows) return true;
  if (!existingStats.hasTimedWords && candidateStats.hasTimedWords) return true;
  return !existingStats.hasTranslation && candidateStats.hasTranslation;
};

const TIMED_WORD_LYRIC_SOURCES = new Set(["netease", "qq", "kuwo", "joox", "bilibili", "embeat"]);

const supportsTimedWordLyricFallback = (source?: string): boolean =>
  !!source && TIMED_WORD_LYRIC_SOURCES.has(source);

const shouldFetchBetterLyrics = (song: Pick<Song, "source">, lrc?: string): boolean => {
  const stats = getLyricStats(lrc);
  if (!stats.hasRows) return true;

  const needsTimedWords =
    supportsTimedWordLyricFallback(song.source) && !stats.hasTimedWords;
  const needsTranslation =
    supportsTranslatedLyricFallback(song.source) && !stats.hasTranslation;

  return needsTimedWords || needsTranslation;
};

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Initialize state from LocalStorage where appropriate
  const [currentSong, setCurrentSong] = useState<Song | null>(() =>
    loadStoredCurrentSong(),
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [lyricOffsetSeconds, setLyricOffsetSecondsState] = useState(0);
  const [volume] = useState(1);
  const [queue, setQueue] = useState<Song[]>(() => loadStoredQueue());
  const [playMode, setPlayMode] = useState<PlayMode>(() => loadStoredPlayMode());
  const [audioQuality, setAudioQualityState] = useState<AudioQuality>(() =>
    loadStoredAudioQuality(),
  );
  const [playerNotice, setPlayerNotice] = useState<PlayerNotice | null>(null);
  const [lyricRefreshNonce, setLyricRefreshNonce] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  // 标记当前 Audio 是否已被 AudioContext 接管路由（一旦接管，不支持 CORS 的源会静音）
  const audioCtxConnectedRef = useRef(false);
  const playRequestIdRef = useRef(0);
  const parsedSongCacheRef = useRef<Map<string, ParsedSongCacheEntry>>(new Map());
  const preloadedResolutionKeyRef = useRef<string | null>(null);

  // Refs to solve Stale Closure issues in Event Listeners
  const playNextRef = useRef<((force?: boolean) => void) | null>(null);
  const playSongRef = useRef<
    (song: Song, forceQuality?: AudioQuality) => Promise<void>
  >(async () => {});
  const currentSongRef = useRef(currentSong);
  const queueRef = useRef(queue);
  const playModeRef = useRef(playMode);
  const audioQualityRef = useRef(audioQuality);
  const activeQualityRef = useRef<AudioQuality>(audioQuality);
  const progressFrameRef = useRef<number | null>(null);
  const lastProgressTimeRef = useRef(0);
  const play30LoggedKeyRef = useRef<string | null>(null);
  const completeLoggedKeyRef = useRef<string | null>(null);
  const lyricRefreshKeyRef = useRef<string | null>(null);

  // Track error retry to prevent loops
  const retryCountRef = useRef(0);
  const forceNoCorsPlaybackRef = useRef(false);
  const activeParsedCacheKeyRef = useRef<string | null>(null);
  const pendingQualityChangeRef = useRef(false);
  const refreshedCacheKeysRef = useRef<Set<string>>(new Set());
  const playbackSessionIdRef = useRef<string | null>(null);
  const failedRecommendationRequestIdRef = useRef<string | null>(null);
  const failedRecommendationSongKeysRef = useRef<Set<string>>(new Set());

  const resetRecommendationPlaybackState = useCallback((song: Song) => {
    const key = getSongKey(song);
    play30LoggedKeyRef.current = null;
    completeLoggedKeyRef.current = null;
    return key;
  }, []);

  const startPlaybackSession = useCallback(() => {
    if (!playbackSessionIdRef.current) {
      playbackSessionIdRef.current = createPlaybackSessionId();
    }
    return playbackSessionIdRef.current;
  }, []);

  const logPlaybackRecommendationEvent = useCallback((
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
      song,
      positionSeconds,
      durationSeconds,
      quality: quality || audioQualityRef.current,
      context: "playback",
    }).catch(() => {});
  }, [startPlaybackSession]);

  const logEarlySkipIfNeeded = useCallback(() => {
    const song = currentSongRef.current;
    const audio = audioRef.current;
    if (!song || !audio || audio.ended) return;
    const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    if (position > 0 && position < 30) {
      logPlaybackRecommendationEvent(
        "skip_early",
        song,
        position,
        getFiniteAudioDuration(audio),
      );
    }
  }, [logPlaybackRecommendationEvent]);

  const showPlayerNotice = useCallback(
    (message: string, tone: PlayerNotice["tone"] = "info") => {
      setPlayerNotice({ id: Date.now(), tone, message });
    },
    [],
  );

  const evictActiveParsedSong = useCallback(() => {
    const cacheKey = activeParsedCacheKeyRef.current;
    if (cacheKey) parsedSongCacheRef.current.delete(cacheKey);
    activeParsedCacheKeyRef.current = null;
  }, []);

  const retryCachedSongResolution = useCallback((song: Song, quality: AudioQuality): boolean => {
    const cacheKey = `${getSongKey(song)}:${quality}`;
    if (
      activeParsedCacheKeyRef.current !== cacheKey ||
      refreshedCacheKeysRef.current.has(cacheKey)
    ) {
      return false;
    }

    refreshedCacheKeysRef.current.add(cacheKey);
    parsedSongCacheRef.current.delete(cacheKey);
    activeParsedCacheKeyRef.current = null;
    void playSongRef.current(song, quality);
    return true;
  }, []);

  const playNextRecommendationAfterFailure = useCallback((song: Song): boolean => {
    const requestId = song.recommendationRequestId;
    if (!requestId) return false;

    if (failedRecommendationRequestIdRef.current !== requestId) {
      failedRecommendationRequestIdRef.current = requestId;
      failedRecommendationSongKeysRef.current.clear();
    }
    failedRecommendationSongKeysRef.current.add(getSongKey(song));

    const nextIndex = getNextRecommendationCandidateIndex(
      queueRef.current,
      song,
      failedRecommendationSongKeysRef.current,
    );
    if (nextIndex < 0) return false;

    const nextSong = queueRef.current[nextIndex];
    if (!nextSong) return false;

    showPlayerNotice("当前推荐歌曲不可播放，已自动尝试下一首", "warning");
    void playSongRef.current(nextSong);
    return true;
  }, [showPlayerNotice]);

  const syncAudioQualityState = useCallback((quality: AudioQuality) => {
    audioQualityRef.current = quality;
    setAudioQualityState(quality);
  }, []);

  // Persistence Effects
  useEffect(() => {
    persistQueue(queue);
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    persistCurrentSong(currentSong);
    currentSongRef.current = currentSong;
  }, [currentSong]);

  useEffect(() => {
    const requestLyricRefresh = () => setLyricRefreshNonce((value) => value + 1);
    window.addEventListener(LYRIC_DISPLAY_MODE_CHANGE_EVENT, requestLyricRefresh);
    window.addEventListener('storage', requestLyricRefresh);

    return () => {
      window.removeEventListener(LYRIC_DISPLAY_MODE_CHANGE_EVENT, requestLyricRefresh);
      window.removeEventListener('storage', requestLyricRefresh);
    };
  }, []);

  useEffect(() => {
    if (!currentSong || !shouldFetchBetterLyrics(currentSong, currentSong.lrc)) return;

    const refreshKey = `${getSongKey(currentSong)}:${currentSong.lrc?.length || 0}:${lyricRefreshNonce}`;
    if (lyricRefreshKeyRef.current === refreshKey) return;
    lyricRefreshKeyRef.current = refreshKey;

    let cancelled = false;
    void getLyrics(currentSong.id, currentSong.source, currentSong).then((lrc) => {
      if (cancelled || !shouldUseLyricCandidate(currentSongRef.current?.lrc, lrc)) return;

      parsedSongCacheRef.current.clear();
      setCurrentSong((prev) => {
        if (!prev || !isSameSong(prev, currentSong) || !shouldUseLyricCandidate(prev.lrc, lrc)) {
          return prev;
        }

        const nextSong = { ...prev, lrc };
        currentSongRef.current = nextSong;
        return nextSong;
      });
      setQueue((prev) => {
        const next = prev.map((song) =>
          isSameSong(song, currentSong) && shouldUseLyricCandidate(song.lrc, lrc)
            ? { ...song, lrc }
            : song,
        );
        queueRef.current = next;
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [currentSong, lyricRefreshNonce]);

  useEffect(() => {
    persistPlayMode(playMode);
    playModeRef.current = playMode;
  }, [playMode]);

  useEffect(() => {
    persistAudioQuality(audioQuality);
    audioQualityRef.current = audioQuality;
  }, [audioQuality]);

  const updateCurrentTimeState = useCallback((time: number) => {
    const nextTime = Number.isFinite(time) ? Math.max(0, time) : 0;
    lastProgressTimeRef.current = nextTime;
    setCurrentTime(nextTime);
  }, []);

  const clearActiveAudioSource = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    updateCurrentTimeState(0);
    setDuration(0);
  }, [updateCurrentTimeState]);

  const syncPlaybackTime = useCallback((force = false) => {
    const audio = audioRef.current;
    if (!audio) return;

    const nextTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    // Throttle non-forced updates to ~10fps (100ms) to reduce re-renders.
    // Forced updates (timeupdate, loadedmetadata, seek) bypass the throttle.
    if (force || Math.abs(nextTime - lastProgressTimeRef.current) >= 0.1) {
      updateCurrentTimeState(nextTime);
    }
  }, [updateCurrentTimeState]);

  // --- Audio 事件处理器（提取为 ref 避免重复定义，支持 Audio 元素重建） ---
  const handlersRef = useRef<{
    timeupdate: () => void;
    loadedmetadata: () => void;
    durationchange: () => void;
    ended: () => void;
    error: (e: Event) => void;
    waiting: () => void;
    canplay: () => void;
  } | null>(null);

  // 创建/重建 Audio 元素（用于切换 CORS 和非 CORS 源）
  const createAudioElement = useCallback((withCors: boolean) => {
    // 清理旧 Audio
    const oldAudio = audioRef.current;
    if (oldAudio) {
      oldAudio.pause();
      oldAudio.removeAttribute("src");
      if (handlersRef.current) {
        oldAudio.removeEventListener(
          "timeupdate",
          handlersRef.current.timeupdate,
        );
        oldAudio.removeEventListener(
          "loadedmetadata",
          handlersRef.current.loadedmetadata,
        );
        oldAudio.removeEventListener(
          "durationchange",
          handlersRef.current.durationchange,
        );
        oldAudio.removeEventListener("ended", handlersRef.current.ended);
        oldAudio.removeEventListener("error", handlersRef.current.error);
        oldAudio.removeEventListener("waiting", handlersRef.current.waiting);
        oldAudio.removeEventListener("canplay", handlersRef.current.canplay);
      }
    }

    // 清理旧 AudioContext（一旦 createMediaElementSource 绑定就无法解除）
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
      sourceNodeRef.current = null;
      audioCtxConnectedRef.current = false;
      analyserRef.current = null;
      setAnalyser(null);
    }

    const audio = new Audio();
    audio.preload = "auto";
    (audio as any).playsInline = true;
    if (withCors) {
      audio.crossOrigin = "anonymous";
    }

    const syncDuration = () => {
      const nextDuration = getFiniteAudioDuration(audio);
      if (nextDuration > 0) setDuration(nextDuration);
      return nextDuration;
    };

    const syncMediaPosition = () => {
      const nextDuration = syncDuration();
      if ("mediaSession" in navigator && nextDuration > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: nextDuration,
            playbackRate: audio.playbackRate,
            position: audio.currentTime,
          });
        } catch {
          /* ignore */
        }
      }
    };

    const handlers = {
      timeupdate: () => {
        syncPlaybackTime(true);
        syncMediaPosition();
        const song = currentSongRef.current;
        if (!song) return;
        const key = getSongKey(song);
        const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const totalDuration = getFiniteAudioDuration(audio);
        if (position >= 30 && play30LoggedKeyRef.current !== key) {
          play30LoggedKeyRef.current = key;
          logPlaybackRecommendationEvent("play_30s", song, position, totalDuration);
        }
        if (
          totalDuration > 0 &&
          position / totalDuration >= 0.8 &&
          completeLoggedKeyRef.current !== key
        ) {
          completeLoggedKeyRef.current = key;
          logPlaybackRecommendationEvent("play_complete", song, position, totalDuration);
        }
      },
      loadedmetadata: () => {
        syncPlaybackTime(true);
        syncMediaPosition();
        setIsLoading(false);
        retryCountRef.current = 0;
      },
      durationchange: () => {
        syncDuration();
      },
      ended: () => {
        const song = currentSongRef.current;
        if (song) {
          const key = getSongKey(song);
          if (completeLoggedKeyRef.current !== key) {
            completeLoggedKeyRef.current = key;
            logPlaybackRecommendationEvent(
              "play_complete",
              song,
              getFiniteAudioDuration(audio),
              getFiniteAudioDuration(audio),
            );
          }
        }
        if (playNextRef.current) playNextRef.current(false);
      },
      error: (_e: Event) => {
        const errorCode = audio.error?.code;
        const errorMessage = audio.error?.message;
        console.error(
          `Audio Element Error: Code=${errorCode}, Msg=${errorMessage}`,
        );
        const isSourceError = errorCode === MEDIA_ERR_SRC_NOT_SUPPORTED_CODE;
        if (
          isSourceError &&
          currentSongRef.current &&
          !forceNoCorsPlaybackRef.current &&
          retryCountRef.current === 0
        ) {
          showPlayerNotice("当前音源不支持频谱解析，已切换兼容播放模式", "warning");
          forceNoCorsPlaybackRef.current = true;
          retryCountRef.current = 1;
          playSongRef.current(currentSongRef.current, activeQualityRef.current);
          return;
        }
        if (
          currentSongRef.current &&
          retryCachedSongResolution(currentSongRef.current, activeQualityRef.current)
        ) {
          return;
        }
        if (
          currentSongRef.current &&
          activeQualityRef.current !== "128k" &&
          retryCountRef.current <= 1
        ) {
          showPlayerNotice("当前音质不可播放，已尝试切换到 128K", "warning");
          retryCountRef.current = 2;
          playSongRef.current(currentSongRef.current, "128k");
          return;
        }
        evictActiveParsedSong();
        if (
          currentSongRef.current &&
          playNextRecommendationAfterFailure(currentSongRef.current)
        ) {
          return;
        }
        if (isSourceError) {
          console.error("Playback source is not supported.", getMediaErrorSummary(audio.error));
        } else {
          console.error("Playback failed.", getMediaErrorSummary(audio.error));
        }
        clearActiveAudioSource();
        showPlayerNotice("这首歌暂时无法播放，请换源或稍后再试", "error");
        setIsLoading(false);
        setIsPlaying(false);
        retryCountRef.current = 0;
      },
      waiting: () => setIsLoading(true),
      canplay: () => setIsLoading(false),
    };

    audio.addEventListener("timeupdate", handlers.timeupdate);
    audio.addEventListener("loadedmetadata", handlers.loadedmetadata);
    audio.addEventListener("durationchange", handlers.durationchange);
    audio.addEventListener("ended", handlers.ended);
    audio.addEventListener("error", handlers.error);
    audio.addEventListener("waiting", handlers.waiting);
    audio.addEventListener("canplay", handlers.canplay);

    handlersRef.current = handlers;
    audioRef.current = audio;
    return audio;
  }, [
    clearActiveAudioSource,
    evictActiveParsedSong,
    logPlaybackRecommendationEvent,
    playNextRecommendationAfterFailure,
    retryCachedSongResolution,
    showPlayerNotice,
    syncPlaybackTime,
  ]);

  // --- Audio Element 初始化（不预设 crossOrigin，由 playSong 根据源动态决定） ---
  useEffect(() => {
    createAudioElement(false);

    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        if (handlersRef.current) {
          audio.removeEventListener(
            "timeupdate",
            handlersRef.current.timeupdate,
          );
          audio.removeEventListener(
            "loadedmetadata",
            handlersRef.current.loadedmetadata,
          );
          audio.removeEventListener(
            "durationchange",
            handlersRef.current.durationchange,
          );
          audio.removeEventListener("ended", handlersRef.current.ended);
          audio.removeEventListener("error", handlersRef.current.error);
          audio.removeEventListener("waiting", handlersRef.current.waiting);
          audio.removeEventListener("canplay", handlersRef.current.canplay);
        }
      }
      if (progressFrameRef.current !== null) {
        window.cancelAnimationFrame(progressFrameRef.current);
        progressFrameRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // iOS 设备检测：iOS 会在后台 suspend AudioContext 导致音频停止，
  // 因此 iOS 上不使用 createMediaElementSource，让 Audio 直接播放，可视化使用模拟模式
  const isIOSRef = useRef(
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
  );

  // --- AudioContext 延迟初始化（需要用户交互上下文） ---
  const initAudioContext = useCallback(() => {
    // iOS 强制跳过：确保后台播放不中断
    if (isIOSRef.current) return;
    if (audioCtxRef.current || !audioRef.current) return;
    try {
      const AudioCtx =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const node = ctx.createAnalyser();
      node.fftSize = 512;
      node.smoothingTimeConstant = 0.7;
      const source = ctx.createMediaElementSource(audioRef.current);
      source.connect(node);
      node.connect(ctx.destination);
      audioCtxRef.current = ctx;
      sourceNodeRef.current = source;
      audioCtxConnectedRef.current = true;
      analyserRef.current = node;
      setAnalyser(node);
    } catch (e) {
      console.error("AudioContext 初始化失败，使用模拟可视化", e);
    }
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      const ctx = audioCtxRef.current;
      if (document.visibilityState === "visible" && ctx?.state === "suspended") {
        ctx.resume();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // --- Logic Definitions ---

  // --- updateMediaSession / updatePositionState 定义在 playSong 之前，供其调用 ---

  const updateMediaSession = useCallback(
    (song: Song | null, state: "playing" | "paused") => {
      if (!("mediaSession" in navigator) || !song) return;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.name,
        artist: song.artist,
        album: song.album || "TuneFree Music",
        artwork: song.pic
          ? [
              { src: song.pic, sizes: "96x96", type: "image/jpeg" },
              { src: song.pic, sizes: "128x128", type: "image/jpeg" },
              { src: song.pic, sizes: "192x192", type: "image/jpeg" },
              { src: song.pic, sizes: "256x256", type: "image/jpeg" },
              { src: song.pic, sizes: "384x384", type: "image/jpeg" },
              { src: song.pic, sizes: "512x512", type: "image/jpeg" },
            ]
          : [],
      });
      navigator.mediaSession.playbackState = state;
    },
    [],
  );

  const updatePositionState = useCallback(() => {
    if (!("mediaSession" in navigator) || !audioRef.current) return;

    const nextDuration = getFiniteAudioDuration(audioRef.current);
    if (nextDuration <= 0) return;

    try {
      navigator.mediaSession.setPositionState({
        duration: nextDuration,
        playbackRate: audioRef.current.playbackRate,
        position: audioRef.current.currentTime,
      });
    } catch {
      /* ignore */
    }
  }, []);

  const getParsedSongCacheKey = useCallback(
    (song: Pick<Song, "id" | "source">, quality: AudioQuality) =>
      `${getSongKey(song)}:${quality}`,
    [],
  );

  const resolveParsedSong = useCallback(
    async (
      song: Song,
      quality: AudioQuality,
      forceRefresh = false,
    ): Promise<ParsedSongResolution> => {
      // 离线优先（与 Flutter 版一致）：已下载的歌曲直接用本地 Blob 播放。
      // 不写入解析缓存，删除下载后可立即回落在线解析。
      const local = await resolveOfflinePlayback(song, quality).catch(() => null);
      if (local?.url) {
        return {
          parsed: { url: local.url, lrc: local.lrc, pic: local.pic },
          cacheKey: null,
        };
      }

      const cacheKey = getParsedSongCacheKey(song, quality);
      if (forceRefresh) parsedSongCacheRef.current.delete(cacheKey);

      const cached = parsedSongCacheRef.current.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return { parsed: cached.data, cacheKey };
      }
      if (cached) parsedSongCacheRef.current.delete(cacheKey);

      try {
        const parsed = await parseSongFull(song.id, song.source, quality, song);
        if (parsed?.url) {
          parsedSongCacheRef.current.set(cacheKey, {
            data: parsed,
            expiresAt: Date.now() + PARSED_SONG_CACHE_TTL_MS,
          });
        } else {
          parsedSongCacheRef.current.delete(cacheKey);
        }
        return { parsed, cacheKey };
      } catch (error) {
        parsedSongCacheRef.current.delete(cacheKey);
        throw error;
      }
    },
    [getParsedSongCacheKey],
  );

  const preloadNextSong = useCallback(
    (song: Song) => {
      const nextIndex = getNextQueueIndex(
        queueRef.current,
        song,
        playModeRef.current,
      );
      if (nextIndex < 0) return;

      const nextSong = queueRef.current[nextIndex];
      if (!nextSong || isSameSong(nextSong, song)) return;

      const quality = audioQualityRef.current;
      const cacheKey = getParsedSongCacheKey(nextSong, quality);
      if (preloadedResolutionKeyRef.current === cacheKey) return;
      preloadedResolutionKeyRef.current = cacheKey;

      void resolveParsedSong(nextSong, quality)
        .then(({ parsed }) => {
          if (!parsed?.url) {
            if (preloadedResolutionKeyRef.current === cacheKey) {
              preloadedResolutionKeyRef.current = null;
            }
            return;
          }
          if (getParsedSongCacheKey(nextSong, audioQualityRef.current) !== cacheKey) {
            if (preloadedResolutionKeyRef.current === cacheKey) {
              preloadedResolutionKeyRef.current = null;
            }
            return;
          }

          const patch: Partial<Song> = { url: parsed.url };
          if (parsed.pic && !nextSong.pic) patch.pic = parsed.pic;
          if (parsed.lrc) patch.lrc = parsed.lrc;
          setQueue((prev) => {
            const next = prev.map((queuedSong) =>
              isSameSong(queuedSong, nextSong)
                ? { ...queuedSong, ...patch }
                : queuedSong,
            );
            queueRef.current = next;
            return next;
          });
        })
        .catch((error) => {
          if (preloadedResolutionKeyRef.current === cacheKey) {
            preloadedResolutionKeyRef.current = null;
          }
          console.error("Preload next song failed:", error);
        });
    },
    [getParsedSongCacheKey, resolveParsedSong],
  );

  const pausePlayback = useCallback(() => {
    const activeAudio = audioRef.current;
    const song = currentSongRef.current;
    if (!activeAudio || !song) return;

    playRequestIdRef.current += 1;
    activeAudio.pause();
    setIsPlaying(false);
    setIsLoading(false);
    updateMediaSession(song, "paused");
  }, [updateMediaSession]);

  const resumePlayback = useCallback(async () => {
    const activeAudio = audioRef.current;
    const song = currentSongRef.current;
    if (!song) return;

    if (
      pendingQualityChangeRef.current &&
      activeQualityRef.current !== audioQualityRef.current
    ) {
      await playSongRef.current(song, audioQualityRef.current);
      return;
    }

    if (!activeAudio || !activeAudio.src || activeAudio.src === window.location.href) {
      await playSongRef.current(song);
      return;
    }

    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume().catch(() => {});
    }

    const requestId = ++playRequestIdRef.current;
    setIsLoading(true);
    try {
      await activeAudio.play();
      if (requestId !== playRequestIdRef.current) return;
      syncPlaybackTime(true);
      setIsPlaying(true);
      setIsLoading(false);
      updateMediaSession(song, "playing");
      preloadNextSong(song);
    } catch (error: unknown) {
      if (requestId !== playRequestIdRef.current) return;
      console.error("Resume playback failed:", error);
      const isNotAllowed = error instanceof Error && error.name === "NotAllowedError";
      if (isNotAllowed) {
        showPlayerNotice("播放被浏览器阻止，请再次点击播放", "warning");
        setIsPlaying(false);
        setIsLoading(false);
        return;
      }

      evictActiveParsedSong();
      clearActiveAudioSource();
      await playSongRef.current(song);
    }
  }, [
    clearActiveAudioSource,
    evictActiveParsedSong,
    preloadNextSong,
    showPlayerNotice,
    syncPlaybackTime,
    updateMediaSession,
  ]);

  const playSong = useCallback(
    async (song: Song, forceQuality?: AudioQuality) => {
      if (!audioRef.current) return;

      const targetQuality = forceQuality || audioQualityRef.current;
      if (!forceQuality || targetQuality === audioQualityRef.current) {
        pendingQualityChangeRef.current = false;
      }
      const isCurrentSong = isSameSong(currentSongRef.current, song);
      const isDifferentQuality =
        isCurrentSong && targetQuality !== activeQualityRef.current;

      if (isCurrentSong && !isDifferentQuality && !forceQuality) {
        const activeAudio = audioRef.current;
        if (activeAudio.src && activeAudio.src !== window.location.href) {
          if (activeAudio.paused) {
            await resumePlayback();
          } else {
            setIsPlaying(true);
            setIsLoading(false);
            updateMediaSession(currentSongRef.current, "playing");
            preloadNextSong(song);
          }
          return;
        }
      }

      if (!forceQuality) {
        startPlaybackSession();
        refreshedCacheKeysRef.current.clear();
        if (failedRecommendationRequestIdRef.current !== song.recommendationRequestId) {
          failedRecommendationRequestIdRef.current = song.recommendationRequestId || null;
          failedRecommendationSongKeysRef.current.clear();
        }
        failedRecommendationSongKeysRef.current.delete(getSongKey(song));
      }

      const requestId = ++playRequestIdRef.current;
      setIsLoading(true);
      if (!forceQuality) retryCountRef.current = 0;

      if (!isCurrentSong) {
        forceNoCorsPlaybackRef.current = false;
        activeParsedCacheKeyRef.current = null;
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
        setIsPlaying(false);
        updateCurrentTimeState(0);
        setDuration(0);
      }

      let fullSong = { ...song };
      setCurrentSong(fullSong);
      currentSongRef.current = fullSong;

      setQueue((prev) => {
        const next = prev.find((s) => isSameSong(s, song))
          ? prev
          : [...prev, fullSong];
        queueRef.current = next;
        return next;
      });

      try {
        const resolution = await resolveParsedSong(song, targetQuality);
        const parsed = resolution.parsed;

        if (
          requestId !== playRequestIdRef.current ||
          !isSameSong(currentSongRef.current, song)
        ) {
          return;
        }

        if (parsed) {
          const patch: Partial<Song> = {};
          if (parsed.url) patch.url = parsed.url;
          if (parsed.pic && !fullSong.pic) patch.pic = parsed.pic;
          if (parsed.lrc) patch.lrc = parsed.lrc;

          if (Object.keys(patch).length > 0) {
            fullSong = { ...fullSong, ...patch };
            currentSongRef.current = fullSong;
            setCurrentSong((prev) => {
              if (!isSameSong(prev, song) || !prev) return prev;
              return { ...prev, ...patch };
            });
            setQueue((prev) => {
              const next = prev.map((s) =>
                isSameSong(s, song) ? { ...s, ...patch } : s,
              );
              queueRef.current = next;
              return next;
            });
          }

          if (shouldFetchBetterLyrics(song, fullSong.lrc)) {
            void getLyrics(song.id, song.source, song).then((lrc) => {
              if (
                !isSameSong(currentSongRef.current, song) ||
                !shouldUseLyricCandidate(currentSongRef.current?.lrc, lrc)
              ) {
                return;
              }

              setCurrentSong((prev) => {
                if (!isSameSong(prev, song) || !prev || !shouldUseLyricCandidate(prev.lrc, lrc)) {
                  return prev;
                }

                const nextSong = { ...prev, lrc };
                currentSongRef.current = nextSong;
                return nextSong;
              });
              setQueue((prev) => {
                const next = prev.map((s) =>
                  isSameSong(s, song) && shouldUseLyricCandidate(s.lrc, lrc)
                    ? { ...s, lrc }
                    : s,
                );
                queueRef.current = next;
                return next;
              });
            });
          }
        }

        const url = parsed?.url || null;

        if (url) {
          fullSong.url = url;
          const resumeTime =
            isCurrentSong && isDifferentQuality ? audioRef.current.currentTime : 0;
          const needsCors =
            !forceNoCorsPlaybackRef.current &&
            !url.includes("kuwo.cn") &&
            !url.includes("sycdn.kuwo");

          if (isIOSRef.current) {
            if (audioCtxConnectedRef.current || audioRef.current.crossOrigin) {
              createAudioElement(false);
            }
          } else if (!needsCors) {
            if (audioCtxConnectedRef.current || audioRef.current.crossOrigin) {
              createAudioElement(false);
            }
          } else {
            if (!audioCtxConnectedRef.current) createAudioElement(true);
            initAudioContext();
          }

          const activeAudio = audioRef.current;
          if (!activeAudio) return;

          activeQualityRef.current = targetQuality;
          activeParsedCacheKeyRef.current = resolution.cacheKey;

          activeAudio.src = url;
          activeAudio.load();

          if (resumeTime > 0) activeAudio.currentTime = resumeTime;

          if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
            audioCtxRef.current.resume();
          }

          try {
            await activeAudio.play();
            if (requestId !== playRequestIdRef.current) return;
            const recommendationKey = resetRecommendationPlaybackState(fullSong);
            play30LoggedKeyRef.current = null;
            completeLoggedKeyRef.current = null;
            syncPlaybackTime(true);
            setIsPlaying(true);
            setIsLoading(false);
            updateMediaSession(fullSong, "playing");
            preloadNextSong(fullSong);
            logPlaybackRecommendationEvent("play_start", fullSong, 0, getFiniteAudioDuration(activeAudio), targetQuality);
            if (recommendationKey !== getSongKey(fullSong)) {
              resetRecommendationPlaybackState(fullSong);
            }
          } catch (error: unknown) {
            if (requestId !== playRequestIdRef.current) return;
            if (error instanceof Error && error.name === "AbortError") return;

            if (
              isUnsupportedSourcePlayError(error) &&
              !forceNoCorsPlaybackRef.current
            ) {
              showPlayerNotice("当前音源不支持频谱解析，已切换兼容播放模式", "warning");
              forceNoCorsPlaybackRef.current = true;
              retryCountRef.current = Math.max(retryCountRef.current, 1);
              playSongRef.current(song, targetQuality);
              return;
            }

            const isNotAllowed = error instanceof Error && error.name === "NotAllowedError";
            if (!isNotAllowed && retryCachedSongResolution(song, targetQuality)) {
              return;
            }

            if (
              isUnsupportedSourcePlayError(error) &&
              retryCountRef.current <= 1 &&
              targetQuality !== "128k"
            ) {
              showPlayerNotice("当前音质不可播放，已尝试切换到 128K", "warning");
              retryCountRef.current = 2;
              playSongRef.current(song, "128k");
              return;
            }

            if (!isNotAllowed) {
              evictActiveParsedSong();
              if (playNextRecommendationAfterFailure(song)) return;
              clearActiveAudioSource();
            }
            showPlayerNotice(
              isNotAllowed
                ? "播放被浏览器阻止，请再次点击播放"
                : "播放失败，请稍后再试",
              isNotAllowed ? "warning" : "error",
            );
            setIsPlaying(false);
            setIsLoading(false);
          }
        } else {
          console.error(`No valid URL for ${song.name} [${targetQuality}]`);

          if (targetQuality !== "128k" && retryCountRef.current === 0) {
            showPlayerNotice("当前音质不可播放，已尝试切换到 128K", "warning");
            retryCountRef.current = 1;
            playSongRef.current(song, "128k");
            return;
          }

          evictActiveParsedSong();
          if (playNextRecommendationAfterFailure(song)) return;

          clearActiveAudioSource();
          showPlayerNotice("这首歌暂时无法播放，请换源或稍后再试", "error");
          setIsLoading(false);
          setIsPlaying(false);
        }
      } catch (err) {
        if (requestId === playRequestIdRef.current) {
          setIsLoading(false);
          setIsPlaying(false);
          evictActiveParsedSong();
          if (playNextRecommendationAfterFailure(song)) return;
          clearActiveAudioSource();
        }
        console.error("Error in playSong", err);
      }
    },
    [
      clearActiveAudioSource,
      createAudioElement,
      evictActiveParsedSong,
      getParsedSongCacheKey,
      initAudioContext,
      logPlaybackRecommendationEvent,
      preloadNextSong,
      playNextRecommendationAfterFailure,
      resolveParsedSong,
      resetRecommendationPlaybackState,
      retryCachedSongResolution,
      resumePlayback,
      showPlayerNotice,
      startPlaybackSession,
      syncPlaybackTime,
      updateCurrentTimeState,
      updateMediaSession,
    ],
  );

  const playQueue = useCallback(
    async (songs: Song[], startSong?: Song) => {
      const seen = new Set<string>();
      const nextQueue = songs.filter((song) => {
        const key = getSongKey(song);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (nextQueue.length === 0) return;

      const targetSong = startSong
        ? nextQueue.find((song) => isSameSong(song, startSong)) || nextQueue[0]
        : nextQueue[0];
      if (!targetSong) return;

      preloadedResolutionKeyRef.current = null;
      queueRef.current = nextQueue;
      setQueue(nextQueue);

      const activeAudio = audioRef.current;
      if (
        isSameSong(currentSongRef.current, targetSong) &&
        activeAudio?.src &&
        activeAudio.src !== window.location.href &&
        !activeAudio.paused
      ) {
        const mergedCurrentSong = {
          ...currentSongRef.current,
          ...targetSong,
        } as Song;
        currentSongRef.current = mergedCurrentSong;
        setCurrentSong(mergedCurrentSong);
        preloadNextSong(targetSong);
        return;
      }

      await playSongRef.current(targetSong);
    },
    [preloadNextSong],
  );

  // 始终保持 playSongRef 指向最新的 playSong，避免 stale closure
  playSongRef.current = playSong;

  const togglePlay = useCallback(() => {
    const activeAudio = audioRef.current;
    if (!activeAudio || !currentSongRef.current) return;

    if (activeAudio.src && activeAudio.src !== window.location.href && !activeAudio.paused) {
      pausePlayback();
      return;
    }

    void resumePlayback();
  }, [pausePlayback, resumePlayback]);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      updateCurrentTimeState(time);
      updatePositionState();
    }
  }, [updateCurrentTimeState, updatePositionState]);

  const playNext = useCallback((force = true) => {
    const q = queueRef.current;
    const c = currentSongRef.current;
    const mode = playModeRef.current;

    if (q.length === 0) return;
    if (force) logEarlySkipIfNeeded();

    if (!force && mode === "loop") {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        updateCurrentTimeState(0);
        audioRef.current
          .play()
          .catch((e) => console.error("单曲循环重播失败:", e));
      }
      return;
    }

    const nextIndex = getNextQueueIndex(q, c, mode);
    if (nextIndex < 0) return;

    const nextSong = q[nextIndex];
    if (!nextSong) return;

    if (c && isSameSong(nextSong, c)) {
      startPlaybackSession();
      refreshedCacheKeysRef.current.clear();
      playSongRef.current(nextSong, audioQualityRef.current);
      return;
    }

    playSongRef.current(nextSong);
  }, [logEarlySkipIfNeeded, startPlaybackSession, updateCurrentTimeState]);

  const playPrev = useCallback(() => {
    const activeAudio = audioRef.current;
    if (activeAudio && activeAudio.currentTime > 3) {
      activeAudio.currentTime = 0;
      updateCurrentTimeState(0);
      updatePositionState();
      return;
    }

    const q = queueRef.current;
    const c = currentSongRef.current;
    const mode = playModeRef.current;

    if (q.length === 0) return;
    logEarlySkipIfNeeded();

    const prevIndex = getPrevQueueIndex(q, c, mode);
    if (prevIndex < 0) return;

    playSongRef.current(q[prevIndex]);
  }, [logEarlySkipIfNeeded, updateCurrentTimeState, updatePositionState]);

  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("play", () => void resumePlayback());
      navigator.mediaSession.setActionHandler("pause", () => pausePlayback());
      navigator.mediaSession.setActionHandler("previoustrack", () =>
        playPrev(),
      );
      navigator.mediaSession.setActionHandler("nexttrack", () =>
        playNext(true),
      );
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (details.seekTime !== undefined) seek(details.seekTime);
      });
    }
  }, [pausePlayback, playNext, playPrev, resumePlayback, seek]);

  useEffect(() => {
    if (currentSong) {
      updateMediaSession(currentSong, isPlaying ? "playing" : "paused");
    }
  }, [currentSong, isPlaying, updateMediaSession]);

  useEffect(() => {
    if (!isPlaying) {
      if (progressFrameRef.current !== null) {
        window.cancelAnimationFrame(progressFrameRef.current);
        progressFrameRef.current = null;
      }
      syncPlaybackTime(true);
      return;
    }

    const tick = () => {
      syncPlaybackTime();
      progressFrameRef.current = window.requestAnimationFrame(tick);
    };

    progressFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (progressFrameRef.current !== null) {
        window.cancelAnimationFrame(progressFrameRef.current);
        progressFrameRef.current = null;
      }
    };
  }, [isPlaying, syncPlaybackTime]);

  useEffect(() => {
    if (!currentSong || !isPlaying) return;
    preloadNextSong(currentSong);
  }, [audioQuality, currentSong, isPlaying, playMode, preloadNextSong, queue]);

  const addToQueue = useCallback((song: Song) => {
    setQueue((prev) => {
      if (prev.find((s) => isSameSong(s, song))) return prev;
      return [...prev, song];
    });
  }, []);

  const removeFromQueue = useCallback(
    (songId: string | number, source?: string) => {
      const matchesTarget = (song: Song) =>
        String(song.id) === String(songId) && (!source || song.source === source);
      const previousQueue = queueRef.current;
      const removedIndex = previousQueue.findIndex(matchesTarget);
      if (removedIndex < 0) return;

      const nextQueue = previousQueue.filter((song) => !matchesTarget(song));
      queueRef.current = nextQueue;
      setQueue(nextQueue);
      preloadedResolutionKeyRef.current = null;

      const current = currentSongRef.current;
      if (!current || !matchesTarget(current)) return;

      if (nextQueue.length === 0) {
        playRequestIdRef.current += 1;
        const activeAudio = audioRef.current;
        if (activeAudio) {
          activeAudio.pause();
          activeAudio.removeAttribute("src");
          activeAudio.load();
        }
        currentSongRef.current = null;
        setCurrentSong(null);
        updateCurrentTimeState(0);
        setDuration(0);
        setIsPlaying(false);
        setIsLoading(false);
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "none";
          navigator.mediaSession.metadata = null;
        }
        return;
      }

      const nextSong = nextQueue[Math.min(removedIndex, nextQueue.length - 1)] || nextQueue[0];
      if (nextSong) void playSongRef.current(nextSong);
    },
    [],
  );

  const clearQueue = useCallback(() => {
    preloadedResolutionKeyRef.current = null;
    const current = currentSongRef.current;
    const nextQueue = current ? [current] : [];
    queueRef.current = nextQueue;
    setQueue(nextQueue);
  }, []);

  const togglePlayMode = useCallback(() => {
    setPlayMode((prev) => {
      if (prev === "sequence") return "loop";
      if (prev === "loop") return "shuffle";
      return "sequence";
    });
  }, []);

  const setLyricOffsetSeconds = useCallback((offset: number) => {
    const nextOffset = Number.isFinite(offset) ? Math.max(-10, Math.min(10, offset)) : 0;
    setLyricOffsetSecondsState(nextOffset);
  }, []);

  const adjustLyricOffsetSeconds = useCallback((delta: number) => {
    setLyricOffsetSecondsState((current) => {
      const nextOffset = current + (Number.isFinite(delta) ? delta : 0);
      return Math.max(-10, Math.min(10, nextOffset));
    });
  }, []);

  const setAudioQuality = useCallback((q: AudioQuality) => {
    pendingQualityChangeRef.current = activeQualityRef.current !== q;
    syncAudioQualityState(q);
    logPlaybackRecommendationEvent(
      "quality_change",
      currentSongRef.current,
      audioRef.current?.currentTime,
      audioRef.current ? getFiniteAudioDuration(audioRef.current) : undefined,
      q,
    );
    // 使用 ref 避免 stale closure，不依赖 currentSong/isPlaying state
    if (
      currentSongRef.current &&
      audioRef.current &&
      !audioRef.current.paused
    ) {
      playSongRef.current(currentSongRef.current, q);
    }
  }, [logPlaybackRecommendationEvent, syncAudioQualityState]);

  const actionsValue = useMemo(
    () => ({
      playSong,
      playQueue,
      togglePlay,
      pausePlayback,
      resumePlayback,
      seek,
      setLyricOffsetSeconds,
      adjustLyricOffsetSeconds,
      playNext,
      playPrev,
      addToQueue,
      removeFromQueue,
      togglePlayMode,
      clearQueue,
      setAudioQuality,
      initAudioContext,
    }),
    [
      playSong,
      playQueue,
      togglePlay,
      pausePlayback,
      resumePlayback,
      seek,
      setLyricOffsetSeconds,
      adjustLyricOffsetSeconds,
      playNext,
      playPrev,
      addToQueue,
      removeFromQueue,
      togglePlayMode,
      clearQueue,
      setAudioQuality,
      initAudioContext,
    ],
  );

  const nowPlayingValue = useMemo(
    () => ({
      currentSong,
      isPlaying,
      isLoading,
    }),
    [currentSong, isPlaying, isLoading],
  );

  const queueStateValue = useMemo(
    () => ({
      queue,
      playMode,
    }),
    [queue, playMode],
  );

  const settingsValue = useMemo(
    () => ({
      audioQuality,
    }),
    [audioQuality],
  );

  const analyserValue = useMemo(
    () => ({
      analyser,
    }),
    [analyser],
  );

  const progressValue = useMemo(
    () => ({
      currentTime,
      duration,
      lyricOffsetSeconds,
    }),
    [currentTime, duration, lyricOffsetSeconds],
  );

  const noticeValue = useMemo(
    () => ({
      playerNotice,
    }),
    [playerNotice],
  );

  // Context value 用 useMemo 稳定对象引用：
  // 只有 state 值实际变化时才创建新对象，避免因无关渲染导致所有消费者重渲
  const contextValue = useMemo(
    () => ({
      currentSong,
      isPlaying,
      isLoading,
      currentTime,
      duration,
      lyricOffsetSeconds,
      volume,
      playMode,
      queue,
      analyser,
      audioQuality,
      playerNotice,
      ...actionsValue,
    }),
    [
      currentSong,
      isPlaying,
      isLoading,
      currentTime,
      duration,
      lyricOffsetSeconds,
      volume,
      playMode,
      queue,
      analyser,
      audioQuality,
      playerNotice,
      actionsValue,
    ]);

  return (
    <PlayerActionsContext.Provider value={actionsValue}>
      <PlayerNowPlayingContext.Provider value={nowPlayingValue}>
        <PlayerQueueStateContext.Provider value={queueStateValue}>
          <PlayerSettingsContext.Provider value={settingsValue}>
            <PlayerAnalyserContext.Provider value={analyserValue}>
              <PlayerProgressContext.Provider value={progressValue}>
                <PlayerNoticeContext.Provider value={noticeValue}>
                  <PlayerContext.Provider value={contextValue}>{children}</PlayerContext.Provider>
                </PlayerNoticeContext.Provider>
              </PlayerProgressContext.Provider>
            </PlayerAnalyserContext.Provider>
          </PlayerSettingsContext.Provider>
        </PlayerQueueStateContext.Provider>
      </PlayerNowPlayingContext.Provider>
    </PlayerActionsContext.Provider>
  );
};

// HMR 热更新时 Provider 可能暂时不可用，返回安全默认值避免崩溃
const PLAYER_DEFAULTS: PlayerContextType = {
  currentSong: null,
  isPlaying: false,
  isLoading: false,
  currentTime: 0,
  duration: 0,
  lyricOffsetSeconds: 0,
  volume: 1,
  playMode: "sequence",
  queue: [],
  analyser: null,
  audioQuality: "320k",
  playerNotice: null,
  playSong: async () => {},
  playQueue: async () => {},
  togglePlay: () => {},
  pausePlayback: () => {},
  resumePlayback: async () => {},
  seek: () => {},
  setLyricOffsetSeconds: () => {},
  adjustLyricOffsetSeconds: () => {},
  playNext: () => {},
  playPrev: () => {},
  addToQueue: () => {},
  removeFromQueue: () => {},
  togglePlayMode: () => {},
  clearQueue: () => {},
  setAudioQuality: () => {},
  initAudioContext: () => {},
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) {
    console.warn("[usePlayer] Provider 未就绪，返回默认值（HMR 热更新中）");
    return PLAYER_DEFAULTS;
  }
  return context;
};

export const usePlayerActions = () => {
  const context = useContext(PlayerActionsContext);
  if (!context) {
    console.warn(
      "[usePlayerActions] Provider 未就绪，返回默认动作（HMR 热更新中）",
    );
    return {
      playSong: PLAYER_DEFAULTS.playSong,
      playQueue: PLAYER_DEFAULTS.playQueue,
      togglePlay: PLAYER_DEFAULTS.togglePlay,
      pausePlayback: PLAYER_DEFAULTS.pausePlayback,
      resumePlayback: PLAYER_DEFAULTS.resumePlayback,
      seek: PLAYER_DEFAULTS.seek,
      setLyricOffsetSeconds: PLAYER_DEFAULTS.setLyricOffsetSeconds,
      adjustLyricOffsetSeconds: PLAYER_DEFAULTS.adjustLyricOffsetSeconds,
      playNext: PLAYER_DEFAULTS.playNext,
      playPrev: PLAYER_DEFAULTS.playPrev,
      addToQueue: PLAYER_DEFAULTS.addToQueue,
      removeFromQueue: PLAYER_DEFAULTS.removeFromQueue,
      togglePlayMode: PLAYER_DEFAULTS.togglePlayMode,
      clearQueue: PLAYER_DEFAULTS.clearQueue,
      setAudioQuality: PLAYER_DEFAULTS.setAudioQuality,
      initAudioContext: PLAYER_DEFAULTS.initAudioContext,
    };
  }
  return context;
};

export const usePlayerNowPlaying = () => {
  const context = useContext(PlayerNowPlayingContext);
  if (!context) {
    console.warn(
      "[usePlayerNowPlaying] Provider 未就绪，返回默认状态（HMR 热更新中）",
    );
    return {
      currentSong: PLAYER_DEFAULTS.currentSong,
      isPlaying: PLAYER_DEFAULTS.isPlaying,
      isLoading: PLAYER_DEFAULTS.isLoading,
    };
  }
  return context;
};

export const usePlayerQueueState = () => {
  const context = useContext(PlayerQueueStateContext);
  if (!context) {
    console.warn(
      "[usePlayerQueueState] Provider 未就绪，返回默认队列状态（HMR 热更新中）",
    );
    return {
      queue: PLAYER_DEFAULTS.queue,
      playMode: PLAYER_DEFAULTS.playMode,
    };
  }
  return context;
};

export const usePlayerSettings = () => {
  const context = useContext(PlayerSettingsContext);
  if (!context) {
    console.warn(
      "[usePlayerSettings] Provider 未就绪，返回默认设置（HMR 热更新中）",
    );
    return {
      audioQuality: PLAYER_DEFAULTS.audioQuality,
    };
  }
  return context;
};

export const usePlayerAnalyser = () => {
  const context = useContext(PlayerAnalyserContext);
  if (!context) {
    console.warn(
      "[usePlayerAnalyser] Provider 未就绪，返回默认分析器状态（HMR 热更新中）",
    );
    return {
      analyser: PLAYER_DEFAULTS.analyser,
    };
  }
  return context;
};

export const usePlayerProgress = () => {
  const context = useContext(PlayerProgressContext);
  if (!context) {
    console.warn(
      "[usePlayerProgress] Provider 未就绪，返回默认播放进度（HMR 热更新中）",
    );
    return {
      currentTime: PLAYER_DEFAULTS.currentTime,
      duration: PLAYER_DEFAULTS.duration,
      lyricOffsetSeconds: PLAYER_DEFAULTS.lyricOffsetSeconds,
    };
  }
  return context;
};

export const usePlayerNotice = () => {
  const context = useContext(PlayerNoticeContext);
  if (!context) {
    console.warn(
      "[usePlayerNotice] Provider 未就绪，返回默认提示状态（HMR 热更新中）",
    );
    return {
      playerNotice: PLAYER_DEFAULTS.playerNotice,
    };
  }
  return context;
};
