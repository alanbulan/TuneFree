
import React, { useRef, useEffect } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { Song } from '../types';
import { TrashIcon, MusicIcon } from './Icons';

interface QueuePopupProps {
  isOpen: boolean;
  onClose: () => void;
}

const QueuePopup: React.FC<QueuePopupProps> = ({ isOpen, onClose }) => {
  const { queue, currentSong, playSong, removeFromQueue, clearQueue, playMode, togglePlayMode } = usePlayer();
  const listRef = useRef<HTMLDivElement>(null);

  // Auto scroll to current song when opened
  useEffect(() => {
    if (isOpen && currentSong && listRef.current) {
      const activeEl = document.getElementById(`queue-item-${currentSong.id}`);
      if (activeEl) {
          activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, [isOpen, currentSong]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/40 z-[60] backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="fixed bottom-4 left-4 right-4 h-[60vh] bg-white rounded-3xl z-[61] shadow-2xl flex flex-col overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white/95 backdrop-blur z-10">
          <div>
            <h3 className="font-bold text-lg">播放队列 <span className="text-gray-400 text-sm">({queue.length})</span></h3>
            <div className="flex items-center space-x-2 mt-1" onClick={togglePlayMode}>
                <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full text-gray-500 font-medium cursor-pointer active:opacity-70">
                    {playMode === 'sequence' ? '列表循环' : playMode === 'loop' ? '单曲循环' : '随机播放'}
                </span>
            </div>
          </div>
          <button 
            onClick={clearQueue}
            className="p-2 text-gray-400 hover:text-red-500 transition"
          >
            <TrashIcon size={18} />
          </button>
        </div>

        {/* List */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 no-scrollbar">
          {queue.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-400">
                  <span className="text-sm">队列为空</span>
              </div>
          ) : (
              queue.map((song) => {
                const isCurrent = currentSong?.id === song.id;
                return (
                  <div 
                    key={`${song.id}-${song.source}`}
                    id={`queue-item-${song.id}`}
                    className={`flex items-center space-x-3 p-3 rounded-xl mb-1 transition cursor-pointer ${isCurrent ? 'bg-ios-red/5' : 'hover:bg-gray-50 active:bg-gray-100'}`}
                    onClick={() => playSong(song)}
                  >
                     <div className="w-10 h-10 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
                         {song.pic ? (
                             <img src={song.pic} className="w-full h-full object-cover" />
                         ) : (
                             <MusicIcon size={16} className="text-gray-300" />
                         )}
                         {isCurrent && (
                             <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                                 <div className="w-1.5 h-1.5 bg-ios-red rounded-full animate-pulse" />
                             </div>
                         )}
                     </div>
                     <div className="flex-1 min-w-0">
                         <p className={`text-sm font-medium truncate ${isCurrent ? 'text-ios-red' : 'text-gray-900'}`}>{song.name}</p>
                         <div className="flex items-center gap-1">
                            <span className="text-[9px] px-1 bg-gray-100 text-gray-500 rounded uppercase">{song.source}</span>
                            <p className="text-xs text-gray-500 truncate">{song.artist}</p>
                         </div>
                     </div>
                     <button 
                        className="p-2 text-gray-300 hover:text-red-500"
                        onClick={(e) => { e.stopPropagation(); removeFromQueue(song.id); }}
                     >
                         <TrashIcon size={16} />
                     </button>
                  </div>
                );
              })
          )}
        </div>
      </div>
      <style>{`
        @keyframes slide-up {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
        }
        .animate-slide-up {
            animation: slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}</style>
    </>
  );
};

export default QueuePopup;
