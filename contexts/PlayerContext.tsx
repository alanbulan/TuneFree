
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

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [queue, setQueue] = useState<Song[]>([]);
  const [playMode, setPlayMode] = useState<PlayMode>('sequence');
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = "anonymous"; // Required for real audio visualization
    audioRef.current = audio;
    audio.preload = "auto"; 
    
    // Initialize Web Audio API
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
        console.warn("Web Audio API setup failed or restricted:", e);
    }

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      setIsLoading(false);
      if (isPlaying) {
         // Resume context if suspended (browser autoplay policy)
         if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
             audioCtxRef.current.resume();
         }
         audio.play().catch(e => {
            console.warn("Autoplay blocked", e);
            setIsPlaying(false);
         });
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
  }, []); // Intentionally empty to run once

  const playSong = async (song: Song) => {
    if (!audioRef.current) return;

    if (currentSong?.id === song.id) {
        togglePlay();
        return;
    }

    setIsLoading(true);
    let fullSong = { ...song };
    setCurrentSong(fullSong);

    // Add to queue if not present
    setQueue(prev => {
        if (prev.find(s => s.id === song.id)) return prev;
        return [...prev, fullSong];
    });

    try {
        const url = await getSongUrl(song.id, song.source);
        
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
            setIsPlaying(true);
            
            if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
                audioCtxRef.current.resume();
            }

            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.error("Play failed", error);
                    setIsPlaying(false);
                });
            }
        } else {
            setIsLoading(false);
            console.error("Could not obtain song URL");
        }
    } catch (err) {
        setIsLoading(false);
        console.error("Error in playSong", err);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current || !currentSong) return;
    
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(e => console.error(e));
      setIsPlaying(true);
    }
  };

  const seek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  // force: true means user clicked "Next", false means auto-ended
  const playNext = useCallback((force = true) => {
    if (queue.length === 0 || !currentSong) return;

    // Handle Loop Single mode on auto-end
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
        // Simple random next
        do {
            nextIndex = Math.floor(Math.random() * queue.length);
        } while (queue.length > 1 && nextIndex === currentIndex);
    } else {
        // Sequence or when user forces next in loop mode
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
      // Optionally stop playing or keep current song
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
