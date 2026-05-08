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
import { parseSongFull } from "../services/api";
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
import { getNextQueueIndex, getPrevQueueIndex } from "./playerQueue";

type ParsedSongData = NonNullable<Awaited<ReturnType<typeof parseSongFull>>>;

export interface PlayerNotice {
  id: number;
  tone: "info" | "success" | "warning" | "error";
  message: string;
}

const getFiniteAudioDuration = (audio: HTMLAudioElement): number =>
  Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;

const IOS_AUTO_ADVANCE_LEAD_SECONDS = 1.25;

interface PlayerContextType {
  currentSong: Song | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playMode: PlayMode;
  queue: Song[];
  analyser: AnalyserNode | null;
  audioQuality: AudioQuality;
  playerNotice: PlayerNotice | null;
  playSong: (song: Song, forceQuality?: AudioQuality) => Promise<void>;
  togglePlay: () => void;
  pausePlayback: () => void;
  resumePlayback: () => Promise<void>;
  seek: (time: number) => void;
  playNext: (force?: boolean) => void;
  playPrev: () => void;
  addToQueue: (song: Song) => void;
  removeFromQueue: (songId: string | number, source?: string) => void;
  restoreQueue: (songs: Song[]) => void;
  togglePlayMode: () => void;
  clearQueue: () => void;
  setAudioQuality: (quality: AudioQuality) => void;
  initAudioContext: () => void;
}

type PlayerActionsType = Pick<
  PlayerContextType,
  | "playSong"
  | "togglePlay"
  | "pausePlayback"
  | "resumePlayback"
  | "seek"
  | "playNext"
  | "playPrev"
  | "addToQueue"
  | "removeFromQueue"
  | "restoreQueue"
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

type PlayerProgressType = Pick<PlayerContextType, "currentTime" | "duration">;

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);
const PlayerActionsContext =
  createContext<PlayerActionsType | undefined>(undefined);
