
import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { Song } from '../types';
import { getSongUrl, getSongInfo } from '../services/api';

interface PlayerContextType {
  currentSong: Song | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playSong: (song: Song) => Promise<void>;
  togglePlay: () => void;
  seek: (time: number) => void;
  playNext: () => void;
  playPrev: () => void;
  addToQueue: (song: Song) => void;
  queue: Song[];
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
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    audioRef.current = new Audio();
    audioRef.current.preload = "auto"; // Ensure browser buffers ahead
    
    const audio = audioRef.current;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      setIsLoading(false);
      if (isPlaying) {
         audio.play().catch(e => {
            console.warn("Autoplay blocked", e);
            setIsPlaying(false);
         });
      }
    };

    const handleEnded = () => {
      playNext();
    };

    const handleError = (e: any) => {
        console.error("Audio error", e);
        setIsLoading(false);
        setIsPlaying(false);
        // Optional: Auto-skip on error after delay
        // setTimeout(() => playNext(), 3000);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playSong = async (song: Song) => {
    if (!audioRef.current) return;

    // Toggle if same song
    if (currentSong?.id === song.id) {
        togglePlay();
        return;
    }

    setIsLoading(true);
    
    // Optimistic update
    let fullSong = { ...song };
    setCurrentSong(fullSong);

    // Queue logic
    if (!queue.find(s => s.id === song.id)) {
        setQueue(prev => [...prev, fullSong]);
    }

    try {
        // 1. Get URL (The API returns a redirect link, which we can use directly)
        const url = await getSongUrl(song.id, song.source);
        
        // 2. Get Info (Cover Art) if missing
        if (!song.pic) {
            getSongInfo(song.id, song.source).then(info => {
                 if (info && info.pic) {
                    setCurrentSong(prev => prev && prev.id === song.id ? { ...prev, pic: info.pic } : prev);
                    setQueue(prev => prev.map(s => s.id === song.id ? { ...s, pic: info.pic } : s));
                 }
            });
        }

        if (url) {
            fullSong.url = url; // Store constructed URL
            audioRef.current.src = url;
            audioRef.current.load();
            setIsPlaying(true);
            // Attempt play
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

  const playNext = useCallback(() => {
    if (queue.length === 0 || !currentSong) return;
    const currentIndex = queue.findIndex(s => s.id === currentSong.id);
    const nextIndex = (currentIndex + 1) % queue.length;
    // Prevent immediate loop on error
    if (queue.length > 1 || !isPlaying) {
        playSong(queue[nextIndex]);
    } else if (queue.length > 1) {
         playSong(queue[nextIndex]);
    }
  }, [currentSong, queue]);

  const playPrev = useCallback(() => {
      if (queue.length === 0 || !currentSong) return;
      const currentIndex = queue.findIndex(s => s.id === currentSong.id);
      const prevIndex = (currentIndex - 1 + queue.length) % queue.length;
      playSong(queue[prevIndex]);
  }, [currentSong, queue]);

  const addToQueue = (song: Song) => {
    setQueue(prev => {
        if (prev.find(s => s.id === song.id)) return prev;
        return [...prev, song];
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
      playSong,
      togglePlay,
      seek,
      playNext,
      playPrev,
      addToQueue,
      queue
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
