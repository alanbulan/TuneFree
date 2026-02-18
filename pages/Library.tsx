import React, { useState, useMemo } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { useLibrary } from '../contexts/LibraryContext';
import { getPlaylistDetail, DEFAULT_API_BASE } from '../services/api';
import { Song } from '../types';
import { HeartFillIcon, FolderIcon, PlusIcon, TrashIcon, SettingsIcon, DownloadIcon, UploadIcon, MusicIcon, KeyIcon } from '../components/Icons';

type Tab = 'favorites' | 'playlists' | 'manage';

const Library: React.FC = () => {
  const { queue, playSong } = usePlayer();
  const { 
    favorites, playlists, apiKey, corsProxy, apiBase, setApiKey, setCorsProxy, setApiBase,
    createPlaylist, importPlaylist, deletePlaylist, 
    addToPlaylist, removeFromPlaylist, renamePlaylist, 
    exportData, importData 
  } = useLibrary();
  
  const [activeTab, setActiveTab] = useState<Tab>('favorites');
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [importId, setImportId] = useState('');
  const [importSource, setImportSource] = useState('netease');
  const [isImporting, setIsImporting] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  
  const [tempApiKey, setTempApiKey] = useState(apiKey);
  const [tempProxy, setTempProxy] = useState(corsProxy);
  const [tempApiBase, setTempApiBase] = useState(apiBase);

  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  
  const selectedPlaylist = useMemo(() => 
    playlists.find(p => p.id === selectedPlaylistId) || null
  , [playlists, selectedPlaylistId]);

  const handleSaveSettings = () => {
    setApiKey(tempApiKey);
    setCorsProxy(tempProxy);
    setApiBase(tempApiBase);
    alert('设置已保存');
  };

  const handleCreatePlaylist = () => {
    if (newPlaylistName.trim()) {
      createPlaylist(newPlaylistName);
      setNewPlaylistName('');
      setShowCreateModal(false);
    }
  };

  const handleRenamePlaylist = () => {
      if (selectedPlaylist && renameValue.trim()) {
          renamePlaylist(selectedPlaylist.id, renameValue);
          setShowRenameModal(false);
      }
  };

  const handleImportOnlinePlaylist = async () => {
      if (!importId) return;
      setIsImporting(true);
      const result = await getPlaylistDetail(importId, importSource);
      if (result) {
          importPlaylist(result.name, result.songs);
          alert(`成功导入歌单 "${result.name}"`);
      } else {
          alert('导入失败，请检查 Key、ID 或音源。若持续失败请尝试开启代理。');
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
          else alert('数据导入失败。');
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
            songs.map((song, idx) => {
                const sName = typeof song.name === 'string' ? song.name : '未知歌曲';
                const sArtist = typeof song.artist === 'string' ? song.artist : '未知歌手';
                
                return (
                    <div 
                        key={`${song.id}-${idx}`}
                        className="flex items-center space-x-3 bg-white p-2 rounded-xl shadow-sm active:scale-[0.98] transition cursor-pointer"
                        onClick={() => playSong(song)}
                    >
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 flex items-center justify-center">
                            {song.pic ? (
                                <img src={song.pic} alt="art" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                            ) : (
                                <MusicIcon className="text-gray-300" />
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-ios-text text-[15px] font-medium truncate">{sName}</p>
                            <p className="text-ios-subtext text-xs truncate">{sArtist}</p>
                        </div>
                        {canRemove && playlistId && isEditMode && (
                            <button 
                                className="p-2 text-red-400 hover:text-red-600 bg-red-50 rounded-full"
                                onClick={(e) => { e.stopPropagation(); removeFromPlaylist(playlistId, song.id); }}
                            >
                                <TrashIcon size={16} />
                            </button>
                        )}
                    </div>
                );
            })
        )}
    </div>
  );

  return (
    <div className="p-5 pt-safe min-h-screen bg-ios-bg">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-ios-text">我的资料库</h1>
      </div>

      <div className="flex bg-gray-200/50 p-1 rounded-xl mb-6 overflow-x-auto no-scrollbar">
        {['favorites', 'playlists', 'manage'].map((t) => (
            <button 
                key={t}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap px-2 ${activeTab === t ? 'bg-white shadow-sm text-ios-text' : 'text-gray-500'}`}
                onClick={() => { setActiveTab(t as Tab); setSelectedPlaylistId(null); }}
            >
                {t === 'favorites' ? '收藏' : t === 'playlists' ? '歌单' : '管理'}
            </button>
        ))}
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
        <div className="grid grid-cols-2 gap-4">
            <div onClick={() => setShowCreateModal(true)} className="aspect-square bg-white rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-gray-200 text-gray-400 active:bg-gray-50 cursor-pointer">
                <PlusIcon size={32} className="mb-2" />
                <span className="text-sm font-medium">新建歌单</span>
            </div>
            <div onClick={() => setShowImportModal(true)} className="aspect-square bg-white rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-ios-blue/30 text-ios-blue active:bg-blue-50 cursor-pointer">
                <DownloadIcon size={32} className="mb-2" />
                <span className="text-sm font-medium">导入在线歌单</span>
            </div>
            {playlists.map(p => (
                <div key={p.id} onClick={() => { setSelectedPlaylistId(p.id); setIsEditMode(false); }} className="aspect-square bg-white rounded-2xl p-4 shadow-sm flex flex-col justify-between active:scale-95 transition relative overflow-hidden">
                    <FolderIcon size={28} className="text-ios-blue z-10" />
                    <div className="z-10">
                        <p className="font-bold text-ios-text truncate">{String(p.name || '未命名歌单')}</p>
                        <p className="text-xs text-gray-500">{p.songs.length} 首歌曲</p>
                    </div>
                </div>
            ))}
        </div>
      )}

      {activeTab === 'playlists' && selectedPlaylist && (
          <div>
              <button onClick={() => setSelectedPlaylistId(null)} className="mb-4 text-ios-blue text-sm font-medium flex items-center">&larr; 返回歌单列表</button>
              <div className="bg-white p-4 rounded-2xl shadow-sm mb-4">
                  <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                          <h2 className="text-2xl font-bold truncate">{String(selectedPlaylist.name || '未命名歌单')}</h2>
                          <p className="text-xs text-gray-500">{selectedPlaylist.songs.length} 首歌曲</p>
                      </div>
                      <button onClick={() => setIsEditMode(!isEditMode)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${isEditMode ? 'bg-ios-blue text-white' : 'bg-gray-100 text-ios-blue'}`}>{isEditMode ? '完成' : '编辑'}</button>
                  </div>
                  {isEditMode && (
                      <div className="flex items-center space-x-3 mt-4 pt-4 border-t border-gray-100">
                          <button onClick={() => {setRenameValue(selectedPlaylist.name); setShowRenameModal(true);}} className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium">重命名</button>
                          <button onClick={() => {if(confirm('确定删除？')){deletePlaylist(selectedPlaylist.id); setSelectedPlaylistId(null);}}} className="flex-1 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-medium">删除歌单</button>
                      </div>
                  )}
              </div>
              {renderSongList(selectedPlaylist.songs, true, selectedPlaylist.id)}
          </div>
      )}

      {activeTab === 'manage' && (
          <div className="space-y-4">
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-ios-red/10">
                  <div className="flex items-center space-x-3 mb-4 text-ios-red">
                      <SettingsIcon size={20} />
                      <h3 className="font-bold text-lg">核心设置</h3>
                  </div>
                  
                  <div className="space-y-4">
                      <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">TuneHub API Key</label>
                        <input 
                            type="password" 
                            placeholder="th_xxxxxxxxxxxx" 
                            className="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ios-red/20"
                            value={tempApiKey}
                            onChange={(e) => setTempApiKey(e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">API Base URL</label>
                        <input 
                            type="text" 
                            placeholder={DEFAULT_API_BASE}
                            className="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ios-red/20"
                            value={tempApiBase}
                            onChange={(e) => setTempApiBase(e.target.value)}
                        />
                        <p className="text-[10px] text-gray-400 mt-1 leading-tight">默认为 {DEFAULT_API_BASE}，如遇接口故障可尝试更换。</p>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">CORS 代理 (可选)</label>
                        <input 
                            type="text" 
                            placeholder="https://corsproxy.io/?" 
                            className="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ios-red/20"
                            value={tempProxy}
                            onChange={(e) => setTempProxy(e.target.value)}
                        />
                        <p className="text-[10px] text-gray-400 mt-1 leading-tight">若无法播放，请填入代理地址。</p>
                      </div>

                      <button 
                        onClick={handleSaveSettings}
                        className="w-full py-3 bg-ios-red text-white rounded-xl font-bold text-sm shadow-md active:scale-95 transition"
                      >
                          保存配置
                      </button>
                  </div>
              </div>

              <div className="bg-white p-5 rounded-2xl shadow-sm">
                  <div className="flex items-center space-x-3 mb-4 text-gray-600">
                      <UploadIcon size={20} />
                      <h3 className="font-bold text-lg">数据备份</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                      <button onClick={exportData} className="py-3 bg-gray-100 text-ios-text rounded-xl font-medium text-xs">导出 JSON</button>
                      <div className="relative">
                          <button className="w-full py-3 bg-gray-100 text-ios-text rounded-xl font-medium text-xs">导入数据</button>
                          <input type="file" accept=".json" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFileImport} />
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Library;