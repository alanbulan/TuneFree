
import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { Song, PlayMode } from '../types';
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
  playSong: (song: Song) => Promise<void>;
  togglePlay: () => void;
  seek: (time: number) => void;
  playNext: (force?: boolean) => void;
  playPrev: () => void;
  addToQueue: (song: Song) => void;
  removeFromQueue: (songId: string | number) => void;
  togglePlayMode: () => void;
  clearQueue: () => void;
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
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Persistence Effects
  useEffect(() => {
      localStorage.setItem('tunefree_queue', JSON.stringify(queue));
  }, [queue]);

  useEffect(() => {
      localStorage.setItem('tunefree_current_song', JSON.stringify(currentSong));
  }, [currentSong]);

  useEffect(() => {
      localStorage.setItem('tunefree_play_mode', JSON.stringify(playMode));
  }, [playMode]);

  // --- Audio Element Initialization ---
  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = "anonymous"; 
    audio.preload = "auto"; 
    (audio as any).playsInline = true; 
    
    audioRef.current = audio;
    
    // --- COMPATIBILITY FIX FOR IOS/SAFARI ---
    // According to Apple's guidelines and practical PWA behavior:
    // Routing audio through Web Audio API (createMediaElementSource) causes the audio to be controlled by the AudioContext clock.
    // When iOS Safari backgrounds a tab, it suspends the AudioContext to save power, killing the audio stream.
    // To ensure persistent background playback, we MUST use the native <audio> element output on iOS.
    // We disable the AnalyserNode on iOS, which triggers the "Simulated" visualizer mode in the UI.
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
      playNext(false); // Auto play next
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

  const playSong = async (song: Song) => {
    if (!audioRef.current) return;

    // Toggle if same song
    if (currentSong?.id === song.id) {
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
        if (prev.find(s => s.id === song.id)) return prev;
        return [...prev, fullSong];
    });

    try {
        const url = await getSongUrl(song.id, song.source);
        
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
            audioRef.current.src = url;
            audioRef.current.load();
            
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
    if (!audioRef.current || !currentSong) return;
    
    if (!audioRef.current.src || audioRef.current.src === window.location.href) {
        playSong(currentSong);
        return;
    }
    
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      updateMediaSession(currentSong, 'paused');
    } else {
      audioRef.current.play().catch(e => console.error(e));
      setIsPlaying(true);
      updateMediaSession(currentSong, 'playing');
    }
  }, [isPlaying, currentSong]);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
      updatePositionState();
    }
  }, []);

  const playNext = useCallback((force = true) => {
    if (queue.length === 0 || !currentSong) return;

    if (!force && playMode === 'loop') {
        if (audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.play();
        }
        return;
    }

    const currentIndex = queue.findIndex(s => s.id === currentSong.id);
    let nextIndex = 0;

    if (playMode === 'shuffle') {
        do {
            nextIndex = Math.floor(Math.random() * queue.length);
        } while (queue.length > 1 && nextIndex === currentIndex);
    } else {
        nextIndex = (currentIndex + 1) % queue.length;
    }

    playSong(queue[nextIndex]);
  }, [currentSong, queue, playMode]);

  const playPrev = useCallback(() => {
      if (queue.length === 0 || !currentSong) return;
      const currentIndex = queue.findIndex(s => s.id === currentSong.id);
      let prevIndex = 0;

      if (playMode === 'shuffle') {
          prevIndex = Math.floor(Math.random() * queue.length);
      } else {
          prevIndex = (currentIndex - 1 + queue.length) % queue.length;
      }
      playSong(queue[prevIndex]);
  }, [currentSong, queue, playMode]);

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
        // We bind the handlers once, they will rely on the latest closures or refs if we used refs, 
        // BUT for React, we need to ensure these functions capture the correct state/props.
        // Re-registering them when dependencies change is the safest way in useEffect.
        
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
  }, [currentSong]);

  const addToQueue = (song: Song) => {
    setQueue(prev => {
        if (prev.find(s => s.id === song.id)) return prev;
        return [...prev, song];
    });
  };

  const removeFromQueue = (songId: string | number) => {
      setQueue(prev => prev.filter(s => s.id !== songId));
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
      playSong,
      togglePlay,
      seek,
      playNext,
      playPrev,
      addToQueue,
      removeFromQueue,
      togglePlayMode,
      clearQueue
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
