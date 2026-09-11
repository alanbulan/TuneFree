import React, { useState } from 'react';
import { Song, getSongKey } from '../types';
import { useLibrary } from '../contexts/LibraryContext';
import { FAVORITES_PLAYLIST_ID } from '../contexts/libraryData';
import { useToast } from './ToastHost';
import { useNavigate } from 'react-router-dom';
import { getImgReferrerPolicy } from '../services/api';
import {
  HeartIcon,
  HeartFillIcon,
  FolderIcon,
  PlusIcon,
  MusicIcon,
  SearchIcon,
} from './Icons';

interface SongActionSheetProps {
  song: Song;
  onClose: () => void;
}

/**
 * 列表里单曲的「更多」操作面板：收藏、添加到歌单、搜索歌手 / 专辑。
 */
const SongActionSheet: React.FC<SongActionSheetProps> = ({ song, onClose }) => {
  const {
    playlists,
    favorites,
    isFavorite,
    toggleFavorite,
    addToPlaylist,
    createPlaylist,
  } = useLibrary();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [showPlaylistSelect, setShowPlaylistSelect] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleToggleFavorite = () => {
    const wasFavorite = isFavorite(song.id, song.source);
    toggleFavorite(song);
    showToast(wasFavorite ? '已取消收藏' : '已收藏歌曲', 'success', {
      label: '撤销',
      onClick: () => toggleFavorite(song),
    });
  };

  const handleAddToPlaylist = (playlistId: string) => {
    addToPlaylist(playlistId, song);
    showToast(
      playlistId === FAVORITES_PLAYLIST_ID ? '已添加到我喜欢' : '已添加到歌单',
      'success',
    );
    onClose();
  };

  const handleCreateAndAdd = () => {
    if (newPlaylistName.trim()) {
      createPlaylist(newPlaylistName, [song]);
      showToast('已创建歌单并添加歌曲', 'success');
      onClose();
    }
  };

  const handleSearch = (keyword: string) => {
    onClose();
    navigate(keyword ? `/search?q=${encodeURIComponent(keyword)}` : '/search');
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-[70] backdrop-blur-sm transition-opacity touch-auto"
        onClick={onClose}
        onPointerDown={(e) => e.stopPropagation()}
      />

      <div
        className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-[71] p-6 pb-safe shadow-2xl animate-slide-up max-h-[85vh] overflow-y-auto touch-auto"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center space-x-3 mb-6 border-b border-gray-100 pb-4">
          <div className="w-12 h-12 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
            {song.pic ? (
              <img
                src={song.pic}
                referrerPolicy={getImgReferrerPolicy(song.pic)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-300">
                <MusicIcon size={24} />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-lg truncate">{song.name}</h3>
            <p className="text-xs text-gray-500 truncate">{song.artist}</p>
          </div>
        </div>

        {!showPlaylistSelect ? (
          <div className="space-y-2">
            <button
              onClick={handleToggleFavorite}
              className="w-full flex items-center space-x-4 p-4 bg-gray-50 hover:bg-gray-100 rounded-xl transition active:scale-[0.98]"
            >
              <div className="p-2 bg-white rounded-full text-ios-red shadow-sm">
                {isFavorite(song.id, song.source) ? (
                  <HeartFillIcon size={20} />
                ) : (
                  <HeartIcon size={20} />
                )}
              </div>
              <span className="font-medium text-gray-800">
                {isFavorite(song.id, song.source) ? '取消收藏' : '收藏歌曲'}
              </span>
            </button>

            <button
              onClick={() => setShowPlaylistSelect(true)}
              className="w-full flex items-center space-x-4 p-4 bg-gray-50 hover:bg-gray-100 rounded-xl transition active:scale-[0.98]"
            >
              <div className="p-2 bg-white rounded-full text-ios-red shadow-sm">
                <FolderIcon size={20} />
              </div>
              <span className="font-medium text-gray-800">添加到歌单...</span>
            </button>

            <div className="grid grid-cols-2 gap-2 mt-2">
              <button
                onClick={() => handleSearch(song.artist)}
                disabled={!song.artist}
                className={`flex flex-col items-center justify-center p-4 bg-gray-50 hover:bg-gray-100 rounded-xl transition active:scale-[0.98] ${!song.artist ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <SearchIcon size={24} className="mb-2 text-gray-500" />
                <span className="text-xs font-medium text-gray-600">搜索歌手</span>
              </button>
              <button
                onClick={() => handleSearch(song.album)}
                disabled={!song.album}
                className={`flex flex-col items-center justify-center p-4 bg-gray-50 hover:bg-gray-100 rounded-xl transition active:scale-[0.98] ${!song.album ? 'opacity-50 cursor-not-allowed' : ''}`}
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
              <button
                onClick={() => setShowPlaylistSelect(false)}
                className="text-xs text-ios-red font-medium"
              >
                返回
              </button>
            </div>

            <div className="max-h-[300px] overflow-y-auto no-scrollbar space-y-2">
              {!isCreating ? (
                <button
                  onClick={() => setIsCreating(true)}
                  className="w-full flex items-center space-x-3 p-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-500 hover:border-ios-red hover:text-ios-red transition"
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
                    className="flex-1 bg-gray-100 p-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-ios-red/20"
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                  />
                  <button
                    onClick={handleCreateAndAdd}
                    className="p-3 bg-ios-red text-white rounded-xl font-medium text-sm"
                  >
                    创建
                  </button>
                </div>
              )}

              <button
                onClick={() => handleAddToPlaylist(FAVORITES_PLAYLIST_ID)}
                className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition active:scale-[0.98]"
              >
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-white rounded-full text-ios-red shadow-sm">
                    <HeartFillIcon size={20} />
                  </div>
                  <div className="text-left">
                    <p className="font-medium text-sm text-gray-800">我喜欢</p>
                    <p className="text-[10px] text-gray-400">
                      {favorites.length} 首歌曲
                    </p>
                  </div>
                </div>
                {isFavorite(song.id, song.source) && (
                  <span className="text-[10px] bg-ios-red/10 text-ios-red px-2 py-0.5 rounded-full">
                    已添加
                  </span>
                )}
              </button>

              {playlists.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleAddToPlaylist(p.id)}
                  className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition active:scale-[0.98]"
                >
                  <div className="flex items-center space-x-3">
                    <FolderIcon size={20} className="text-ios-red" />
                    <div className="text-left">
                      <p className="font-medium text-sm text-gray-800">{p.name}</p>
                      <p className="text-[10px] text-gray-400">{p.songs.length} 首歌曲</p>
                    </div>
                  </div>
                  {p.songs.find((s) => getSongKey(s) === getSongKey(song)) && (
                    <span className="text-[10px] bg-ios-red/10 text-ios-red px-2 py-0.5 rounded-full">
                      已添加
                    </span>
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

export default SongActionSheet;
