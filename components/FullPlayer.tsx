
import React, { useEffect, useState, useRef } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { useLibrary } from '../contexts/LibraryContext';
import { getLyrics } from '../services/api';
import { ParsedLyric } from '../types';
import { 
    ChevronDownIcon, MoreIcon, PlayIcon, PauseIcon, NextIcon, PrevIcon, 
    HeartIcon, HeartFillIcon, MusicIcon, DownloadIcon, 
    RepeatIcon, RepeatOneIcon, ShuffleIcon, QueueIcon
} from './Icons';
import AudioVisualizer from './AudioVisualizer';
import QueuePopup from './QueuePopup';
import DownloadPopup from './DownloadPopup';

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
  const { currentSong, isPlaying, togglePlay, playNext, playPrev, currentTime, duration, seek, playMode, togglePlayMode } = usePlayer();
  const { isFavorite, toggleFavorite } = useLibrary();
  const [lyrics, setLyrics] = useState<ParsedLyric[]>([]);
  const [activeLyricIndex, setActiveLyricIndex] = useState(0);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showDownload, setShowDownload] = useState(false);

  // Fetch Lyrics
  useEffect(() => {
    if (isOpen && currentSong) {
      // RESET STATE IMMEDIATELY to prevent old lyrics from showing
      setLyrics([]);
      setActiveLyricIndex(0);
      
      getLyrics(currentSong.id, currentSong.source).then(rawLrc => {
        if (rawLrc) setLyrics(parseLrc(rawLrc));
        else setLyrics([{ time: 0, text: "暂无歌词" }]);
      });
    }
  }, [currentSong, isOpen]);

  // Sync Lyrics Highlight
  useEffect(() => {
    if (lyrics.length === 0) return;
    
    const index = lyrics.findIndex((line, i) => {
      const nextLine = lyrics[i + 1];
      return currentTime >= line.time && (!nextLine || currentTime < nextLine.time);
    });
    
    if (index !== -1 && index !== activeLyricIndex) {
      setActiveLyricIndex(index);
    }
  }, [currentTime, lyrics, activeLyricIndex]);

  if (!isOpen || !currentSong) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white overflow-hidden transition-all duration-300">
      {/* Ambient Background */}
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

      {/* --- Header --- */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-safe mt-4 pb-2">
        <button onClick={onClose} className="p-2 text-gray-500 hover:text-black active:scale-90 transition">
          <ChevronDownIcon size={30} />
        </button>
        <div className="w-10 h-1 bg-gray-300/80 rounded-full mx-auto absolute left-0 right-0 top-safe mt-4 pointer-events-none" />
        <button className="p-2 text-gray-500 hover:text-black active:scale-90 transition">
          <MoreIcon size={24} />
        </button>
      </div>

      {/* --- Main Content Area (Layout Locked) --- */}
      {/* We use relative positioning to swap Cover and Lyrics without layout shift */}
      <div className="relative z-10 flex-1 w-full overflow-hidden flex flex-col">
          
          <div className="relative flex-1 w-full">
            {/* 1. Cover View */}
            <div 
                className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-500 ease-in-out px-8 ${showLyrics ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'}`}
                onClick={() => setShowLyrics(true)}
            >
                <div className="w-full aspect-square max-h-[350px] bg-gray-100 shadow-[0_25px_60px_-12px_rgba(0,0,0,0.15)] rounded-[2rem] overflow-hidden transition-transform duration-700">
                    {currentSong.pic ? (
                        <img 
                            src={currentSong.pic} 
                            alt="Album" 
                            className={`w-full h-full object-cover transition-transform duration-700 ${isPlaying ? 'scale-100' : 'scale-95'}`}
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <MusicIcon size={64} className="text-gray-300" />
                        </div>
                    )}
                </div>
            </div>

            {/* 2. Lyrics View */}
            <div 
                className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-500 ease-in-out ${showLyrics ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}
                onClick={() => setShowLyrics(false)}
            >
                <div className="w-full h-full max-h-[450px] overflow-hidden mask-gradient relative">
                    <div 
                        className="transition-transform duration-500 ease-out flex flex-col items-center w-full px-8"
                        style={{ transform: `translateY(${200 - (activeLyricIndex * 44)}px)` }} // 44px approx line height
                    >
                        {lyrics.length > 0 ? lyrics.map((line, i) => (
                            <p 
                                key={i} 
                                className={`text-center py-2 text-lg font-bold transition-all duration-300 w-full truncate ${
                                    i === activeLyricIndex 
                                    ? 'text-black scale-110 opacity-100' 
                                    : 'text-gray-500/60 scale-95 opacity-50 blur-[0.5px]'
                                }`}
                                style={{ height: '44px', lineHeight: '28px' }}
                            >
                                {line.text}
                            </p>
                        )) : (
                            <div className="flex flex-col items-center justify-center h-full pt-40">
                                <div className="w-6 h-6 border-2 border-gray-300 border-t-transparent rounded-full animate-spin mb-2"></div>
                                <p className="text-gray-400 text-sm">加载歌词中...</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
          </div>

          {/* Song Info (Fixed position below swapping area) */}
          <div className="px-8 mt-4 mb-2 min-h-[80px] flex items-center justify-between">
             <div className="flex-1 min-w-0 pr-4">
                <h2 className="text-2xl font-bold truncate text-black leading-tight">{currentSong.name}</h2>
                <div className="flex items-center space-x-2 mt-1">
                    <span className="text-[10px] font-bold text-white bg-gray-400 px-1.5 py-0.5 rounded uppercase">{currentSong.source}</span>
                    <p className="text-lg text-ios-red/90 font-medium truncate cursor-pointer hover:underline">{currentSong.artist}</p>
                </div>
             </div>
             
             <div className="flex items-center space-x-3">
                 <button 
                    onClick={(e) => { e.stopPropagation(); setShowDownload(true); }}
                    className="p-2 rounded-full active:scale-90 transition-transform text-gray-500 hover:text-black"
                 >
                    <DownloadIcon size={24} />
                 </button>
                 <button 
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(currentSong); }}
                    className="p-2 rounded-full active:scale-90 transition-transform"
                 >
                    {isFavorite(Number(currentSong.id)) ? 
                        <HeartFillIcon className="text-ios-red" size={26} /> : 
                        <HeartIcon className="text-gray-400" size={26} />
                    }
                 </button>
             </div>
          </div>
      </div>

      {/* --- Footer Controls --- */}
      <div className="relative z-10 w-full px-8 pb-safe mb-4">
        
        {/* Audio Visualizer */}
        <div className="mb-2 h-6 flex items-end">
            <AudioVisualizer isPlaying={isPlaying} />
        </div>

        {/* Progress Bar */}
        <div className="w-full mb-6 group">
            <input 
                type="range" 
                min={0} 
                max={duration || 100} 
                value={currentTime} 
                onChange={(e) => seek(parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-black hover:h-1.5 transition-all"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-2 font-medium font-mono tabular-nums">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
            </div>
        </div>

        {/* Main Controls */}
        <div className="flex items-center justify-between mb-4">
            <button 
                onClick={togglePlayMode} 
                className={`p-2 transition active:scale-90 ${playMode !== 'sequence' ? 'text-ios-red' : 'text-gray-400 hover:text-gray-600'}`}
                title="切换模式"
            >
                {playMode === 'sequence' && <RepeatIcon size={22} />}
                {playMode === 'loop' && <RepeatOneIcon size={22} />}
                {playMode === 'shuffle' && <ShuffleIcon size={22} />}
            </button>

            <div className="flex items-center gap-8">
                <button onClick={playPrev} className="text-black hover:opacity-70 transition active:scale-90">
                    <PrevIcon size={40} className="fill-current" />
                </button>
                <button 
                    onClick={togglePlay} 
                    className="w-20 h-20 bg-black text-white rounded-full flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all"
                >
                    {isPlaying ? <PauseIcon size={32} className="fill-current" /> : <PlayIcon size={32} className="fill-current ml-1" />}
                </button>
                <button onClick={() => playNext(true)} className="text-black hover:opacity-70 transition active:scale-90">
                    <NextIcon size={40} className="fill-current" />
                </button>
            </div>

            <button 
                onClick={() => setShowQueue(true)}
                className="p-2 text-gray-400 hover:text-black transition active:scale-90"
            >
                <QueueIcon size={22} />
            </button>
        </div>
      </div>

      {/* Popups */}
      <QueuePopup isOpen={showQueue} onClose={() => setShowQueue(false)} />
      <DownloadPopup isOpen={showDownload} onClose={() => setShowDownload(false)} song={currentSong} />
    </div>
  );
};

export default FullPlayer;
