
import React from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { PlayIcon, PauseIcon, NextIcon, MusicIcon } from './Icons';
import { motion } from 'framer-motion';

interface MiniPlayerProps {
  onExpand: () => void;
  layoutId?: string;
}

const MiniPlayer: React.FC<MiniPlayerProps> = ({ onExpand, layoutId }) => {
  const { currentSong, isPlaying, togglePlay, playNext, queue } = usePlayer();

  // Empty State Logic
  const hasSong = !!currentSong;
  
  return (
    <motion.div 
      layoutId={layoutId}
      className="fixed bottom-[88px] left-3 right-3 h-14 bg-white/90 backdrop-blur-xl rounded-2xl flex items-center px-4 shadow-[0_8px_30px_rgb(0,0,0,0.08)] z-40 border border-gray-100 cursor-pointer overflow-hidden"
      onClick={onExpand}
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Content wrapper to fade content separately from the container morph */}
      <motion.div 
        className="flex items-center w-full"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
          <div className={`relative w-10 h-10 rounded-full overflow-hidden mr-3 flex-shrink-0 shadow-sm flex items-center justify-center ${hasSong ? 'bg-gray-200' : 'bg-gray-100'}`}>
            {hasSong && currentSong?.pic ? (
                <img 
                    src={currentSong.pic} 
                    alt="Art" 
                    className="w-full h-full object-cover animate-spin-slow"
                    style={{ 
                        animationPlayState: isPlaying ? 'running' : 'paused'
                    }}
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
      </motion.div>
    </motion.div>
  );
};

export default MiniPlayer;
