
import React, { useState } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { useLibrary } from '../contexts/LibraryContext';
import { useNavigate } from 'react-router-dom';
import { FolderIcon, PlusIcon, MusicIcon, SearchIcon, DownloadIcon, ShareIcon } from './Icons';

interface PlayerMorePopupProps {
  isOpen: boolean;
  onClose: () => void;
  onClosePlayer?: () => void;
}

const PlayerMorePopup: React.FC<PlayerMorePopupProps> = ({ isOpen, onClose, onClosePlayer }) => {
  const { currentSong, audioQuality, setAudioQuality } = usePlayer();
  const { playlists, addToPlaylist, createPlaylist } = useLibrary();
  const [showPlaylistSelect, setShowPlaylistSelect] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();

  if (!isOpen || !currentSong) return null;

  const handleAddToPlaylist = (playlistId: string) => {
    addToPlaylist(playlistId, currentSong);
    onClose();
  };

  const handleCreateAndAdd = () => {
    if (newPlaylistName.trim()) {
      // Now createPlaylist accepts initialSongs
      createPlaylist(newPlaylistName, [currentSong]);
      onClose();
    }
  };

  const handleSearch = (keyword: string) => {
      onClose();
      // Use a small timeout to allow the popup to close smoothly before navigation
      setTimeout(() => {
          if (onClosePlayer) onClosePlayer();
          if (keyword) {
            navigate(`/search?q=${encodeURIComponent(keyword)}`);
          } else {
            navigate('/search');
          }
      }, 300);
  };

  const handleShare = async () => {
    if (!currentSong) return;
    
    const shareText = `我在 TuneFree 发现了一首好歌：${currentSong.artist} - ${currentSong.name}，快来听听吧！`;
    const shareUrl = window.location.origin;

    const shareData = {
        title: currentSong.name,
        text: shareText,
        url: shareUrl
    };

    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
            alert('分享信息已复制到剪贴板');
        }
    } catch (e) {
        // ignore share cancellation
    }
    onClose();
  };

  const qualities = [
      { id: '128k', label: '标准', desc: '128k' },
      { id: '320k', label: '高品', desc: '320k' },
      { id: 'flac', label: '无损', desc: 'FLAC' },
  ];

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/40 z-[60] backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-[61] p-6 pb-safe shadow-2xl animate-slide-up max-h-[85vh] overflow-y-auto">
        
        {/* Header Song Info */}
        <div className="flex items-center space-x-3 mb-6 border-b border-gray-100 pb-4">
            <div className="w-12 h-12 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                {currentSong.pic ? (
                    <img src={currentSong.pic} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <MusicIcon size={24} />
                    </div>
                )}
            </div>
            <div className="flex-1 min-w-0">
                <h3 className="font-bold text-lg truncate">{currentSong.name}</h3>
                <p className="text-xs text-gray-500 truncate">{currentSong.artist}</p>
            </div>
        </div>

        {!showPlaylistSelect ? (
            <div className="space-y-4">
                {/* Audio Quality Selection */}
                <div className="p-4 bg-gray-50 rounded-xl">
                    <h4 className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">在线播放音质</h4>
                    <div className="flex bg-white p-1 rounded-lg shadow-sm">
                        {qualities.map(q => (
                            <button
                                key={q.id}
                                onClick={() => setAudioQuality(q.id as any)}
                                className={`flex-1 py-2 rounded-md text-xs font-bold transition-all ${
                                    audioQuality === q.id 
                                    ? 'bg-black text-white shadow-md' 
                                    : 'text-gray-500 hover:bg-gray-50'
                                }`}
                            >
                                {q.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <button 
                        onClick={() => setShowPlaylistSelect(true)}
                        className="w-full flex items-center space-x-4 p-4 bg-gray-50 hover:bg-gray-100 rounded-xl transition active:scale-[0.98]"
                    >
                        <div className="p-2 bg-white rounded-full text-ios-blue shadow-sm">
                            <FolderIcon size={20} />
                        </div>
                        <span className="font-medium text-gray-800">添加到歌单...</span>
                    </button>

                    <button 
                        onClick={handleShare}
                        className="w-full flex items-center space-x-4 p-4 bg-gray-50 hover:bg-gray-100 rounded-xl transition active:scale-[0.98]"
                    >
                        <div className="p-2 bg-white rounded-full text-ios-blue shadow-sm">
                            <ShareIcon size={20} />
                        </div>
                        <span className="font-medium text-gray-800">分享歌曲</span>
                    </button>
                </div>

                 <div className="grid grid-cols-2 gap-2 mt-2">
                    <button 
                        onClick={() => currentSong.artist && handleSearch(currentSong.artist)}
                        disabled={!currentSong.artist}
                        className={`flex flex-col items-center justify-center p-4 bg-gray-50 hover:bg-gray-100 rounded-xl transition active:scale-[0.98] ${!currentSong.artist ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <SearchIcon size={24} className="mb-2 text-gray-500" />
                        <span className="text-xs font-medium text-gray-600">搜索歌手</span>
                    </button>
                    <button 
                        onClick={() => currentSong.album && handleSearch(currentSong.album)}
                        disabled={!currentSong.album}
                        className={`flex flex-col items-center justify-center p-4 bg-gray-50 hover:bg-gray-100 rounded-xl transition active:scale-[0.98] ${!currentSong.album ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <SearchIcon size={24} className="mb-2 text-gray-500" />
                        <span className="text-xs font-medium text-gray-600">搜索专辑</span>
                    </button>
                </div>

                <button 
                    onClick={onClose}
                    className="w-full py-4 mt-2 text-center font-bold text-gray-500 bg-white border border-gray-100 rounded-xl active:bg-gray-50"
                >
                    取消
                </button>
            </div>
        ) : (
            <div className="space-y-3">
                <div className="flex items-center justify-between mb-2">
                    <h4 className="font-bold text-gray-800">选择歌单</h4>
                    <button onClick={() => setShowPlaylistSelect(false)} className="text-xs text-ios-blue font-medium">返回</button>
                </div>
                
                <div className="max-h-[300px] overflow-y-auto no-scrollbar space-y-2">
                    {/* Create New Inline */}
                    {!isCreating ? (
                         <button 
                            onClick={() => setIsCreating(true)}
                            className="w-full flex items-center space-x-3 p-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-500 hover:border-ios-blue hover:text-ios-blue transition"
                        >
                            <PlusIcon size={20} />
                            <span className="font-medium text-sm">新建歌单</span>
                        </button>
                    ) : (
                        <div className="flex items-center space-x-2 p-1">
                            <input 
                                autoFocus
                                type="text" 
                                placeholder="歌单名称" 
                                className="flex-1 bg-gray-100 p-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-ios-blue/20"
                                value={newPlaylistName}
                                onChange={e => setNewPlaylistName(e.target.value)}
                            />
                            <button 
                                onClick={handleCreateAndAdd}
                                className="p-3 bg-ios-blue text-white rounded-xl font-medium text-sm"
                            >
                                创建
                            </button>
                        </div>
                    )}

                    {playlists.map(p => (
                        <button 
                            key={p.id}
                            onClick={() => handleAddToPlaylist(p.id)}
                            className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition active:scale-[0.98]"
                        >
                            <div className="flex items-center space-x-3">
                                <FolderIcon size={20} className="text-ios-blue" />
                                <div className="text-left">
                                    <p className="font-medium text-sm text-gray-800">{p.name}</p>
                                    <p className="text-[10px] text-gray-400">{p.songs.length} 首歌曲</p>
                                </div>
                            </div>
                            {p.songs.find(s => String(s.id) === String(currentSong.id)) && (
                                <span className="text-[10px] bg-green-100 text-green-600 px-2 py-0.5 rounded-full">已添加</span>
                            )}
                        </button>
                    ))}
                </div>
            </div>
        )}
      </div>
    </>
  );
};

export default PlayerMorePopup;
