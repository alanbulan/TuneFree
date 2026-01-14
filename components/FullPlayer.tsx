import React, { useEffect, useState, useRef } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { useLibrary } from '../contexts/LibraryContext';
import { getLyrics, downloadMusic } from '../services/api';
import { ParsedLyric } from '../types';
import { ChevronDownIcon, MoreIcon, PlayIcon, PauseIcon, NextIcon, PrevIcon, HeartIcon, HeartFillIcon, MusicIcon, DownloadIcon } from './Icons';

interface FullPlayerProps {
  isOpen: boolean;
  onClose: () => void;
}

const parseLrc = (lrc: string): ParsedLyric[] => {
  if (!lrc) return [];
  const lines = lrc.split('\n');
  const result: ParsedLyric[] = [];
  const timeExp = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
  for (const line of lines) {
    const match = timeExp.exec(line);
    if (match) {
      const time = parseInt(match[1]) * 60 + parseInt(match[2]) + parseInt(match[3]) / 1000;
      const text = line.replace(timeExp, '').trim();
      if (text) result.push({ time, text });
    }
  }
  return result;
};

const formatTime = (seconds: number) => {
  if (isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const FullPlayer: React.FC<FullPlayerProps> = ({ isOpen, onClose }) => {
  const { currentSong, isPlaying, togglePlay, playNext, playPrev, currentTime, duration, seek } = usePlayer();
  const { isFavorite, toggleFavorite } = useLibrary();
  const [lyrics, setLyrics] = useState<ParsedLyric[]>([]);
  const [activeLyricIndex, setActiveLyricIndex] = useState(0);
  const [showLyrics, setShowLyrics] = useState(false);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && currentSong) {
      getLyrics(currentSong.id, currentSong.source).then(rawLrc => {
        if (rawLrc) setLyrics(parseLrc(rawLrc));
        else setLyrics([{ time: 0, text: "暂无歌词" }]);
      });
    }
  }, [currentSong, isOpen]);

  useEffect(() => {
    const index = lyrics.findIndex((line, i) => {
      const nextLine = lyrics[i + 1];
      return currentTime >= line.time && (!nextLine || currentTime < nextLine.time);
    });
    if (index !== -1 && index !== activeLyricIndex) {
      setActiveLyricIndex(index);
      if (lyricsContainerRef.current && showLyrics) {
         const activeEl = lyricsContainerRef.current.children[index] as HTMLElement;
         activeEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentTime, lyrics, activeLyricIndex, showLyrics]);

  if (!isOpen || !currentSong) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white overflow-hidden transition-all duration-300">
      {/* Background */}
      {currentSong.pic && (
        <div 
            className="absolute inset-0 z-0 opacity-40 scale-150 blur-3xl transition-opacity duration-1000"
            style={{ 
                backgroundImage: `url(${currentSong.pic})`,
                backgroundPosition: 'center',
                backgroundSize: 'cover'
            }}
        />
      )}
      <div className="absolute inset-0 z-0 bg-white/60 backdrop-blur-3xl" />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-safe mt-4 pb-2">
        <button onClick={onClose} className="p-2 text-gray-500 hover:text-black">
          <ChevronDownIcon size={30} />
        </button>
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto absolute left-0 right-0 top-safe mt-4" />
        <button className="p-2 text-gray-500 hover:text-black">
          <MoreIcon size={24} />
        </button>
      </div>

      {/* Content */}
      <div 
        className="relative z-10 flex-1 flex flex-col items-center justify-center w-full px-8 my-4"
        onClick={() => setShowLyrics(!showLyrics)}
      >
        {!showLyrics ? (
            <div className="w-full aspect-square max-w-[320px] bg-gray-100 shadow-[0_25px_60px_-12px_rgba(0,0,0,0.15)] rounded-3xl overflow-hidden mb-10 transition-transform duration-500 flex items-center justify-center">
                {currentSong.pic ? (
                    <img 
                        src={currentSong.pic} 
                        alt="Album" 
                        className={`w-full h-full object-cover transition-transform duration-700 ${isPlaying ? 'scale-100' : 'scale-95'}`}
                    />
                ) : (
                    <MusicIcon size={64} className="text-gray-300" />
                )}
            </div>
        ) : (
            <div className="w-full h-[55vh] overflow-y-auto no-scrollbar mask-gradient" ref={lyricsContainerRef}>
                <div className="h-[25vh]"></div>
                {lyrics.map((line, i) => (
                    <p 
                        key={i} 
                        className={`text-center my-6 text-lg font-bold transition-all duration-300 ${
                            i === activeLyricIndex ? 'text-black scale-105' : 'text-gray-400/60 scale-95 blur-[0.5px]'
                        }`}
                    >
                        {line.text}
                    </p>
                ))}
                <div className="h-[25vh]"></div>
            </div>
        )}

        <div className="w-full flex items-center justify-between mt-4 px-2">
             <div className="flex-1 min-w-0 pr-4">
                <h2 className="text-2xl font-bold truncate text-black leading-tight">{currentSong.name}</h2>
                <div className="flex items-center space-x-2 mt-1">
                    <span className="text-xs font-bold text-white bg-gray-400 px-1.5 py-0.5 rounded uppercase">{currentSong.source}</span>
                    <p className="text-lg text-ios-red/90 font-medium truncate">{currentSong.artist}</p>
                </div>
             </div>
             
             <div className="flex items-center space-x-3">
                 <button 
                    onClick={(e) => { e.stopPropagation(); downloadMusic(currentSong); }}
                    className="p-2 rounded-full active:scale-90 transition-transform text-gray-500 hover:text-black"
                    title="下载歌曲"
                 >
                    <DownloadIcon size={26} />
                 </button>
                 <button 
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(currentSong); }}
                    className="p-2 rounded-full active:scale-90 transition-transform"
                 >
                    {isFavorite(Number(currentSong.id)) ? 
                        <HeartFillIcon className="text-ios-red" size={28} /> : 
                        <HeartIcon className="text-gray-400" size={28} />
                    }
                 </button>
             </div>
        </div>
      </div>

      {/* Controls */}
      <div className="relative z-10 w-full px-8 pb-safe mb-8">
        <div className="w-full mb-8">
            <input 
                type="range" 
                min={0} 
                max={duration || 100} 
                value={currentTime} 
                onChange={(e) => seek(parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-black hover:h-2 transition-all"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-3 font-medium font-mono">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
            </div>
        </div>

        <div className="flex items-center justify-between px-4">
            <button onClick={playPrev} className="text-black hover:opacity-70 transition active:scale-90">
                <PrevIcon size={38} className="fill-current" />
            </button>
            <button 
                onClick={togglePlay} 
                className="w-20 h-20 bg-black text-white rounded-full flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all"
            >
                {isPlaying ? <PauseIcon size={32} className="fill-current" /> : <PlayIcon size={32} className="fill-current ml-1" />}
            </button>
            <button onClick={playNext} className="text-black hover:opacity-70 transition active:scale-90">
                <NextIcon size={38} className="fill-current" />
            </button>
        </div>
      </div>
    </div>
  );
};

export default FullPlayer;
