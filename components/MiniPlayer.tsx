
import React from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { PlayIcon, PauseIcon, NextIcon, MusicIcon } from './Icons';

interface MiniPlayerProps {
  onExpand: () => void;
}

const MiniPlayer: React.FC<MiniPlayerProps> = ({ onExpand }) => {
  const { currentSong, isPlaying, togglePlay, playNext, queue } = usePlayer();

  // Empty State Logic
  const hasSong = !!currentSong;
  
  return (
    <div 
      className="fixed bottom-[88px] left-3 right-3 h-14 bg-white/90 backdrop-blur-xl rounded-2xl flex items-center px-4 shadow-[0_8px_30px_rgb(0,0,0,0.08)] z-40 border border-gray-100 transition-transform active:scale-[0.98]"
      onClick={onExpand}
    >
      <div className={`relative w-10 h-10 rounded-lg overflow-hidden mr-3 flex-shrink-0 shadow-sm flex items-center justify-center ${hasSong ? 'bg-gray-200' : 'bg-gray-100'}`}>
        {hasSong && currentSong?.pic ? (
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
        <p className="text-ios-text text-sm font-semibold truncate">
            {hasSong ? currentSong?.name : "TuneFree 音乐"}
        </p>
        <p className="text-ios-subtext text-xs truncate">
          {hasSong ? currentSong?.artist : "听见世界的声音"}
        </p>
      </div>

      <div className="flex items-center space-x-4">
        <button 
          onClick={(e) => { 
              e.stopPropagation(); 
              if (hasSong) togglePlay(); 
          }}
          disabled={!hasSong}
          className={`text-ios-text hover:text-gray-600 focus:outline-none transition-transform active:scale-90 ${!hasSong ? 'opacity-50' : ''}`}
        >
          {isPlaying ? <PauseIcon size={24} className="fill-current" /> : <PlayIcon size={24} className="fill-current" />}
        </button>
        <button 
          onClick={(e) => { 
              e.stopPropagation(); 
              if (queue.length > 0) playNext(); 
          }}
          disabled={queue.length === 0}
          className={`text-ios-text hover:text-gray-600 focus:outline-none transition-transform active:scale-90 ${queue.length === 0 ? 'opacity-50' : ''}`}
        >
          <NextIcon size={24} className="fill-current" />
        </button>
      </div>
    </div>
  );
};

export default MiniPlayer;
