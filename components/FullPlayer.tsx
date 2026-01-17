
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
import PlayerMorePopup from './PlayerMorePopup';
import { motion, PanInfo } from 'framer-motion';

interface FullPlayerProps {
  isOpen: boolean;
  onClose: () => void;
  layoutId?: string;
}

const parseLrc = (lrc: string): ParsedLyric[] => {
  if (!lrc) return [];
  const lines = lrc.split('\n');
  const raw: { time: number; text: string }[] = [];
  const timeExp = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
  
  for (const line of lines) {
    const match = timeExp.exec(line);
    if (match) {
      const min = parseInt(match[1]);
      const sec = parseInt(match[2]);
      const msStr = match[3];
      const msVal = parseInt(msStr);
      const ms = msStr.length === 2 ? msVal * 10 : msVal;
      
      const time = min * 60 + sec + ms / 1000;
      const text = line.replace(timeExp, '').trim();
      
      if (text) {
          raw.push({ time, text });
      }
    }
  }

  raw.sort((a, b) => a.time - b.time);

  const result: ParsedLyric[] = [];
  for (const item of raw) {
      const last = result[result.length - 1];
      if (last && Math.abs(last.time - item.time) < 0.2) {
          if (!last.translation) {
              last.translation = item.text;
          }
      } else {
          result.push({ time: item.time, text: item.text });
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

const FullPlayer: React.FC<FullPlayerProps> = ({ isOpen, onClose, layoutId }) => {
  const { currentSong, isPlaying, togglePlay, playNext, playPrev, currentTime, duration, seek, playMode, togglePlayMode, queue } = usePlayer();
  const { isFavorite, toggleFavorite } = useLibrary();
  const [lyrics, setLyrics] = useState<ParsedLyric[]>([]);
  const [activeLyricIndex, setActiveLyricIndex] = useState(0);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [showMore, setShowMore] = useState(false);
  
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  // Fetch Lyrics
  useEffect(() => {
    if (isOpen && currentSong) {
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

  // Scroll Lyrics
  useEffect(() => {
      if (showLyrics && lyricsContainerRef.current && lyrics.length > 0) {
          const activeEl = lyricsContainerRef.current.children[activeLyricIndex] as HTMLElement;
          if (activeEl) {
              const container = lyricsContainerRef.current;
              const scrollNew = activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
              container.scrollTo({ top: scrollNew, behavior: 'smooth' });
          }
      }
  }, [activeLyricIndex, showLyrics, lyrics]);

  const hasSong = !!currentSong;

  // Gesture Handler
  const handleDragEnd = (_: any, info: PanInfo) => {
    // Dismiss threshold
    if (info.offset.y > 150 || info.velocity.y > 300) {
        onClose();
    }
  };

  return (
    <motion.div 
      layoutId={layoutId}
      className="fixed inset-0 z-50 flex flex-col bg-white overflow-hidden touch-none"
      // Animation Config
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 300, mass: 0.8 }}
      
      // Drag Config
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.05, bottom: 0.5 }} // Stiff top, rubbery bottom
      dragDirectionLock={true}
      onDragEnd={handleDragEnd}
      
      // Stop overscroll chaining to body (prevents browser back swipe)
      style={{ overscrollBehavior: 'none' }}
    >
      {/* 
         Content Wrapper
         We wrap content in a separate motion div to fade it in/out slightly delayed from the container morph
         to prevent "stretching" of internal text/images during the shared layout transition.
      */}
      <motion.div 
        className="flex flex-col h-full w-full relative"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      >
          {/* Ambient Background */}
          {hasSong && currentSong.pic && (
            <div 
                className="absolute inset-0 z-0 opacity-40 scale-150 blur-3xl transition-opacity duration-1000 pointer-events-none"
                style={{ 
                    backgroundImage: `url(${currentSong.pic})`,
                    backgroundPosition: 'center',
                    backgroundSize: 'cover'
                }}
            />
          )}
          <div className="absolute inset-0 z-0 bg-white/60 backdrop-blur-3xl pointer-events-none" />

          {/* --- Header (Draggable Area) --- */}
          <div className="relative z-10 flex items-center justify-between px-6 pt-safe mt-4 pb-2">
            <button onClick={onClose} className="p-2 text-gray-500 hover:text-black active:scale-90 transition">
              <ChevronDownIcon size={30} />
            </button>
            {/* Drag Handle Indicator */}
            <div className="w-10 h-1.5 bg-gray-300/80 rounded-full mx-auto absolute left-0 right-0 top-safe mt-4 pointer-events-none" />
            <button 
                onClick={() => hasSong && setShowMore(true)} 
                className={`p-2 transition active:scale-90 ${hasSong ? 'text-gray-500 hover:text-black' : 'text-gray-300'}`}
                disabled={!hasSong}
            >
              <MoreIcon size={24} />
            </button>
          </div>

          {/* --- Main Content Area --- */}
          <div className="relative z-10 flex-1 w-full overflow-hidden flex flex-col">
              
              <div className="relative flex-1 w-full">
                {/* 1. Cover View */}
                <motion.div 
                    className={`absolute inset-0 flex flex-col items-center justify-center px-8`}
                    animate={{ opacity: showLyrics ? 0 : 1, scale: showLyrics ? 0.95 : 1 }}
                    style={{ pointerEvents: showLyrics ? 'none' : 'auto' }}
                    onClick={() => hasSong && setShowLyrics(true)}
                >
                    <div className="w-full aspect-square max-h-[350px] bg-gray-100 shadow-[0_25px_60px_-12px_rgba(0,0,0,0.15)] rounded-[2rem] overflow-hidden">
                        {hasSong && currentSong.pic ? (
                            <motion.img 
                                src={currentSong.pic} 
                                alt="Album" 
                                className="w-full h-full object-cover"
                                animate={{ scale: isPlaying ? 1 : 0.95 }}
                                transition={{ duration: 0.7, ease: "easeInOut" }}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <MusicIcon size={64} className="text-gray-300" />
                            </div>
                        )}
                    </div>
                </motion.div>

                {/* 2. Lyrics View */}
                <motion.div 
                    className={`absolute inset-0 flex flex-col items-center justify-center z-20`}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: showLyrics ? 1 : 0, scale: showLyrics ? 1 : 0.95 }}
                    style={{ pointerEvents: showLyrics ? 'auto' : 'none' }}
                >
                    {/* Click background to close lyrics */}
                    <div className="absolute inset-0" onClick={() => setShowLyrics(false)} />

                    {/* Stop propagation on the scroll container so we can scroll lyrics without dragging the sheet */}
                    <div 
                        ref={lyricsContainerRef}
                        className="w-full h-full overflow-y-auto no-scrollbar relative px-8 py-[40vh] text-center"
                        onPointerDown={(e) => e.stopPropagation()} // Vital: prevents dragging the sheet when interacting with lyrics
                        style={{ 
                            maskImage: 'linear-gradient(to bottom, transparent 0%, black 25%, black 75%, transparent 100%)',
                            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 25%, black 75%, transparent 100%)'
                        }}
                    >
                        {lyrics.length > 0 ? lyrics.map((line, i) => (
                            <div 
                                key={i} 
                                className={`py-4 transition-all duration-500 cursor-pointer flex flex-col items-center ${
                                    i === activeLyricIndex 
                                    ? 'opacity-100 scale-105' 
                                    : 'opacity-40 scale-100 hover:opacity-70'
                                }`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    seek(line.time);
                                }}
                            >
                                <p className={`text-xl font-bold leading-relaxed ${i === activeLyricIndex ? 'text-gray-900' : 'text-gray-500/80'}`}>
                                    {line.text}
                                </p>
                                {line.translation && (
                                    <p className={`text-base font-medium mt-1 leading-normal ${i === activeLyricIndex ? 'text-gray-700' : 'text-gray-500/60'}`}>
                                        {line.translation}
                                    </p>
                                )}
                            </div>
                        )) : (
                             <div className="flex flex-col items-center justify-center h-full absolute inset-0">
                                {hasSong ? (
                                    <>
                                        <div className="w-6 h-6 border-2 border-gray-300 border-t-transparent rounded-full animate-spin mb-2"></div>
                                        <p className="text-gray-400 text-sm">加载歌词中...</p>
                                    </>
                                ) : (
                                    <p className="text-gray-400 text-sm">暂无播放</p>
                                )}
                            </div>
                        )}
                    </div>
                </motion.div>
              </div>

              {/* Song Info (Stop propagation to allow text selection or interactions) */}
              <div 
                className="relative z-30 px-8 mt-4 mb-2 min-h-[80px] flex items-center justify-between pointer-events-auto"
                onPointerDown={(e) => e.stopPropagation()}
              >
                 <div className="flex-1 min-w-0 pr-4">
                    <h2 className="text-2xl font-bold truncate text-black leading-tight">
                        {hasSong ? currentSong.name : "未播放"}
                    </h2>
                    <div className="flex items-center space-x-2 mt-1">
                        {hasSong && <span className="text-[10px] font-bold text-white bg-gray-400 px-1.5 py-0.5 rounded uppercase">{currentSong.source}</span>}
                        <p className="text-lg text-ios-red/90 font-medium truncate cursor-pointer hover:underline">
                            {hasSong ? currentSong.artist : "选择歌曲播放"}
                        </p>
                    </div>
                 </div>
                 
                 <div className="flex items-center space-x-3">
                     <button 
                        onClick={(e) => { e.stopPropagation(); if (hasSong) setShowDownload(true); }}
                        className={`p-3 -m-1 rounded-full active:scale-90 transition-transform ${hasSong ? 'text-gray-500 hover:text-black' : 'text-gray-300'}`}
                        disabled={!hasSong}
                     >
                        <DownloadIcon size={24} />
                     </button>
                     <button 
                        onClick={(e) => { e.stopPropagation(); if (hasSong) toggleFavorite(currentSong); }}
                        className={`p-3 -m-1 rounded-full active:scale-90 transition-transform ${!hasSong ? 'opacity-50' : ''}`}
                        disabled={!hasSong}
                     >
                        {hasSong && isFavorite(currentSong.id) ? 
                            <HeartFillIcon className="text-ios-red" size={26} /> : 
                            <HeartIcon className="text-gray-400" size={26} />
                        }
                     </button>
                 </div>
              </div>
          </div>

          {/* --- Footer Controls (Stop Drag Propagation) --- */}
          <div 
            className="relative z-30 w-full px-8 pb-safe mb-4"
            onPointerDown={(e) => e.stopPropagation()}
          >
            
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
                    disabled={!hasSong}
                    className="w-full h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-black hover:h-1.5 transition-all disabled:opacity-50"
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
                    <button onClick={playPrev} disabled={!hasSong} className="text-black hover:opacity-70 transition active:scale-90 disabled:opacity-30">
                        <PrevIcon size={40} className="fill-current" />
                    </button>
                    <button 
                        onClick={togglePlay} 
                        disabled={!hasSong}
                        className="w-20 h-20 bg-black text-white rounded-full flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
                    >
                        {isPlaying ? <PauseIcon size={32} className="fill-current" /> : <PlayIcon size={32} className="fill-current ml-1" />}
                    </button>
                    <button onClick={() => playNext(true)} disabled={queue.length === 0} className="text-black hover:opacity-70 transition active:scale-90 disabled:opacity-30">
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
          {hasSong && <DownloadPopup isOpen={showDownload} onClose={() => setShowDownload(false)} song={currentSong} />}
          <PlayerMorePopup isOpen={showMore} onClose={() => setShowMore(false)} onClosePlayer={onClose} />
      </motion.div>
    </motion.div>
  );
};

export default FullPlayer;
