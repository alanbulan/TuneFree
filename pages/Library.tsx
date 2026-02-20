import React, { useState, useMemo, useCallback } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { useLibrary } from '../contexts/LibraryContext';
import { getPlaylistDetail, DEFAULT_API_BASE, getImgReferrerPolicy } from '../services/api';
import { Song } from '../types';
import { HeartFillIcon, FolderIcon, PlusIcon, TrashIcon, SettingsIcon, DownloadIcon, UploadIcon, MusicIcon, KeyIcon, InfoIcon, ExternalLinkIcon, GithubIcon } from '../components/Icons';

type Tab = 'favorites' | 'playlists' | 'manage' | 'about';

// ====== 轻量级 Toast 提示（替代 alert 阻塞） ======
const useToast = () => {
    const [toast, setToast] = useState<string | null>(null);
    const show = useCallback((msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 2200);
    }, []);
    const ToastUI = useMemo(() => {
        if (!toast) return null;
        return (
            <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[999] bg-black/80 text-white text-sm px-5 py-2.5 rounded-xl shadow-lg animate-fade-in pointer-events-none">
                {toast}
            </div>
        );
    }, [toast]);
    return { show, ToastUI };
};

const Library: React.FC = () => {
  const { queue, playSong } = usePlayer();
  const {
    favorites, playlists, apiKey, corsProxy, apiBase, setApiKey, setCorsProxy, setApiBase,
    createPlaylist, importPlaylist, deletePlaylist,
    addToPlaylist, removeFromPlaylist, renamePlaylist,
    exportData, importData
  } = useLibrary();
  const { show: showToast, ToastUI } = useToast();
  
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
    showToast('设置已保存');
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
          showToast(`成功导入歌单「${result.name}」`);
      } else {
          showToast('导入失败，请检查 Key、ID 或音源');
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
          showToast(success ? '数据导入成功' : '数据导入失败');
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
                                <img src={song.pic} alt="art" referrerPolicy={getImgReferrerPolicy(song.pic)} loading="lazy" className="w-full h-full object-cover" />
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
                                className="p-2 text-ios-red/70 hover:text-ios-red bg-ios-red/5 rounded-full"
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
    <>
    {ToastUI}
    <div className="p-5 pt-safe min-h-screen bg-ios-bg">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-ios-text">我的资料库</h1>
      </div>

      <div className="flex bg-gray-200/50 p-1 rounded-xl mb-6 overflow-x-auto no-scrollbar">
        {(['favorites', 'playlists', 'manage', 'about'] as Tab[]).map((t) => (
            <button
                key={t}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap px-2 ${activeTab === t ? 'bg-white shadow-sm text-ios-text' : 'text-gray-500'}`}
                onClick={() => { setActiveTab(t); setSelectedPlaylistId(null); }}
            >
                {t === 'favorites' ? '收藏' : t === 'playlists' ? '歌单' : t === 'manage' ? '管理' : '关于'}
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
            <div onClick={() => setShowImportModal(true)} className="aspect-square bg-white rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-ios-red/30 text-ios-red active:bg-ios-red/5 cursor-pointer">
                <DownloadIcon size={32} className="mb-2" />
                <span className="text-sm font-medium">导入在线歌单</span>
            </div>
            {playlists.map(p => (
                <div key={p.id} onClick={() => { setSelectedPlaylistId(p.id); setIsEditMode(false); }} className="aspect-square bg-white rounded-2xl p-4 shadow-sm flex flex-col justify-between active:scale-95 transition relative overflow-hidden">
                    <FolderIcon size={28} className="text-ios-red z-10" />
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
              <button onClick={() => setSelectedPlaylistId(null)} className="mb-4 text-ios-red text-sm font-medium flex items-center">&larr; 返回歌单列表</button>
              <div className="bg-white p-4 rounded-2xl shadow-sm mb-4">
                  <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                          <h2 className="text-2xl font-bold truncate">{String(selectedPlaylist.name || '未命名歌单')}</h2>
                          <p className="text-xs text-gray-500">{selectedPlaylist.songs.length} 首歌曲</p>
                      </div>
                      <button onClick={() => setIsEditMode(!isEditMode)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${isEditMode ? 'bg-ios-red text-white' : 'bg-gray-100 text-ios-red'}`}>{isEditMode ? '完成' : '编辑'}</button>
                  </div>
                  {isEditMode && (
                      <div className="flex items-center space-x-3 mt-4 pt-4 border-t border-gray-100">
                          <button onClick={() => {setRenameValue(selectedPlaylist.name); setShowRenameModal(true);}} className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium">重命名</button>
                          <button onClick={() => {if(confirm('确定删除？')){deletePlaylist(selectedPlaylist.id); setSelectedPlaylistId(null);}}} className="flex-1 py-2 bg-ios-red/5 text-ios-red rounded-lg text-xs font-medium">删除歌单</button>
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

      {activeTab === 'about' && (
          <div className="space-y-4 pb-24">
              {/* 应用信息 */}
              <div className="bg-white p-6 rounded-2xl shadow-sm text-center">
                  <div className="w-16 h-16 bg-ios-red/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <MusicIcon size={32} className="text-ios-red" />
                  </div>
                  <h2 className="text-2xl font-bold text-ios-text">TuneFree Mobile</h2>
                  <p className="text-sm text-gray-500 mt-1">一个高颜值的现代化 PWA 音乐播放器</p>
                  <p className="text-xs text-gray-400 mt-2">v1.1.0</p>
              </div>

              {/* 功能特性 */}
              <div className="bg-white p-5 rounded-2xl shadow-sm">
                  <div className="flex items-center space-x-3 mb-4 text-ios-red">
                      <InfoIcon size={20} />
                      <h3 className="font-bold text-lg">功能特性</h3>
                  </div>
                  <div className="space-y-3 text-sm text-gray-600">
                      <div className="flex items-start gap-3">
                          <span className="text-ios-red font-bold mt-0.5">1</span>
                          <div>
                              <p className="font-medium text-ios-text">多源聚合搜索</p>
                              <p className="text-xs text-gray-400">支持网易云、QQ音乐、酷我音乐等多平台</p>
                          </div>
                      </div>
                      <div className="flex items-start gap-3">
                          <span className="text-ios-red font-bold mt-0.5">2</span>
                          <div>
                              <p className="font-medium text-ios-text">无损音质播放</p>
                              <p className="text-xs text-gray-400">支持 128k / 320k / FLAC / Hi-Res</p>
                          </div>
                      </div>
                      <div className="flex items-start gap-3">
                          <span className="text-ios-red font-bold mt-0.5">3</span>
                          <div>
                              <p className="font-medium text-ios-text">实时音频可视化</p>
                              <p className="text-xs text-gray-400">Canvas 绘制频谱动画 + 峰值指示器</p>
                          </div>
                      </div>
                      <div className="flex items-start gap-3">
                          <span className="text-ios-red font-bold mt-0.5">4</span>
                          <div>
                              <p className="font-medium text-ios-text">逐行滚动歌词</p>
                              <p className="text-xs text-gray-400">支持双语歌词翻译显示</p>
                          </div>
                      </div>
                      <div className="flex items-start gap-3">
                          <span className="text-ios-red font-bold mt-0.5">5</span>
                          <div>
                              <p className="font-medium text-ios-text">PWA 离线体验</p>
                              <p className="text-xs text-gray-400">添加到主屏幕，享受原生 App 体验</p>
                          </div>
                      </div>
                  </div>
              </div>

              {/* 技术栈 */}
              <div className="bg-white p-5 rounded-2xl shadow-sm">
                  <h3 className="font-bold text-lg mb-3 text-ios-text">技术栈</h3>
                  <div className="flex flex-wrap gap-2">
                      {['React 19', 'TypeScript', 'Tailwind CSS', 'Vite', 'Framer Motion', 'Web Audio API', 'Canvas'].map(tech => (
                          <span key={tech} className="text-xs font-medium bg-gray-100 text-gray-600 px-3 py-1.5 rounded-full">{tech}</span>
                      ))}
                  </div>
              </div>

              {/* 后端 API 致谢 */}
              <div className="bg-white p-5 rounded-2xl shadow-sm">
                  <h3 className="font-bold text-lg mb-3 text-ios-text">后端 API</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">
                      音乐数据服务由 <span className="font-medium text-ios-text">TuneHub API</span> 提供。
                  </p>
                  <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                      API 作者：是青旨啊@sayqz (Linux.do)
                  </p>
                  <a
                      href="https://linux.do/t/topic/1326425"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-ios-red font-medium mt-2"
                  >
                      <ExternalLinkIcon size={12} />
                      查看原帖
                  </a>
              </div>

              {/* 链接 */}
              <div className="bg-white p-5 rounded-2xl shadow-sm">
                  <h3 className="font-bold text-lg mb-3 text-ios-text">链接</h3>
                  <div className="space-y-3">
                      <a
                          href="https://xilan.ccwu.cc/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-xl active:bg-gray-100 transition"
                      >
                          <div className="flex items-center gap-3">
                              <ExternalLinkIcon size={18} className="text-ios-red" />
                              <span className="text-sm font-medium text-ios-text">在线演示</span>
                          </div>
                          <span className="text-xs text-gray-400">xilan.ccwu.cc</span>
                      </a>
                      <a
                          href="https://github.com/alanbulan/musicxilan"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-xl active:bg-gray-100 transition"
                      >
                          <div className="flex items-center gap-3">
                              <GithubIcon size={18} className="text-gray-700" />
                              <span className="text-sm font-medium text-ios-text">GitHub 仓库</span>
                          </div>
                          <span className="text-xs text-gray-400">alanbulan/musicxilan</span>
                      </a>
                  </div>
              </div>

              {/* 声明 */}
              <div className="bg-gray-50 p-4 rounded-2xl">
                  <p className="text-[11px] text-gray-400 leading-relaxed text-center">
                      本项目仅供学习 React 及现代前端技术栈使用。音乐资源来源于第三方 API，本项目不存储任何音频文件。请支持正版音乐。
                  </p>
                  <p className="text-[11px] text-gray-300 mt-2 text-center">MIT License &copy; 2026 TuneFree</p>
              </div>
          </div>
      )}
    </div>

    {/* ====== 新建歌单弹窗 ====== */}
    {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40" onClick={() => setShowCreateModal(false)}>
            <div className="w-full max-w-md bg-white rounded-t-2xl p-6 pb-safe animate-fade-in" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold mb-4">新建歌单</h3>
                <input
                    type="text"
                    placeholder="输入歌单名称"
                    className="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ios-red/20 mb-4"
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleCreatePlaylist()}
                />
                <div className="flex space-x-3">
                    <button onClick={() => setShowCreateModal(false)} className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium text-sm">取消</button>
                    <button onClick={handleCreatePlaylist} className="flex-1 py-3 bg-ios-red text-white rounded-xl font-bold text-sm">创建</button>
                </div>
            </div>
        </div>
    )}

    {/* ====== 导入在线歌单弹窗 ====== */}
    {showImportModal && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40" onClick={() => !isImporting && setShowImportModal(false)}>
            <div className="w-full max-w-md bg-white rounded-t-2xl p-6 pb-safe animate-fade-in" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold mb-4">导入在线歌单</h3>
                <div className="mb-3">
                    <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">音源</label>
                    <div className="flex space-x-2">
                        {['netease', 'qq', 'kuwo'].map(s => (
                            <button
                                key={s}
                                onClick={() => setImportSource(s)}
                                className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${importSource === s ? 'bg-ios-red text-white' : 'bg-gray-100 text-gray-500'}`}
                            >
                                {s.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="mb-4">
                    <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">歌单 ID</label>
                    <input
                        type="text"
                        placeholder="输入歌单 ID"
                        className="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ios-red/20"
                        value={importId}
                        onChange={(e) => setImportId(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleImportOnlinePlaylist()}
                    />
                </div>
                <div className="flex space-x-3">
                    <button onClick={() => setShowImportModal(false)} disabled={isImporting} className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium text-sm disabled:opacity-50">取消</button>
                    <button onClick={handleImportOnlinePlaylist} disabled={isImporting} className="flex-1 py-3 bg-ios-red text-white rounded-xl font-bold text-sm disabled:opacity-50">
                        {isImporting ? '导入中...' : '导入'}
                    </button>
                </div>
            </div>
        </div>
    )}

    {/* ====== 重命名歌单弹窗 ====== */}
    {showRenameModal && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40" onClick={() => setShowRenameModal(false)}>
            <div className="w-full max-w-md bg-white rounded-t-2xl p-6 pb-safe animate-fade-in" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold mb-4">重命名歌单</h3>
                <input
                    type="text"
                    placeholder="输入新名称"
                    className="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ios-red/20 mb-4"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleRenamePlaylist()}
                />
                <div className="flex space-x-3">
                    <button onClick={() => setShowRenameModal(false)} className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium text-sm">取消</button>
                    <button onClick={handleRenamePlaylist} className="flex-1 py-3 bg-ios-red text-white rounded-xl font-bold text-sm">确认</button>
                </div>
            </div>
        </div>
    )}
    </>
  );
};

export default Library;