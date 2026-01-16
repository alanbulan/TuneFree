
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
  // This is CRITICAL for playNext/playPrev to work correctly when called from 'ended' event
  const playNextRef = useRef<((force?: boolean) => void) | null>(null);
  const currentSongRef = useRef(currentSong);
  const queueRef = useRef(queue);
  const playModeRef = useRef(playMode);
  const audioQualityRef = useRef(audioQuality);

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
    audio.crossOrigin = "anonymous"; 
    audio.preload = "auto"; 
    (audio as any).playsInline = true; 
    
    audioRef.current = audio;
    
    // --- COMPATIBILITY FIX FOR IOS/SAFARI ---
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (!isIOS) {
        try {
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioContext) {
                const ctx = new AudioContext();
                audioCtxRef.current = ctx;
                const analyserNode = ctx.createAnalyser();
                analyserNode.fftSize = 512;
                
                // Connect nodes: Source -> Analyser -> Destination
                const source = ctx.createMediaElementSource(audio);
                source.connect(analyserNode);
                analyserNode.connect(ctx.destination);
                
                setAnalyser(analyserNode);
            }
        } catch (e) {
            console.warn("Web Audio API setup failed:", e);
        }
    }

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      setIsLoading(false);
      // Update Media Session position
      if ('mediaSession' in navigator && !isNaN(audio.duration)) {
         try {
             navigator.mediaSession.setPositionState({
                 duration: audio.duration,
                 playbackRate: audio.playbackRate,
                 position: audio.currentTime
             });
         } catch(e) { /* ignore errors for infinite duration or similar */ }
      }
    };

    const handleEnded = () => {
      // Use ref to access latest playNext logic
      if (playNextRef.current) {
          playNextRef.current(false);
      }
    };

    const handleError = (e: any) => {
        console.error("Audio error", e);
        setIsLoading(false);
        setIsPlaying(false);
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

    // Toggle if same song AND same quality (reloading for quality change handled below)
    const isSameSong = currentSongRef.current?.id === song.id;
    const isDifferentQuality = forceQuality && forceQuality !== audioQuality; // Simplification, ideally track play quality

    if (isSameSong && !isDifferentQuality) {
        // If it has a src and is basically ready
        if (audioRef.current.src && audioRef.current.src !== window.location.href) {
             togglePlay();
             return;
        }
    }

    setIsLoading(true);
    let fullSong = { ...song };
    setCurrentSong(fullSong);

    // Queue management
    setQueue(prev => {
        if (prev.find(s => String(s.id) === String(song.id))) return prev;
        return [...prev, fullSong];
    });

    try {
        const url = await getSongUrl(song.id, song.source, targetQuality);
        
        // Optimistic UI update for pic
        if (!song.pic) {
            getSongInfo(song.id, song.source).then(info => {
                 if (info && info.pic) {
                    const updated = { ...fullSong, pic: info.pic };
                    setCurrentSong(prev => prev && prev.id === song.id ? updated : prev);
                    setQueue(prev => prev.map(s => s.id === song.id ? updated : s));
                 }
            });
        }

        if (url) {
            fullSong.url = url;
            // Preserve time if just switching quality of same song
            const resumeTime = (isSameSong && isDifferentQuality) ? audioRef.current.currentTime : 0;
            
            audioRef.current.src = url;
            audioRef.current.load();
            
            if (resumeTime > 0) {
                audioRef.current.currentTime = resumeTime;
            }
            
            // Resume Context (Desktop only)
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
                        console.error("Play failed", error);
                        setIsPlaying(false);
                    });
            }
        } else {
            setIsLoading(false);
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
      audioRef.current.play().catch(e => console.error(e));
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

    // Handle Loop Single Mode (only if not forced by user click)
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
  }, []); // Logic relies on refs, so deps are empty is technically ok if we use refs inside

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

  // Update refs in useEffect or useCallback
  useEffect(() => {
      playNextRef.current = playNext;
  }, [playNext]);


  // --- Helper for Media Session ---
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

  // --- Media Session Handlers Registration ---
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

  // Ensure metadata is fresh on song change
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
      // Immediately reload current song with new quality if playing
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
