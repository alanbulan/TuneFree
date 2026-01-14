
import React, { useState } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { useLibrary } from '../contexts/LibraryContext';
import { getOnlinePlaylist } from '../services/api';
import { Song, Playlist } from '../types';
import { HeartFillIcon, FolderIcon, PlusIcon, TrashIcon, SettingsIcon, DownloadIcon, UploadIcon, MusicIcon } from '../components/Icons';
import StatusDashboard from '../components/StatusDashboard';

type Tab = 'favorites' | 'playlists' | 'manage' | 'status';

const Library: React.FC = () => {
  const { queue, playSong } = usePlayer();
  const { favorites, playlists, createPlaylist, importPlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist, exportData, importData } = useLibrary();
  const [activeTab, setActiveTab] = useState<Tab>('favorites');
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importId, setImportId] = useState('');
  const [importSource, setImportSource] = useState('netease');
  const [isImporting, setIsImporting] = useState(false);

  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);

  const handleCreatePlaylist = () => {
    if (newPlaylistName.trim()) {
      createPlaylist(newPlaylistName);
      setNewPlaylistName('');
      setShowCreateModal(false);
    }
  };

  const handleImportOnlinePlaylist = async () => {
      if (!importId) return;
      setIsImporting(true);
      const result = await getOnlinePlaylist(importId, importSource);
      if (result) {
          importPlaylist(result.name, result.songs);
          alert(`成功导入歌单 "${result.name}"`);
      } else {
          alert('导入失败，请检查ID或源。');
      }
      setIsImporting(false);
      setShowImportModal(false);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          const success = importData(event.target.result as string);
          if (success) alert('数据导入成功！');
          else alert('数据导入失败，请检查文件格式。');
        }
      };
      reader.readAsText(file);
    }
  };

  const renderSongList = (songs: Song[], canRemove: boolean = false, playlistId?: string) => (
    <div className="space-y-3 pb-24">
        {songs.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">暂无歌曲</div>
        ) : (
            songs.map((song, idx) => (
                <div 
                    key={`${song.id}-${idx}`}
                    className="flex items-center space-x-3 bg-white p-2 rounded-xl shadow-sm active:scale-[0.98] transition cursor-pointer"
                    onClick={() => playSong(song)}
                >
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 flex items-center justify-center">
                        {song.pic ? (
                            <img src={song.pic} alt="art" className="w-full h-full object-cover" />
                        ) : (
                            <MusicIcon className="text-gray-300" />
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-ios-text text-[15px] font-medium truncate">{song.name}</p>
                        <p className="text-ios-subtext text-xs truncate">{song.artist}</p>
                    </div>
                    {canRemove && playlistId && (
                        <button 
                            className="p-2 text-gray-400 hover:text-red-500"
                            onClick={(e) => { e.stopPropagation(); removeFromPlaylist(playlistId, Number(song.id)); }}
                        >
                            <TrashIcon size={18} />
                        </button>
                    )}
                </div>
            ))
        )}
    </div>
  );

  return (
    <div className="p-5 pt-safe min-h-screen bg-ios-bg">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-ios-text">我的资料库</h1>
      </div>

      {/* Tabs */}
      <div className="flex bg-gray-200/50 p-1 rounded-xl mb-6 overflow-x-auto no-scrollbar">
        <button 
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap px-2 ${activeTab === 'favorites' ? 'bg-white shadow-sm text-ios-text' : 'text-gray-500'}`}
            onClick={() => { setActiveTab('favorites'); setSelectedPlaylist(null); }}
        >
            收藏
        </button>
        <button 
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap px-2 ${activeTab === 'playlists' ? 'bg-white shadow-sm text-ios-text' : 'text-gray-500'}`}
            onClick={() => { setActiveTab('playlists'); setSelectedPlaylist(null); }}
        >
            歌单
        </button>
        <button 
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap px-2 ${activeTab === 'manage' ? 'bg-white shadow-sm text-ios-text' : 'text-gray-500'}`}
            onClick={() => { setActiveTab('manage'); setSelectedPlaylist(null); }}
        >
            管理
        </button>
        <button 
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap px-2 ${activeTab === 'status' ? 'bg-white shadow-sm text-ios-text' : 'text-gray-500'}`}
            onClick={() => { setActiveTab('status'); setSelectedPlaylist(null); }}
        >
            监控
        </button>
      </div>

      {activeTab === 'favorites' && (
        <div>
            <div className="flex items-center space-x-2 mb-4 text-ios-red">
                <HeartFillIcon size={20} />
                <span className="font-bold text-lg">我喜欢的音乐 ({favorites.length})</span>
            </div>
            {renderSongList(favorites)}
        </div>
      )}

      {activeTab === 'playlists' && !selectedPlaylist && (
        <div>
            <div className="grid grid-cols-2 gap-4">
                {/* Create New Card */}
                <div 
                    onClick={() => setShowCreateModal(true)}
                    className="aspect-square bg-white rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-gray-200 text-gray-400 active:bg-gray-50 transition cursor-pointer"
                >
                    <PlusIcon size={32} className="mb-2" />
                    <span className="text-sm font-medium">新建歌单</span>
                </div>

                 {/* Import Online Card */}
                 <div 
                    onClick={() => setShowImportModal(true)}
                    className="aspect-square bg-white rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-ios-blue/30 text-ios-blue active:bg-blue-50 transition cursor-pointer"
                >
                    <DownloadIcon size={32} className="mb-2" />
                    <span className="text-sm font-medium">导入在线歌单</span>
                </div>

                {playlists.map(p => (
                    <div 
                        key={p.id} 
                        onClick={() => setSelectedPlaylist(p)}
                        className="aspect-square bg-white rounded-2xl p-4 shadow-sm flex flex-col justify-between active:scale-95 transition relative overflow-hidden"
                    >
                        <div className="absolute top-0 right-0 p-2 opacity-50">
                            <FolderIcon size={64} className="text-gray-100 translate-x-4 -translate-y-4" />
                        </div>
                        <FolderIcon size={28} className="text-ios-blue z-10" />
                        <div className="z-10">
                            <p className="font-bold text-ios-text truncate">{p.name}</p>
                            <p className="text-xs text-gray-500">{p.songs.length} 首歌曲</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
      )}

      {activeTab === 'playlists' && selectedPlaylist && (
          <div>
              <button 
                onClick={() => setSelectedPlaylist(null)}
                className="mb-4 text-ios-blue text-sm font-medium flex items-center"
              >
                  &larr; 返回歌单列表
              </button>
              <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold">{selectedPlaylist.name}</h2>
                  <button 
                    onClick={() => { deletePlaylist(selectedPlaylist.id); setSelectedPlaylist(null); }}
                    className="text-red-500 p-2 bg-red-50 rounded-full"
                  >
                      <TrashIcon size={18} />
                  </button>
              </div>
              {renderSongList(selectedPlaylist.songs, true, selectedPlaylist.id)}
              
              {queue.length > 0 && (
                  <div className="mt-8 p-4 bg-white rounded-xl shadow-sm">
                       <h3 className="text-sm font-bold text-gray-500 mb-2">快速添加播放队列中的歌曲:</h3>
                       <div className="flex gap-2 overflow-x-auto no-scrollbar py-2">
                           {queue.slice(0, 5).map(s => (
                               <button 
                                key={s.id} 
                                onClick={() => addToPlaylist(selectedPlaylist.id, s)}
                                className="flex-shrink-0 bg-gray-100 px-3 py-1.5 rounded-full text-xs font-medium active:bg-ios-blue active:text-white transition"
                               >
                                   + {s.name}
                               </button>
                           ))}
                       </div>
                  </div>
              )}
          </div>
      )}

      {activeTab === 'manage' && (
          <div className="space-y-4">
              <div className="bg-white p-5 rounded-2xl shadow-sm">
                  <div className="flex items-center space-x-3 mb-4">
                      <SettingsIcon className="text-gray-400" />
                      <h3 className="font-bold text-lg">数据备份与迁移</h3>
                  </div>
                  <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                      您的所有收藏和歌单数据都保存在本地浏览器中。您可以将数据导出为文件，以便在其他设备上恢复。
                  </p>
                  
                  <div className="grid grid-cols-1 gap-3">
                      <button 
                        onClick={exportData}
                        className="flex items-center justify-center space-x-2 w-full py-3 bg-ios-blue text-white rounded-xl font-medium active:opacity-90 transition"
                      >
                          <DownloadIcon size={18} />
                          <span>导出数据 (JSON)</span>
                      </button>
                      
                      <div className="relative">
                          <button className="flex items-center justify-center space-x-2 w-full py-3 bg-gray-100 text-ios-text rounded-xl font-medium active:bg-gray-200 transition">
                              <UploadIcon size={18} />
                              <span>导入数据</span>
                          </button>
                          <input 
                            type="file" 
                            accept=".json"
                            className="absolute inset-0 opacity-0 cursor-pointer"
                            onChange={handleFileImport}
                          />
                      </div>
                  </div>
              </div>

              <div className="bg-white p-5 rounded-2xl shadow-sm">
                  <h3 className="font-bold mb-2">关于 TuneFree</h3>
                  <p className="text-xs text-gray-400">Version 2.0.0 • React • Cloudflare Pages</p>
              </div>
          </div>
      )}

      {activeTab === 'status' && (
          <StatusDashboard />
      )}

      {/* Create Playlist Modal */}
      {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-6">
              <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
                  <h3 className="text-xl font-bold mb-4 text-center">新建歌单</h3>
                  <input 
                    type="text" 
                    placeholder="输入歌单名称" 
                    className="w-full bg-gray-100 p-3 rounded-xl mb-6 outline-none focus:ring-2 focus:ring-ios-blue/50"
                    value={newPlaylistName}
                    onChange={e => setNewPlaylistName(e.target.value)}
                    autoFocus
                  />
                  <div className="flex space-x-3">
                      <button 
                        onClick={() => setShowCreateModal(false)}
                        className="flex-1 py-3 text-gray-500 font-medium bg-gray-100 rounded-xl"
                      >
                          取消
                      </button>
                      <button 
                        onClick={handleCreatePlaylist}
                        className="flex-1 py-3 text-white font-medium bg-ios-blue rounded-xl"
                      >
                          创建
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Import Playlist Modal */}
      {showImportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-6">
              <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
                  <h3 className="text-xl font-bold mb-4 text-center">导入在线歌单</h3>
                  <div className="space-y-4 mb-6">
                      <select 
                        className="w-full bg-gray-100 p-3 rounded-xl outline-none"
                        value={importSource}
                        onChange={e => setImportSource(e.target.value)}
                      >
                          <option value="netease">网易云音乐 (Netease)</option>
                          <option value="kuwo">酷我音乐 (Kuwo)</option>
                          <option value="qq">QQ音乐 (QQ)</option>
                      </select>
                      <input 
                        type="text" 
                        placeholder="输入歌单 ID" 
                        className="w-full bg-gray-100 p-3 rounded-xl outline-none focus:ring-2 focus:ring-ios-blue/50"
                        value={importId}
                        onChange={e => setImportId(e.target.value)}
                      />
                      <p className="text-xs text-gray-400">
                          提示: 请输入对应平台的纯数字 ID。导入可能需要几秒钟。
                      </p>
                  </div>
                  
                  <div className="flex space-x-3">
                      <button 
                        onClick={() => setShowImportModal(false)}
                        className="flex-1 py-3 text-gray-500 font-medium bg-gray-100 rounded-xl"
                        disabled={isImporting}
                      >
                          取消
                      </button>
                      <button 
                        onClick={handleImportOnlinePlaylist}
                        disabled={isImporting || !importId}
                        className="flex-1 py-3 text-white font-medium bg-ios-blue rounded-xl flex justify-center items-center"
                      >
                          {isImporting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : "导入"}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Library;
