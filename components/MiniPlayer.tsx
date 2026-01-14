import React from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { PlayIcon, PauseIcon, NextIcon, MusicIcon } from './Icons';

interface MiniPlayerProps {
  onExpand: () => void;
}

const MiniPlayer: React.FC<MiniPlayerProps> = ({ onExpand }) => {
  const { currentSong, isPlaying, togglePlay, playNext } = usePlayer();

  if (!currentSong) return null;

  return (
    <div 
      className="fixed bottom-[88px] left-3 right-3 h-14 bg-white/90 backdrop-blur-xl rounded-2xl flex items-center px-4 shadow-[0_8px_30px_rgb(0,0,0,0.08)] z-40 border border-gray-100"
      onClick={onExpand}
    >
      <div className="relative w-10 h-10 rounded-lg overflow-hidden mr-3 flex-shrink-0 bg-gray-200 shadow-sm flex items-center justify-center">
        {currentSong.pic ? (
             <img 
                src={currentSong.pic} 
                alt="Art" 
                className={`w-full h-full object-cover ${isPlaying ? 'animate-spin-slow' : ''}`}
            />
        ) : (
            <MusicIcon className="text-gray-400 w-6 h-6" />
        )}
      </div>
      
      <div className="flex-1 min-w-0 pr-2">
        <p className="text-ios-text text-sm font-semibold truncate">{currentSong.name}</p>
        <p className="text-ios-subtext text-xs truncate">
          {currentSong.artist}
        </p>
      </div>

      <div className="flex items-center space-x-4">
        <button 
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
          className="text-ios-text hover:text-gray-600 focus:outline-none transition-transform active:scale-90"
        >
          {isPlaying ? <PauseIcon size={24} className="fill-current" /> : <PlayIcon size={24} className="fill-current" />}
        </button>
        <button 
          onClick={(e) => { e.stopPropagation(); playNext(); }}
          className="text-ios-text hover:text-gray-600 focus:outline-none transition-transform active:scale-90"
        >
          <NextIcon size={24} className="fill-current" />
        </button>
      </div>
    </div>
  );
};

export default MiniPlayer;