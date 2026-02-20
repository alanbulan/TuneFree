
import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { Song, PlayMode, AudioQuality } from '../types';
import { parseSongFull } from '../services/api';

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
  playSong: (song: Song, forceQuality?: AudioQuality) => Promise<void>;
  togglePlay: () => void;
  seek: (time: number) => void;
  playNext: (force?: boolean) => void;
  playPrev: () => void;
  addToQueue: (song: Song) => void;
  removeFromQueue: (songId: string | number) => void;
  togglePlayMode: () => void;
  clearQueue: () => void;
  setAudioQuality: (quality: AudioQuality) => void;
  initAudioContext: () => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

// Helper to get local storage safely
const getLocal = <T,>(key: string, def: T): T => {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : def;
    } catch {
        return def;
    }
};

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Initialize state from LocalStorage where appropriate
  const [currentSong, setCurrentSong] = useState<Song | null>(() => getLocal('tunefree_current_song', null));
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [queue, setQueue] = useState<Song[]>(() => getLocal('tunefree_queue', []));
  const [playMode, setPlayMode] = useState<PlayMode>(() => getLocal('tunefree_play_mode', 'sequence'));
  const [audioQuality, setAudioQualityState] = useState<AudioQuality>(() => getLocal('tunefree_quality', '320k'));
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  // 标记当前 Audio 是否已被 AudioContext 接管路由（一旦接管，不支持 CORS 的源会静音）
  const audioCtxConnectedRef = useRef(false);

  // Refs to solve Stale Closure issues in Event Listeners
  const playNextRef = useRef<((force?: boolean) => void) | null>(null);
  const playSongRef = useRef<(song: Song, forceQuality?: AudioQuality) => Promise<void>>(async () => {});
  const currentSongRef = useRef(currentSong);
  const queueRef = useRef(queue);
  const playModeRef = useRef(playMode);
  const audioQualityRef = useRef(audioQuality);
  
  // Track error retry to prevent loops
  const retryCountRef = useRef(0);

  // Persistence Effects
  useEffect(() => {
      localStorage.setItem('tunefree_queue', JSON.stringify(queue));
      queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
      localStorage.setItem('tunefree_current_song', JSON.stringify(currentSong));
      currentSongRef.current = currentSong;
  }, [currentSong]);

  useEffect(() => {
      localStorage.setItem('tunefree_play_mode', JSON.stringify(playMode));
      playModeRef.current = playMode;
  }, [playMode]);
  
  useEffect(() => {
      localStorage.setItem('tunefree_quality', JSON.stringify(audioQuality));
      audioQualityRef.current = audioQuality;
  }, [audioQuality]);

  // --- Audio 事件处理器（提取为 ref 避免重复定义，支持 Audio 元素重建） ---
  const handlersRef = useRef<{
      timeupdate: () => void;
      loadedmetadata: () => void;
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
          oldAudio.removeAttribute('src');
          if (handlersRef.current) {
              oldAudio.removeEventListener('timeupdate', handlersRef.current.timeupdate);
              oldAudio.removeEventListener('loadedmetadata', handlersRef.current.loadedmetadata);
              oldAudio.removeEventListener('ended', handlersRef.current.ended);
              oldAudio.removeEventListener('error', handlersRef.current.error);
              oldAudio.removeEventListener('waiting', handlersRef.current.waiting);
              oldAudio.removeEventListener('canplay', handlersRef.current.canplay);
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

      const handlers = {
          timeupdate: () => setCurrentTime(audio.currentTime),
          loadedmetadata: () => {
              setDuration(audio.duration);
              setIsLoading(false);
              retryCountRef.current = 0;
              if ('mediaSession' in navigator && !isNaN(audio.duration)) {
                  try {
                      navigator.mediaSession.setPositionState({
                          duration: audio.duration,
                          playbackRate: audio.playbackRate,
                          position: audio.currentTime
                      });
                  } catch(e) { /* ignore */ }
              }
          },
          ended: () => {
              console.log('[Player] 歌曲播放结束，触发自动播放下一首');
              if (playNextRef.current) playNextRef.current(false);
          },
          error: (e: any) => {
              const errorCode = audio.error?.code;
              const errorMessage = audio.error?.message;
              console.warn(`Audio Element Error: Code=${errorCode}, Msg=${errorMessage}`);
              if (currentSongRef.current && audioQualityRef.current !== '128k' && retryCountRef.current === 0) {
                  console.warn(`Triggering fallback to 128k for ${currentSongRef.current.name}`);
                  retryCountRef.current = 1;
                  playSongRef.current(currentSongRef.current, '128k');
                  return;
              }
              console.error("Critical playback failure.", audio.error);
              setIsLoading(false);
              setIsPlaying(false);
              retryCountRef.current = 0;
          },
          waiting: () => setIsLoading(true),
          canplay: () => setIsLoading(false),
      };

      audio.addEventListener('timeupdate', handlers.timeupdate);
      audio.addEventListener('loadedmetadata', handlers.loadedmetadata);
      audio.addEventListener('ended', handlers.ended);
      audio.addEventListener('error', handlers.error);
      audio.addEventListener('waiting', handlers.waiting);
      audio.addEventListener('canplay', handlers.canplay);

      handlersRef.current = handlers;
      audioRef.current = audio;
      return audio;
  }, []);

  // --- Audio Element 初始化（不预设 crossOrigin，由 playSong 根据源动态决定） ---
  useEffect(() => {
    createAudioElement(false);

    return () => {
      const audio = audioRef.current;
      if (audio) {
          audio.pause();
          if (handlersRef.current) {
              audio.removeEventListener('timeupdate', handlersRef.current.timeupdate);
              audio.removeEventListener('loadedmetadata', handlersRef.current.loadedmetadata);
              audio.removeEventListener('ended', handlersRef.current.ended);
              audio.removeEventListener('error', handlersRef.current.error);
              audio.removeEventListener('waiting', handlersRef.current.waiting);
              audio.removeEventListener('canplay', handlersRef.current.canplay);
          }
      }
      if (audioCtxRef.current) {
          audioCtxRef.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- AudioContext 延迟初始化（需要用户交互上下文） ---
  const initAudioContext = useCallback(() => {
      if (audioCtxRef.current || !audioRef.current) return;
      try {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
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
          console.warn('AudioContext 初始化失败，使用模拟可视化', e);
      }
  }, []);

  // 页面可见性变化：后台时断开 Web Audio 路由让 Audio 直接播放，前台时重连可视化
  useEffect(() => {
      const handleVisibility = () => {
          const ctx = audioCtxRef.current;
          const source = sourceNodeRef.current;
          const node = analyserRef.current;

          if (document.visibilityState === 'hidden') {
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
              if (ctx && ctx.state === 'suspended') {
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
      document.addEventListener('visibilitychange', handleVisibility);
      return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // --- Logic Definitions ---

  const playSong = async (song: Song, forceQuality?: AudioQuality) => {
    if (!audioRef.current) return;

    // Determine effective quality
    const targetQuality = forceQuality || audioQualityRef.current;

    const isSameSong = currentSongRef.current?.id === song.id;
    const isDifferentQuality = forceQuality && forceQuality !== audioQualityRef.current;

    // Logic: If same song, same quality, and audio has source -> toggle
    if (isSameSong && !isDifferentQuality && !forceQuality) {
        if (audioRef.current.src && audioRef.current.src !== window.location.href) {
             togglePlay();
             return;
        }
    }

    setIsLoading(true);
    if (!forceQuality) {
        retryCountRef.current = 0; // Reset retry if user manually clicked a new song
    }

    let fullSong = { ...song };
    setCurrentSong(fullSong);

    // Queue management
    setQueue(prev => {
        if (prev.find(s => String(s.id) === String(song.id))) return prev;
        return [...prev, fullSong];
    });

    try {
        // 单次 parse 获取 url / 歌词 / 封面，避免重复消耗积分
        const parsed = await parseSongFull(song.id, song.source, targetQuality);

        // Race condition check
        if (currentSongRef.current?.id !== song.id) {
            return;
        }

        // 用 parse 返回的完整数据补全封面和歌词
        if (parsed) {
            if ((parsed.pic && !fullSong.pic) || parsed.lrc) {
                const patch: Partial<Song> = {};
                if (parsed.pic && !fullSong.pic) patch.pic = parsed.pic;
                if (parsed.lrc) patch.lrc = parsed.lrc;
                fullSong = { ...fullSong, ...patch };
                setCurrentSong(prev => prev && prev.id === song.id ? { ...prev, ...patch } : prev);
                setQueue(prev => prev.map(s => String(s.id) === String(song.id) ? { ...s, ...patch } : s));
            }
        }

        const url = parsed?.url || null;

        if (url) {
            fullSong.url = url;
            const resumeTime = (isSameSong && isDifferentQuality) ? audioRef.current.currentTime : 0;

            // 酷我 CDN 不支持 CORS，crossOrigin="anonymous" 会导致请求失败
            // createMediaElementSource 绑定后的 Audio 播放非 CORS 源也会静音
            // 需要根据源切换 Audio 元素：CORS 源用带 crossOrigin 的 Audio + AudioContext，非 CORS 源用干净 Audio
            const needsCors = !url.includes('kuwo.cn') && !url.includes('sycdn.kuwo');

            if (!needsCors) {
                // 非 CORS 源（酷我）：需要无 crossOrigin 的干净 Audio
                if (audioCtxConnectedRef.current || audioRef.current.crossOrigin) {
                    console.log('[Player] 切换到无 CORS Audio（酷我源），可视化使用模拟模式');
                    createAudioElement(false);
                }
            } else {
                // CORS 源：确保 AudioContext 已初始化
                if (!audioCtxConnectedRef.current) {
                    createAudioElement(true);
                }
                initAudioContext();
            }

            audioRef.current.src = url;
            audioRef.current.load();

            if (resumeTime > 0) {
                audioRef.current.currentTime = resumeTime;
            }

            if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
                audioCtxRef.current.resume();
            }

            // 乐观更新：先设置播放状态，避免切换音质时 UI 闪烁到暂停
            setIsPlaying(true);
            setIsLoading(false);

            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        updateMediaSession(fullSong, 'playing');
                    })
                    .catch(error => {
                        // AbortError: play() 被新的 load() 中断（切换音质场景），忽略
                        if (error.name === 'AbortError') {
                            console.log('[Player] play() 被中断（AbortError），等待新请求');
                            return;
                        }

                        console.error("Play start failed:", error.name, error.message);

                        // Handle "NotSupportedError" (Format not supported/Source invalid)
                        // Trigger fallback if we haven't already
                        if ((error.name === 'NotSupportedError' || error.message.includes('source')) && retryCountRef.current === 0 && targetQuality !== '128k') {
                            console.warn("Play promise rejected with source error, triggering fallback to 128k");
                            retryCountRef.current = 1;
                            playSong(song, '128k');
                            return;
                        }

                        if (error.name === 'NotAllowedError') {
                            setIsPlaying(false);
                            setIsLoading(false);
                        }
                    });
            }
        } else {
            // URL is null (Strict check failed in api.ts)
            console.warn(`No valid URL for ${song.name} [${targetQuality}]`);
            
            if (targetQuality !== '128k' && retryCountRef.current === 0) {
                 console.warn("Retrying with 128k...");
                 retryCountRef.current = 1;
                 playSong(song, '128k');
                 return;
            }

            setIsLoading(false);
            setIsPlaying(false);
            // alert('无法播放此歌曲'); // Optional: show toast
        }
    } catch (err) {
        setIsLoading(false);
        console.error("Error in playSong", err);
    }
  };

  // 始终保持 playSongRef 指向最新的 playSong，避免 stale closure
  playSongRef.current = playSong;

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !currentSongRef.current) return;

    if (!audioRef.current.src || audioRef.current.src === window.location.href) {
        playSongRef.current(currentSongRef.current);
        return;
    }

    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      updateMediaSession(currentSongRef.current, 'paused');
    } else {
      audioRef.current.play().catch(e => console.error("Toggle play error", e));
      setIsPlaying(true);
      updateMediaSession(currentSongRef.current, 'playing');
    }
  }, [isPlaying]);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
      updatePositionState();
    }
  }, []);

  const playNext = useCallback((force = true) => {
    const q = queueRef.current;
    const c = currentSongRef.current;
    const mode = playModeRef.current;
    
    if (q.length === 0) return;

    if (!force && mode === 'loop') {
        if (audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(e => console.warn('单曲循环重播失败:', e));
        }
        return;
    }

    const currentIndex = c ? q.findIndex(s => String(s.id) === String(c.id)) : -1;
    let nextIndex = 0;

    if (mode === 'shuffle') {
        do {
            nextIndex = Math.floor(Math.random() * q.length);
        } while (q.length > 1 && nextIndex === currentIndex);
    } else {
        nextIndex = (currentIndex + 1) % q.length;
    }

    playSongRef.current(q[nextIndex]);
  }, []);

  const playPrev = useCallback(() => {
      const q = queueRef.current;
      const c = currentSongRef.current;
      const mode = playModeRef.current;

      if (q.length === 0) return;
      const currentIndex = c ? q.findIndex(s => String(s.id) === String(c.id)) : -1;
      let prevIndex = 0;

      if (mode === 'shuffle') {
          prevIndex = Math.floor(Math.random() * q.length);
      } else {
          prevIndex = (currentIndex - 1 + q.length) % q.length;
      }
      playSongRef.current(q[prevIndex]);
  }, []);

  useEffect(() => {
      playNextRef.current = playNext;
  }, [playNext]);

  const updateMediaSession = (song: Song | null, state: 'playing' | 'paused') => {
      if (!('mediaSession' in navigator) || !song) return;
      
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.name,
        artist: song.artist,
        album: song.album || 'TuneFree Music',
        artwork: song.pic ? [
            { src: song.pic, sizes: '96x96', type: 'image/jpeg' },
            { src: song.pic, sizes: '128x128', type: 'image/jpeg' },
            { src: song.pic, sizes: '192x192', type: 'image/jpeg' },
            { src: song.pic, sizes: '256x256', type: 'image/jpeg' },
            { src: song.pic, sizes: '384x384', type: 'image/jpeg' },
            { src: song.pic, sizes: '512x512', type: 'image/jpeg' },
        ] : []
      });

      navigator.mediaSession.playbackState = state;
  };

  const updatePositionState = () => {
      if ('mediaSession' in navigator && audioRef.current && !isNaN(audioRef.current.duration)) {
         try {
            navigator.mediaSession.setPositionState({
                duration: audioRef.current.duration,
                playbackRate: audioRef.current.playbackRate,
                position: audioRef.current.currentTime
            });
         } catch (e) { /* ignore */ }
      }
  };

  useEffect(() => {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => togglePlay());
        navigator.mediaSession.setActionHandler('pause', () => togglePlay());
        navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
        navigator.mediaSession.setActionHandler('nexttrack', () => playNext(true));
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime !== undefined) seek(details.seekTime);
        });
    }
  }, [togglePlay, playNext, playPrev, seek]);

  useEffect(() => {
      if(currentSong) {
          updateMediaSession(currentSong, isPlaying ? 'playing' : 'paused');
      }
  }, [currentSong, isPlaying]);

  const addToQueue = (song: Song) => {
    setQueue(prev => {
        if (prev.find(s => String(s.id) === String(song.id))) return prev;
        return [...prev, song];
    });
  };

  const removeFromQueue = (songId: string | number) => {
      setQueue(prev => prev.filter(s => String(s.id) !== String(songId)));
  };

  const clearQueue = () => {
      setQueue([]);
  };

  const togglePlayMode = () => {
      setPlayMode(prev => {
          if (prev === 'sequence') return 'loop';
          if (prev === 'loop') return 'shuffle';
          return 'sequence';
      });
  };

  const setAudioQuality = (q: AudioQuality) => {
      setAudioQualityState(q);
      if (currentSong && isPlaying) {
          playSong(currentSong, q);
      }
  };

  return (
    <PlayerContext.Provider value={{
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
      playSong,
      togglePlay,
      seek,
      playNext,
      playPrev,
      addToQueue,
      removeFromQueue,
      togglePlayMode,
      clearQueue,
      setAudioQuality,
      initAudioContext
    }}>
      {children}
    </PlayerContext.Provider>
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
  playMode: 'sequence',
  queue: [],
  analyser: null,
  audioQuality: '320k',
  playSong: async () => {},
  togglePlay: () => {},
  seek: () => {},
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
    console.warn('[usePlayer] Provider 未就绪，返回默认值（HMR 热更新中）');
    return PLAYER_DEFAULTS;
  }
  return context;
};