const PlayerNoticeContext =
  createContext<PlayerNotice | null | undefined>(undefined);
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
  const [volume, setVolume] = useState(1);
  const [queue, setQueue] = useState<Song[]>(() => loadStoredQueue());
  const [playMode, setPlayMode] = useState<PlayMode>(() => loadStoredPlayMode());
  const [audioQuality, setAudioQualityState] = useState<AudioQuality>(() =>
    loadStoredAudioQuality(),
  );
  const [playerNotice, setPlayerNotice] = useState<PlayerNotice | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  // 标记当前 Audio 是否已被 AudioContext 接管路由（一旦接管，不支持 CORS 的源会静音）
  const audioCtxConnectedRef = useRef(false);

  // Refs to solve Stale Closure issues in Event Listeners
  const playNextRef = useRef<((force?: boolean) => void) | null>(null);
  const playSongRef = useRef<
    (song: Song, forceQuality?: AudioQuality) => Promise<void>
  >(async () => {});
  const currentSongRef = useRef(currentSong);
  const queueRef = useRef(queue);
  const playModeRef = useRef(playMode);
  const audioQualityRef = useRef(audioQuality);

  // Track error retry to prevent loops
  const retryCountRef = useRef(0);
  const playRequestIdRef = useRef(0);
  const autoAdvanceStartedRef = useRef(false);
  const parsedSongCacheRef = useRef<Map<string, ParsedSongData>>(new Map());
  const preloadedAudioRef = useRef<{
    key: string;
    audio: HTMLAudioElement;
  } | null>(null);

  const showPlayerNotice = useCallback((message: string, tone: PlayerNotice["tone"] = "info") => {
    setPlayerNotice({ id: Date.now(), message, tone });
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
    persistPlayMode(playMode);
    playModeRef.current = playMode;
  }, [playMode]);

  useEffect(() => {
    persistAudioQuality(audioQuality);
    audioQualityRef.current = audioQuality;
  }, [audioQuality]);

  // --- Audio 事件处理器（提取为 ref 避免重复定义，支持 Audio 元素重建） ---
  const handlersRef = useRef<{
    timeupdate: () => void;
    loadedmetadata: () => void;
    durationchange: () => void;
    ended: () => void;
    error: (e: any) => void;
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
        setCurrentTime(audio.currentTime);

        const current = currentSongRef.current;
        const nextDuration = getFiniteAudioDuration(audio);
        const remaining = nextDuration - audio.currentTime;
        const nextIndex = current
          ? getNextQueueIndex(queueRef.current, current, playModeRef.current)
          : -1;
        const nextSong = nextIndex >= 0 ? queueRef.current[nextIndex] : null;
        if (
          isIOSRef.current &&
          document.visibilityState !== "visible" &&
          playModeRef.current !== "loop" &&
          !autoAdvanceStartedRef.current &&
          !audio.paused &&
          remaining > 0 &&
          remaining <= IOS_AUTO_ADVANCE_LEAD_SECONDS &&
          current &&
          nextSong &&
          !isSameSong(nextSong, current)
        ) {
          autoAdvanceStartedRef.current = true;
          playNextRef.current?.(false);
        }
      },
      loadedmetadata: () => {
        syncMediaPosition();
        setIsLoading(false);
        retryCountRef.current = 0;
      },
      durationchange: () => {
        syncDuration();
      },
      ended: () => {
        if (autoAdvanceStartedRef.current) return;
        autoAdvanceStartedRef.current = true;
        console.log("[Player] 歌曲播放结束，触发自动播放下一首");
        if (playNextRef.current) playNextRef.current(false);
      },
      error: (e: any) => {
        const errorCode = audio.error?.code;
        const errorMessage = audio.error?.message;
        console.warn(
          `Audio Element Error: Code=${errorCode}, Msg=${errorMessage}`,
        );
        autoAdvanceStartedRef.current = false;
        if (
          currentSongRef.current &&
          audioQualityRef.current !== "128k" &&
          retryCountRef.current === 0
        ) {
          console.warn(
            `Triggering fallback to 128k for ${currentSongRef.current.name}`,
          );
          showPlayerNotice("当前音质不可播放，已尝试切换到 128K", "warning");
          retryCountRef.current = 1;
          playSongRef.current(currentSongRef.current, "128k");
          return;
        }
        console.error("Critical playback failure.", audio.error);
        showPlayerNotice("这首歌暂时无法播放，请换源或稍后再试", "error");
        setIsLoading(false);
        setIsPlaying(false);
        retryCountRef.current = 0;
      },
      waiting: () => setIsLoading(true),
      canplay: () => {
        syncDuration();
        setIsLoading(false);
      },
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
  }, [showPlayerNotice]);

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
      if (preloadedAudioRef.current) {
        preloadedAudioRef.current.audio.pause();
        preloadedAudioRef.current.audio.removeAttribute("src");
        preloadedAudioRef.current.audio.load();
        preloadedAudioRef.current = null;
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
      console.warn("AudioContext 初始化失败，使用模拟可视化", e);
    }
  }, []);

  // 页面可见性变化：后台时断开 Web Audio 路由让 Audio 直接播放，前台时重连可视化
  useEffect(() => {
    const handleVisibility = () => {
      const ctx = audioCtxRef.current;
      const source = sourceNodeRef.current;
      const node = analyserRef.current;

      if (document.visibilityState === "hidden") {
        // 后台：断开 AudioContext 路由，让 HTMLAudioElement 直接输出
        // iOS Safari 会 suspend AudioContext 导致路由中的音频停止
        if (ctx && source && node) {
          try {
            source.disconnect();
            node.disconnect();
          } catch {}
        }
      } else {
        // 前台：恢复 AudioContext 并重连可视化管线
        if (ctx && ctx.state === "suspended") {
          ctx.resume();
        }
        if (ctx && source && node) {
          try {
            source.connect(node);
            node.connect(ctx.destination);
          } catch {}
        }
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
    if (
      "mediaSession" in navigator &&
      audioRef.current &&
      !isNaN(audioRef.current.duration)
    ) {
      try {
        navigator.mediaSession.setPositionState({
          duration: audioRef.current.duration,
          playbackRate: audioRef.current.playbackRate,
          position: audioRef.current.currentTime,
        });
      } catch {
        /* ignore */
      }
    }
  }, []);

  const getParsedSongCacheKey = useCallback(
    (song: Pick<Song, "id" | "source">, quality: AudioQuality) =>
      `${getSongKey(song)}:${quality}`,
    [],
  );

  const resolveParsedSong = useCallback(
    async (song: Song, quality: AudioQuality): Promise<ParsedSongData | null> => {
      const cacheKey = getParsedSongCacheKey(song, quality);
      const cached = parsedSongCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const parsed = await parseSongFull(song.id, song.source, quality, song);
      if (parsed) {
        parsedSongCacheRef.current.set(cacheKey, parsed);
      }
      return parsed;
    },
    [getParsedSongCacheKey],
  );

  const clearPreloadedAudio = useCallback((cacheKey?: string) => {
    const preloaded = preloadedAudioRef.current;
    if (!preloaded || (cacheKey && preloaded.key !== cacheKey)) return;

    preloaded.audio.pause();
    preloaded.audio.removeAttribute("src");
    preloaded.audio.load();
    preloadedAudioRef.current = null;
  }, []);

  const preloadAudioUrl = useCallback(
    (cacheKey: string, url: string) => {
      if (preloadedAudioRef.current?.key === cacheKey) return;

      clearPreloadedAudio();
      const audio = new Audio();
      audio.preload = "auto";
      (audio as any).playsInline = true;
      audio.src = url;
      audio.load();
      preloadedAudioRef.current = { key: cacheKey, audio };
    },
    [clearPreloadedAudio],
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
      if (preloadedAudioRef.current?.key === cacheKey) return;

      void resolveParsedSong(nextSong, quality)
        .then((parsed) => {
          if (!parsed?.url) return;
          if (getParsedSongCacheKey(nextSong, audioQualityRef.current) !== cacheKey) {
            return;
          }

          preloadAudioUrl(cacheKey, parsed.url);
          const patch: Partial<Song> = { url: parsed.url };
          if (parsed.pic && !nextSong.pic) patch.pic = parsed.pic;
          if (parsed.lrc) patch.lrc = parsed.lrc;
          setQueue((prev) =>
            prev.map((queuedSong) =>
              isSameSong(queuedSong, nextSong)
                ? { ...queuedSong, ...patch }
                : queuedSong,
            ),
          );
        })
        .catch((error) => {
          console.warn("Preload next song failed:", error);
        });
    },
    [getParsedSongCacheKey, preloadAudioUrl, resolveParsedSong],
  );

  const pausePlayback = useCallback(() => {
    const song = currentSongRef.current;
    if (!audioRef.current || !song) return;

    playRequestIdRef.current += 1;
    audioRef.current.pause();
    setIsPlaying(false);
    setIsLoading(false);
    updateMediaSession(song, "paused");
  }, [updateMediaSession]);

  const resumePlayback = useCallback(async () => {
    const song = currentSongRef.current;
    if (!audioRef.current || !song) return;

    if (!audioRef.current.src || audioRef.current.src === window.location.href) {
      await playSongRef.current(song);
      return;
    }

    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }

    const requestId = ++playRequestIdRef.current;
    setIsLoading(true);

    try {
      await audioRef.current.play();
      if (playRequestIdRef.current !== requestId || !isSameSong(currentSongRef.current, song)) return;
      setIsPlaying(true);
      setIsLoading(false);
      updateMediaSession(song, "playing");
    } catch (error: any) {
      if (playRequestIdRef.current !== requestId || !isSameSong(currentSongRef.current, song)) return;
      console.error("Resume playback failed:", error.name, error.message);
      setIsPlaying(false);
      setIsLoading(false);
      updateMediaSession(song, "paused");
      showPlayerNotice("播放被浏览器阻止，请再次点击播放", "warning");
    }
  }, [showPlayerNotice, updateMediaSession]);

  const playSong = useCallback(
    async (song: Song, forceQuality?: AudioQuality) => {
      if (!audioRef.current) return;

      // Determine effective quality
      const targetQuality = forceQuality || audioQualityRef.current;
      const cacheKey = getParsedSongCacheKey(song, targetQuality);

      const isCurrentSong = isSameSong(currentSongRef.current, song);
      const isDifferentQuality =
        forceQuality && forceQuality !== audioQualityRef.current;

      if (isCurrentSong && !isDifferentQuality && !forceQuality) {
        if (
          audioRef.current.src &&
          audioRef.current.src !== window.location.href
        ) {
          if (!audioRef.current.paused) {
            setIsPlaying(true);
            setIsLoading(false);
            updateMediaSession(currentSongRef.current, "playing");
          } else {
            await resumePlayback();
          }
          return;
        }
      }

      const requestId = ++playRequestIdRef.current;
      setIsLoading(true);
      if (!forceQuality) {
        retryCountRef.current = 0; // Reset retry if user manually clicked a new song
      }

      if (!isCurrentSong) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
      }

      let fullSong = { ...song };
      currentSongRef.current = fullSong;
      setCurrentSong(fullSong);

      // Queue management
      setQueue((prev) => {
        if (prev.find((s) => isSameSong(s, song))) return prev;
        return [...prev, fullSong];
      });

      try {
        // 单次 parse 获取 url / 歌词 / 封面，避免重复消耗积分
        const parsed = await resolveParsedSong(song, targetQuality);

        // Race condition check
        if (
          playRequestIdRef.current !== requestId ||
          !isSameSong(currentSongRef.current, song)
        ) {
          return;
        }

        // 用 parse 返回的完整数据补全播放地址、封面和歌词
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
            setQueue((prev) =>
              prev.map((s) =>
                isSameSong(s, song) ? { ...s, ...patch } : s,
              ),
            );
          }
        }

        const url = parsed?.url || null;

        if (url) {
          const resumeTime =
            isCurrentSong && isDifferentQuality ? audioRef.current.currentTime : 0;

          if (!isIOSRef.current) {
            // 酷我 CDN 不支持 CORS，crossOrigin="anonymous" 会导致请求失败
            // createMediaElementSource 绑定后的 Audio 播放非 CORS 源也会静音
            const needsCors =
              !url.includes("kuwo.cn") && !url.includes("sycdn.kuwo");

            if (!needsCors) {
              if (audioCtxConnectedRef.current || audioRef.current.crossOrigin) {
                console.log(
                  "[Player] 切换到无 CORS Audio（酷我源），可视化使用模拟模式",
                );
                createAudioElement(false);
              }
            } else {
              if (!audioCtxConnectedRef.current) {
                createAudioElement(true);
              }
              initAudioContext();
            }
          }

          const activeAudio = audioRef.current;
          const preloadedCurrentAudio = preloadedAudioRef.current;
          autoAdvanceStartedRef.current = false;
          activeAudio.src = url;
          activeAudio.load();

          if (preloadedCurrentAudio?.key === cacheKey) {
            const preloadedDuration = getFiniteAudioDuration(
              preloadedCurrentAudio.audio,
            );
            if (preloadedDuration > 0) setDuration(preloadedDuration);
            clearPreloadedAudio(cacheKey);
          }

          if (resumeTime > 0) {
            activeAudio.currentTime = resumeTime;
          }

          if (
            audioCtxRef.current &&
            audioCtxRef.current.state === "suspended"
          ) {
            audioCtxRef.current.resume().catch(() => {});
          }

          setIsPlaying(false);
          setIsLoading(true);

          try {
            const playPromise = activeAudio.play();
            if (playPromise !== undefined) {
              await playPromise;
            }

            if (
              playRequestIdRef.current !== requestId ||
              !isSameSong(currentSongRef.current, song)
            ) {
              return;
            }

            setIsPlaying(true);
            setIsLoading(false);
            updateMediaSession(fullSong, "playing");
            preloadNextSong(fullSong);
          } catch (error: any) {
            if (
              playRequestIdRef.current !== requestId ||
              !isSameSong(currentSongRef.current, song)
            ) {
              return;
            }

            if (error.name === "AbortError") {
              console.log("[Player] play() 被中断（AbortError），等待新请求");
              return;
            }

            console.error("Play start failed:", error.name, error.message);

            if (
              (error.name === "NotSupportedError" ||
                error.message?.includes("source")) &&
              retryCountRef.current === 0 &&
              targetQuality !== "128k"
            ) {
              console.warn(
                "Play promise rejected with source error, triggering fallback to 128k",
              );
              showPlayerNotice("当前音质不可播放，已尝试切换到 128K", "warning");
              retryCountRef.current = 1;
              playSongRef.current(fullSong, "128k");
              return;
            }

            setIsPlaying(false);
            setIsLoading(false);
            updateMediaSession(fullSong, "paused");
            showPlayerNotice("播放被浏览器阻止，请再次点击播放", "warning");
          }
        } else {
          // URL is null (Strict check failed in api.ts)
          console.warn(`No valid URL for ${song.name} [${targetQuality}]`);

          if (targetQuality !== "128k" && retryCountRef.current === 0) {
            console.warn("Retrying with 128k...");
            showPlayerNotice("当前音质不可播放，已尝试切换到 128K", "warning");
            retryCountRef.current = 1;
            playSongRef.current(fullSong, "128k");
            return;
          }

          showPlayerNotice("这首歌暂时无法播放，请换源或稍后再试", "error");
          audioRef.current.pause();
          audioRef.current.removeAttribute("src");
          audioRef.current.load();
          setCurrentTime(0);
          setDuration(0);
          setIsLoading(false);
          setIsPlaying(false);
          updateMediaSession(fullSong, "paused");
        }
      } catch (err) {
        if (playRequestIdRef.current === requestId) {
          setIsLoading(false);
          setIsPlaying(false);
          updateMediaSession(fullSong, "paused");
          showPlayerNotice("这首歌暂时无法播放，请换源或稍后再试", "error");
        }
        console.error("Error in playSong", err);
      }
    },
    [
      clearPreloadedAudio,
      createAudioElement,
      getParsedSongCacheKey,
      initAudioContext,
      preloadNextSong,
      resolveParsedSong,
      resumePlayback,
      showPlayerNotice,
      updateMediaSession,
    ],
  );

  // 始终保持 playSongRef 指向最新的 playSong，避免 stale closure
  playSongRef.current = playSong;

  useEffect(() => {
    if (!currentSong || !isPlaying) return;
    preloadNextSong(currentSong);
  }, [audioQuality, currentSong, isPlaying, playMode, preloadNextSong, queue]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !currentSongRef.current) return;
    if (!audioRef.current.paused) {
      pausePlayback();
    } else {
      void resumePlayback();
    }
  }, [pausePlayback, resumePlayback]);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
      updatePositionState();
    }
  }, [updatePositionState]);

  const playNext = useCallback((force = true) => {
    const q = queueRef.current;
    const c = currentSongRef.current;
    const mode = playModeRef.current;

    if (q.length === 0) return;

    if (!force && mode === "loop") {
      if (audioRef.current && c) {
        const requestId = playRequestIdRef.current;
        audioRef.current.currentTime = 0;
        autoAdvanceStartedRef.current = false;
        setIsLoading(true);
        audioRef.current
          .play()
          .then(() => {
            if (
              playRequestIdRef.current !== requestId ||
              !isSameSong(currentSongRef.current, c)
            ) {
              return;
            }
            setIsPlaying(true);
            setIsLoading(false);
            updateMediaSession(c, "playing");
          })
          .catch((e) => {
            if (
              playRequestIdRef.current !== requestId ||
              !isSameSong(currentSongRef.current, c)
            ) {
              return;
            }
            console.warn("单曲循环重播失败:", e);
            setIsPlaying(false);
            setIsLoading(false);
            updateMediaSession(c, "paused");
          });
      }
      return;
    }

    const nextIndex = getNextQueueIndex(q, c, mode);
    if (nextIndex < 0) return;

    const nextSong = q[nextIndex];
    if (!nextSong) return;

    if (c && isSameSong(nextSong, c)) {
      playSongRef.current(nextSong, audioQualityRef.current);
      return;
    }

    playSongRef.current(nextSong);
  }, [updateMediaSession]);

  const playPrev = useCallback(() => {
    const q = queueRef.current;
    const c = currentSongRef.current;
    const mode = playModeRef.current;

    if (q.length === 0) return;

    if (audioRef.current && audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      updatePositionState();
      return;
    }

    const prevIndex = getPrevQueueIndex(q, c, mode);
    if (prevIndex < 0) return;

    playSongRef.current(q[prevIndex]);
  }, [updatePositionState]);

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

  const addToQueue = useCallback((song: Song) => {
    setQueue((prev) => {
      if (prev.find((s) => isSameSong(s, song))) return prev;
      return [...prev, song];
    });
  }, []);

  const removeFromQueue = useCallback(
    (songId: string | number, source?: string) => {
      const current = currentSongRef.current;
      const previousQueue = queueRef.current;
      const removedIndex = previousQueue.findIndex(
        (s) => String(s.id) === String(songId) && (!source || s.source === source),
      );
      if (removedIndex < 0) return;

      const removedSong = previousQueue[removedIndex];
      const nextQueue = previousQueue.filter(
        (s) => !(String(s.id) === String(songId) && (!source || s.source === source)),
      );
      queueRef.current = nextQueue;
      setQueue(nextQueue);
      clearPreloadedAudio();

      if (!isSameSong(removedSong, current)) return;

      if (nextQueue.length > 0) {
        const nextSong = nextQueue[Math.min(removedIndex, nextQueue.length - 1)] || nextQueue[0];
        void playSongRef.current(nextSong);
        return;
      }

      playRequestIdRef.current += 1;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
      }
      currentSongRef.current = null;
      setCurrentSong(null);
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(false);
      setIsLoading(false);
    },
    [clearPreloadedAudio],
  );

  const clearQueue = useCallback(() => {
    clearPreloadedAudio();
    const current = currentSongRef.current;
    const nextQueue = current ? [current] : [];
    queueRef.current = nextQueue;
    setQueue(nextQueue);
  }, [clearPreloadedAudio]);

  const restoreQueue = useCallback((songs: Song[]) => {
    queueRef.current = songs;
    setQueue(songs);
  }, []);

  const togglePlayMode = useCallback(() => {
    setPlayMode((prev) => {
      if (prev === "sequence") return "loop";
      if (prev === "loop") return "shuffle";
      return "sequence";
    });
  }, []);

  const setAudioQuality = useCallback((q: AudioQuality) => {
    setAudioQualityState(q);
    // 使用 ref 避免 stale closure，不依赖 currentSong/isPlaying state
    if (
      currentSongRef.current &&
      audioRef.current &&
      !audioRef.current.paused
    ) {
      playSongRef.current(currentSongRef.current, q);
    }
  }, []);

  const actionsValue = useMemo(
    () => ({
      playSong,
      togglePlay,
      pausePlayback,
      resumePlayback,
      seek,
      playNext,
      playPrev,
      addToQueue,
      removeFromQueue,
      restoreQueue,
      togglePlayMode,
      clearQueue,
      setAudioQuality,
      initAudioContext,
    }),
    [
      playSong,
      togglePlay,
      pausePlayback,
      resumePlayback,
      seek,
      playNext,
      playPrev,
      addToQueue,
      removeFromQueue,
      restoreQueue,
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
    }),
    [currentTime, duration],
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
      volume,
      playMode,
      queue,
      analyser,
      audioQuality,
      playerNotice,
      actionsValue,
    ],
  );

  return (
    <PlayerActionsContext.Provider value={actionsValue}>
      <PlayerNoticeContext.Provider value={playerNotice}>
        <PlayerNowPlayingContext.Provider value={nowPlayingValue}>
          <PlayerQueueStateContext.Provider value={queueStateValue}>
            <PlayerSettingsContext.Provider value={settingsValue}>
              <PlayerAnalyserContext.Provider value={analyserValue}>
                <PlayerProgressContext.Provider value={progressValue}>
                  <PlayerContext.Provider value={contextValue}>{children}</PlayerContext.Provider>
                </PlayerProgressContext.Provider>
              </PlayerAnalyserContext.Provider>
            </PlayerSettingsContext.Provider>
          </PlayerQueueStateContext.Provider>
        </PlayerNowPlayingContext.Provider>
      </PlayerNoticeContext.Provider>
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
  volume: 1,
  playMode: "sequence",
  queue: [],
  analyser: null,
  audioQuality: "320k",
  playerNotice: null,
  playSong: async () => {},
  togglePlay: () => {},
  pausePlayback: () => {},
  resumePlayback: async () => {},
  seek: () => {},
  playNext: () => {},
  playPrev: () => {},
  addToQueue: () => {},
  removeFromQueue: () => {},
  restoreQueue: () => {},
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

export const usePlayerNotice = () => {
  const context = useContext(PlayerNoticeContext);
  return context ?? null;
};

export const usePlayerActions = () => {
  const context = useContext(PlayerActionsContext);
  if (!context) {
    console.warn(
      "[usePlayerActions] Provider 未就绪，返回默认动作（HMR 热更新中）",
    );
    return {
      playSong: PLAYER_DEFAULTS.playSong,
      togglePlay: PLAYER_DEFAULTS.togglePlay,
      pausePlayback: PLAYER_DEFAULTS.pausePlayback,
      resumePlayback: PLAYER_DEFAULTS.resumePlayback,
      seek: PLAYER_DEFAULTS.seek,
      playNext: PLAYER_DEFAULTS.playNext,
      playPrev: PLAYER_DEFAULTS.playPrev,
      addToQueue: PLAYER_DEFAULTS.addToQueue,
      removeFromQueue: PLAYER_DEFAULTS.removeFromQueue,
      restoreQueue: PLAYER_DEFAULTS.restoreQueue,
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
    };
  }
  return context;
};
