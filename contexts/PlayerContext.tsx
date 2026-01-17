
import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { Song, PlayMode, AudioQuality } from '../types';
import { getSongUrl, getSongInfo } from '../services/api';

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
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Refs to solve Stale Closure issues in Event Listeners
  const playNextRef = useRef<((force?: boolean) => void) | null>(null);
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

  // --- Audio Element Initialization ---
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto"; 
    (audio as any).playsInline = true; 
    
    audioRef.current = audio;
    
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      setIsLoading(false);
      retryCountRef.current = 0; // Success, reset retry
      
      // Update Media Session position
      if ('mediaSession' in navigator && !isNaN(audio.duration)) {
         try {
             navigator.mediaSession.setPositionState({
                 duration: audio.duration,
                 playbackRate: audio.playbackRate,
                 position: audio.currentTime
             });
         } catch(e) { /* ignore errors */ }
      }
    };

    const handleEnded = () => {
      if (playNextRef.current) {
          playNextRef.current(false);
      }
    };

    const handleError = (e: any) => {
        const errorCode = audio.error?.code;
        const errorMessage = audio.error?.message;
        console.warn(`Audio Element Error: Code=${errorCode}, Msg=${errorMessage}`);

        // Fallback Logic: If 320k/flac fails, try 128k
        if (currentSongRef.current && audioQualityRef.current !== '128k' && retryCountRef.current === 0) {
            console.warn(`Triggering fallback to 128k for ${currentSongRef.current.name}`);
            retryCountRef.current = 1; 
            playSong(currentSongRef.current, '128k');
            return;
        }

        console.error("Critical playback failure.", audio.error);
        setIsLoading(false);
        setIsPlaying(false);
        retryCountRef.current = 0;
    };

    const handleWaiting = () => {
        setIsLoading(true);
    };

    const handleCanPlay = () => {
        setIsLoading(false);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('canplay', handleCanPlay);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.pause();
      if (audioCtxRef.current) {
          audioCtxRef.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        const url = await getSongUrl(song.id, song.source, targetQuality);
        
        // Race condition check
        if (currentSongRef.current?.id !== song.id) {
            return;
        }

        // Optimistic UI update for pic
        if (!song.pic) {
            getSongInfo(song.id, song.source).then(info => {
                 if (info && info.pic && currentSongRef.current?.id === song.id) {
                    const updated = { ...fullSong, pic: info.pic };
                    setCurrentSong(prev => prev && prev.id === song.id ? updated : prev);
                    setQueue(prev => prev.map(s => s.id === song.id ? updated : s));
                 }
            });
        }

        if (url) {
            fullSong.url = url;
            const resumeTime = (isSameSong && isDifferentQuality) ? audioRef.current.currentTime : 0;
            
            audioRef.current.src = url;
            audioRef.current.load();
            
            if (resumeTime > 0) {
                audioRef.current.currentTime = resumeTime;
            }
            
            if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
                audioCtxRef.current.resume();
            }

            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        setIsPlaying(true);
                        updateMediaSession(fullSong, 'playing');
                    })
                    .catch(error => {
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

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !currentSongRef.current) return;
    
    if (!audioRef.current.src || audioRef.current.src === window.location.href) {
        playSong(currentSongRef.current);
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
            audioRef.current.play();
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

    playSong(q[nextIndex]);
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
      playSong(q[prevIndex]);
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
      setAudioQuality
    }}>
      {children}
    </PlayerContext.Provider>
  );
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return context;
};
