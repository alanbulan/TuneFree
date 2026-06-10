import React, { useState, useMemo, useEffect } from "react";
import { usePlayerActions } from "../contexts/PlayerContext";
import { useLibrary, type LibraryImportMode, type LibraryImportPreview } from "../contexts/LibraryContext";
import { useToast } from "../components/ToastHost";
import { getImgReferrerPolicy } from "../services/api";
import {
  importPlaylist,
  getPlaylistImportErrorMessage,
  PLAYLIST_IMPORT_SOURCES,
} from "../services/playlistImport";
import {
  listOfflineDownloads,
  deleteOfflineDownload,
  subscribeOfflineDownloads,
  formatOfflineSize,
  type OfflineDownloadMeta,
} from "../services/offlineDownloads";
import { Song } from "../types";
import {
  HeartFillIcon,
  FolderIcon,
  PlusIcon,
  TrashIcon,
  SettingsIcon,
  UploadIcon,
  MusicIcon,
  InfoIcon,
  ExternalLinkIcon,
  GithubIcon,
  PlayIcon,
  DownloadIcon,
  LinkIcon,
} from "../components/Icons";
import {
  GD_STUDIO_ATTRIBUTION,
  GD_STUDIO_RATE_LIMIT_HINT,
} from "../utils/musicSource";

type Tab = "favorites" | "playlists" | "manage" | "about";

const Library: React.FC = () => {
  const { playSong, playQueue } = usePlayerActions();
  const {
    favorites,
    playlists,
    corsProxy,
    setCorsProxy,
    createPlaylist,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    renamePlaylist,
    exportData,
    parseImportData,
    applyImportData,
    restoreData,
  } = useLibrary();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<Tab>("favorites");
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [isEditMode, setIsEditMode] = useState(false);
  const [pendingImport, setPendingImport] = useState<LibraryImportPreview | null>(null);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importSource, setImportSource] = useState<string>(
    PLAYLIST_IMPORT_SOURCES[0].value,
  );
  const [importInput, setImportInput] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  const [showDownloadManager, setShowDownloadManager] = useState(false);
  const [offlineDownloads, setOfflineDownloads] = useState<OfflineDownloadMeta[]>([]);

  const [tempProxy, setTempProxy] = useState(corsProxy);

  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    null,
  );

  const selectedPlaylist = useMemo(
    () => playlists.find((p) => p.id === selectedPlaylistId) || null,
    [playlists, selectedPlaylistId],
  );

  // 离线下载列表：加载 + 订阅变更（下载/删除后自动刷新）
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      listOfflineDownloads().then((items) => {
        if (!cancelled) setOfflineDownloads(items);
      });
    };
    refresh();
    const unsubscribe = subscribeOfflineDownloads(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const handleImportPlaylist = async () => {
    if (isImporting || !importInput.trim()) return;
    setIsImporting(true);
    try {
      const payload = await importPlaylist(importSource, importInput);
      createPlaylist(payload.name, payload.songs);
      setShowImportModal(false);
      setImportInput("");
      showToast(`已导入「${payload.name}」共 ${payload.songs.length} 首`, "success");
    } catch (error) {
      showToast(getPlaylistImportErrorMessage(error), "error");
    } finally {
      setIsImporting(false);
    }
  };

  const handleDeleteOfflineDownload = async (item: OfflineDownloadMeta) => {
    try {
      await deleteOfflineDownload(item.key);
      showToast("已删除离线条目", "success");
    } catch {
      showToast("删除失败，请稍后再试", "error");
    }
  };

  const handleSaveSettings = () => {
    setCorsProxy(tempProxy);
    showToast("设置已保存", "success");
  };

  const handleCreatePlaylist = () => {
    if (newPlaylistName.trim()) {
      createPlaylist(newPlaylistName);
      setNewPlaylistName("");
      setShowCreateModal(false);
    }
  };

  const handleRenamePlaylist = () => {
    if (selectedPlaylist && renameValue.trim()) {
      renamePlaylist(selectedPlaylist.id, renameValue);
      setShowRenameModal(false);
    }
  };

  const handleExport = () => {
    const result = exportData();
    showToast(result.ok ? "已导出 JSON" : result.error, result.ok ? "success" : "error");
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = typeof event.target?.result === "string" ? event.target.result : "";
      const result = parseImportData(text);
      if (!result.ok) {
        showToast(result.error, "error");
      } else {
        setPendingImport(result.data);
        showToast("已读取导入文件，请确认", "info");
      }
      input.value = "";
    };
    reader.onerror = () => {
      showToast("读取文件失败", "error");
      input.value = "";
    };
    reader.readAsText(file);
  };

  const applyPendingImport = (mode: LibraryImportMode) => {
    if (!pendingImport) return;
    if (mode === "replace" && !window.confirm("覆盖导入会替换当前收藏和歌单，确定继续吗？")) return;

    const result = applyImportData(pendingImport, mode);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }

    setPendingImport(null);
    showToast(mode === "merge" ? "已合并导入" : "已覆盖导入", "success", {
      label: "撤销",
      onClick: () => restoreData(result.backup),
    });
  };

  const renderSongList = (
    songs: Song[],
    canRemove: boolean = false,
    playlistId?: string,
    queueSongs?: Song[],
  ) => (
    <div className="space-y-3 pb-24">
      {songs.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">暂无歌曲</div>
      ) : (
        songs.map((song, idx) => {
          const sName = typeof song.name === "string" ? song.name : "未知歌曲";
          const sArtist =
            typeof song.artist === "string" ? song.artist : "未知歌手";

          return (
            <div
              key={`${song.id}-${idx}`}
              className="flex items-center space-x-3 bg-white p-2 rounded-xl shadow-sm active:scale-[0.98] transition cursor-pointer"
              onClick={() => {
                if (queueSongs) {
                  playQueue(queueSongs, song);
                } else {
                  playSong(song);
                }
              }}
            >
              <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 flex items-center justify-center">
                {song.pic ? (
                  <img
                    src={song.pic}
                    alt="art"
                    referrerPolicy={getImgReferrerPolicy(song.pic)}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <MusicIcon className="text-gray-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-ios-text text-[15px] font-medium truncate">
                  {sName}
                </p>
                <p className="text-ios-subtext text-xs truncate">{sArtist}</p>
              </div>
              {canRemove && playlistId && isEditMode && (
                <button
                  className="p-2 text-ios-red/70 hover:text-ios-red bg-ios-red/5 rounded-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromPlaylist(playlistId, song.id, song.source);
                  }}
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
      <div className="p-5 pt-safe min-h-screen bg-ios-bg">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-ios-text">我的资料库</h1>
        </div>

        <div className="flex bg-gray-200/50 p-1 rounded-xl mb-6 overflow-x-auto no-scrollbar">
          {(["favorites", "playlists", "manage", "about"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap px-2 ${activeTab === t ? "bg-white shadow-sm text-ios-text" : "text-gray-500"}`}
              onClick={() => {
                setActiveTab(t);
                setSelectedPlaylistId(null);
                setShowDownloadManager(false);
              }}
            >
              {t === "favorites"
                ? "收藏"
                : t === "playlists"
                  ? "歌单"
                  : t === "manage"
                    ? "管理"
                    : "关于"}
            </button>
          ))}
        </div>

        {activeTab === "favorites" && (
          <div>
            <div className="flex items-center space-x-2 mb-4 text-ios-red">
              <HeartFillIcon size={20} />
              <span className="font-bold text-lg">
                我喜欢的音乐 ({favorites.length})
              </span>
            </div>
            {renderSongList(favorites)}
          </div>
        )}

        {activeTab === "playlists" && !selectedPlaylist && (
          <div className="grid grid-cols-2 gap-4">
            <div
              onClick={() => setShowCreateModal(true)}
              className="aspect-square bg-white rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-gray-200 text-gray-400 active:bg-gray-50 cursor-pointer"
            >
              <PlusIcon size={32} className="mb-2" />
              <span className="text-sm font-medium">新建歌单</span>
            </div>
            <div
              onClick={() => setShowImportModal(true)}
              className="aspect-square bg-white rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-gray-200 text-gray-400 active:bg-gray-50 cursor-pointer"
            >
              <LinkIcon size={32} className="mb-2" />
              <span className="text-sm font-medium">导入歌单</span>
            </div>
            {playlists.map((p) => (
              <div
                key={p.id}
                onClick={() => {
                  setSelectedPlaylistId(p.id);
                  setIsEditMode(false);
                }}
                className="aspect-square bg-white rounded-2xl p-4 shadow-sm flex flex-col justify-between active:scale-95 transition relative overflow-hidden"
              >
                <FolderIcon size={28} className="text-ios-red z-10" />
                <div className="z-10">
                  <p className="font-bold text-ios-text truncate">
                    {String(p.name || "未命名歌单")}
                  </p>
                  <p className="text-xs text-gray-500">
                    {p.songs.length} 首歌曲
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "playlists" && selectedPlaylist && (
          <div>
            <button
              onClick={() => setSelectedPlaylistId(null)}
              className="mb-4 text-ios-red text-sm font-medium flex items-center"
            >
              &larr; 返回歌单列表
            </button>
            <div className="bg-white p-4 rounded-2xl shadow-sm mb-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-bold truncate">
                    {String(selectedPlaylist.name || "未命名歌单")}
                  </h2>
                  <p className="text-xs text-gray-500">
                    {selectedPlaylist.songs.length} 首歌曲
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => playQueue(selectedPlaylist.songs)}
                    disabled={selectedPlaylist.songs.length === 0}
                    className="flex items-center gap-1 rounded-lg bg-ios-red px-3 py-1.5 text-xs font-bold text-white transition disabled:bg-gray-200 disabled:text-gray-400"
                  >
                    <PlayIcon size={13} className="fill-current" />
                    播放全部
                  </button>
                  <button
                    onClick={() => setIsEditMode(!isEditMode)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${isEditMode ? "bg-ios-red text-white" : "bg-gray-100 text-ios-red"}`}
                  >
                    {isEditMode ? "完成" : "编辑"}
                  </button>
                </div>
              </div>
              {isEditMode && (
                <div className="flex items-center space-x-3 mt-4 pt-4 border-t border-gray-100">
                  <button
                    onClick={() => {
                      setRenameValue(selectedPlaylist.name);
                      setShowRenameModal(true);
                    }}
                    className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium"
                  >
                    重命名
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("确定删除？")) {
                        deletePlaylist(selectedPlaylist.id);
                        setSelectedPlaylistId(null);
                      }
                    }}
                    className="flex-1 py-2 bg-ios-red/5 text-ios-red rounded-lg text-xs font-medium"
                  >
                    删除歌单
                  </button>
                </div>
              )}
            </div>
            {renderSongList(selectedPlaylist.songs, true, selectedPlaylist.id, selectedPlaylist.songs)}
          </div>
        )}

        {activeTab === "manage" && showDownloadManager && (
          <div>
            <button
              onClick={() => setShowDownloadManager(false)}
              className="mb-4 text-ios-red text-sm font-medium flex items-center"
            >
              &larr; 返回管理
            </button>
            <div className="bg-white p-4 rounded-2xl shadow-sm mb-4">
              <h2 className="text-2xl font-bold">下载管理</h2>
              <p className="text-xs text-gray-500 mt-1">
                {offlineDownloads.length} 个离线条目 · 播放时优先使用本地文件
              </p>
            </div>
            <div className="space-y-3 pb-24">
              {offlineDownloads.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">
                  暂无离线条目，在播放器的下载面板中选择「离线缓存」即可添加
                </div>
              ) : (
                offlineDownloads.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center space-x-3 bg-white p-2 rounded-xl shadow-sm active:scale-[0.98] transition cursor-pointer"
                    onClick={() => playSong(item.song)}
                  >
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 flex items-center justify-center">
                      {item.song.pic ? (
                        <img
                          src={item.song.pic}
                          alt="art"
                          referrerPolicy={getImgReferrerPolicy(item.song.pic)}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <MusicIcon className="text-gray-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-ios-text text-[15px] font-medium truncate">
                        {item.song.name}
                      </p>
                      <p className="text-ios-subtext text-xs truncate">
                        {item.song.artist}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">
                      {item.quality}
                    </span>
                    <span className="text-[10px] text-gray-400 flex-shrink-0">
                      {formatOfflineSize(item.size)}
                    </span>
                    <button
                      className="p-2 text-ios-red/70 hover:text-ios-red bg-ios-red/5 rounded-full flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteOfflineDownload(item);
                      }}
                    >
                      <TrashIcon size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === "manage" && !showDownloadManager && (
          <div className="space-y-4">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-ios-red/10">
              <div className="flex items-center space-x-3 mb-4 text-ios-red">
                <SettingsIcon size={20} />
                <h3 className="font-bold text-lg">网络设置</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">
                    CORS 代理 (可选)
                  </label>
                  <input
                    type="text"
                    placeholder="留空使用内置代理（推荐）"
                    className="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ios-red/20"
                    value={tempProxy}
                    onChange={(e) => setTempProxy(e.target.value)}
                  />
                  <p className="text-[10px] text-gray-400 mt-1 leading-tight">
                    留空将自动使用内置 CF
                    代理。仅在内置代理失效时填入自定义地址，如
                    https://corsproxy.io/?
                  </p>
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
                <DownloadIcon size={20} />
                <h3 className="font-bold text-lg">下载管理</h3>
              </div>
              <p className="text-xs text-gray-400 mb-1 leading-relaxed">
                {offlineDownloads.length > 0
                  ? `已离线 ${offlineDownloads.length} 个条目，下载后会自动出现在独立页面。`
                  : "暂无离线条目，下载后会自动出现在独立页面。"}
              </p>
              <p className="text-[10px] text-gray-400 mb-4">
                播放时会优先使用本地文件。
              </p>
              <button
                onClick={() => setShowDownloadManager(true)}
                className="w-full py-3 bg-ios-red text-white rounded-xl font-bold text-sm shadow-md active:scale-95 transition"
              >
                打开下载管理
              </button>
            </div>

            <div className="bg-white p-5 rounded-2xl shadow-sm">
              <div className="flex items-center space-x-3 mb-4 text-gray-600">
                <UploadIcon size={20} />
                <h3 className="font-bold text-lg">数据备份</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleExport}
                  className="py-3 bg-gray-100 text-ios-text rounded-xl font-medium text-xs"
                >
                  导出 JSON
                </button>
                <div className="relative">
                  <button className="w-full py-3 bg-gray-100 text-ios-text rounded-xl font-medium text-xs">
                    导入数据
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

            {pendingImport && (
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-ios-red/10">
                <h3 className="font-bold text-lg text-ios-text mb-2">确认导入数据</h3>
                <p className="text-xs text-gray-500 leading-relaxed mb-4">
                  文件包含 {pendingImport.favoriteCount} 首收藏、{pendingImport.playlistCount} 个歌单、{pendingImport.playlistSongCount} 首歌单歌曲。当前资料库有 {favorites.length} 首收藏、{playlists.length} 个歌单。
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => applyPendingImport("replace")}
                    className="py-3 bg-ios-red text-white rounded-xl font-bold text-xs"
                  >
                    覆盖导入
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPendingImport("merge")}
                    className="py-3 bg-gray-900 text-white rounded-xl font-bold text-xs"
                  >
                    合并导入
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingImport(null)}
                    className="py-3 bg-gray-100 text-gray-600 rounded-xl font-bold text-xs"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "about" && (
          <div className="space-y-4 pb-24">
            {/* 应用信息 */}
            <div className="bg-white p-6 rounded-2xl shadow-sm text-center">
              <div className="w-16 h-16 bg-ios-red/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <MusicIcon size={32} className="text-ios-red" />
              </div>
              <h2 className="text-2xl font-bold text-ios-text">
                TuneFree Mobile
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                一个高颜值的现代化 PWA 音乐播放器
              </p>
              <p className="text-xs text-gray-400 mt-2">v1.2.0</p>
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
                    <p className="text-xs text-gray-400">
                      支持网易云、QQ音乐、酷我音乐，以及 JOOX 扩展音源
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-ios-red font-bold mt-0.5">2</span>
                  <div>
                    <p className="font-medium text-ios-text">无损音质播放</p>
                    <p className="text-xs text-gray-400">
                      支持 128k / 320k / FLAC / Hi-Res
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-ios-red font-bold mt-0.5">3</span>
                  <div>
                    <p className="font-medium text-ios-text">实时音频可视化</p>
                    <p className="text-xs text-gray-400">
                      Canvas 绘制频谱动画 + 峰值指示器
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-ios-red font-bold mt-0.5">4</span>
                  <div>
                    <p className="font-medium text-ios-text">逐行滚动歌词</p>
                    <p className="text-xs text-gray-400">
                      支持双语歌词翻译显示
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-ios-red font-bold mt-0.5">5</span>
                  <div>
                    <p className="font-medium text-ios-text">PWA 离线体验</p>
                    <p className="text-xs text-gray-400">
                      添加到主屏幕，享受原生 App 体验
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 技术栈 */}
            <div className="bg-white p-5 rounded-2xl shadow-sm">
              <h3 className="font-bold text-lg mb-3 text-ios-text">技术栈</h3>
              <div className="flex flex-wrap gap-2">
                {[
                  "React 18",
                  "TypeScript",
                  "Tailwind CSS",
                  "Vite",
                  "Framer Motion",
                  "Web Audio API",
                  "Canvas",
                ].map((tech) => (
                  <span
                    key={tech}
                    className="text-xs font-medium bg-gray-100 text-gray-600 px-3 py-1.5 rounded-full"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </div>

            {/* 后端 API 致谢 */}
            <div className="bg-white p-5 rounded-2xl shadow-sm">
              <h3 className="font-bold text-lg mb-3 text-ios-text">后端 API</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                网易云、QQ音乐、酷我音乐使用直连接口；JOOX 扩展音源由{" "}
                <span className="font-medium text-ios-text">{GD_STUDIO_ATTRIBUTION}</span>{" "}
                提供。
              </p>
              <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                GD 音乐台为公开接口，建议控制请求频率：{GD_STUDIO_RATE_LIMIT_HINT}。
              </p>
              <div className="mt-2 flex flex-wrap gap-3">
                <a
                  href="https://music.gdstudio.xyz/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-ios-red font-medium"
                >
                  <ExternalLinkIcon size={12} />
                  GD音乐台
                </a>
              </div>
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
                    <span className="text-sm font-medium text-ios-text">
                      在线演示
                    </span>
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
                    <span className="text-sm font-medium text-ios-text">
                      GitHub 仓库
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    alanbulan/musicxilan
                  </span>
                </a>
              </div>
            </div>

            {/* 声明 */}
            <div className="bg-gray-50 p-4 rounded-2xl">
              <p className="text-[11px] text-gray-400 leading-relaxed text-center">
                本项目仅供学习 React 及现代前端技术栈使用。音乐资源来源于第三方
                API，本项目不存储任何音频文件。请支持正版音乐。
              </p>
              <p className="text-[11px] text-gray-300 mt-2 text-center">
                MIT License &copy; 2026 TuneFree
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ====== 新建歌单弹窗 ====== */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl p-6 shadow-2xl animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">新建歌单</h3>
            <input
              type="text"
              placeholder="输入歌单名称"
              className="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ios-red/20 mb-4"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreatePlaylist()}
            />
            <div className="flex space-x-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium text-sm"
              >
                取消
              </button>
              <button
                onClick={handleCreatePlaylist}
                className="flex-1 py-3 bg-ios-red text-white rounded-xl font-bold text-sm"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====== 导入在线歌单弹窗 ====== */}
      {showImportModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4"
          onClick={() => !isImporting && setShowImportModal(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl p-6 shadow-2xl animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">导入在线歌单</h3>
            <div className="flex bg-gray-100 p-1 rounded-xl mb-3">
              {PLAYLIST_IMPORT_SOURCES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setImportSource(s.value)}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${importSource === s.value ? "bg-white shadow-sm text-ios-text" : "text-gray-500"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder={
                PLAYLIST_IMPORT_SOURCES.find((s) => s.value === importSource)
                  ?.placeholder || "歌单链接或 ID"
              }
              className="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ios-red/20 mb-2"
              value={importInput}
              onChange={(e) => setImportInput(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleImportPlaylist()}
            />
            <p className="text-[10px] text-gray-400 mb-4 leading-tight">
              支持歌单分享链接或纯 ID，导入后保存为本地歌单。
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowImportModal(false)}
                disabled={isImporting}
                className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium text-sm disabled:opacity-60"
              >
                取消
              </button>
              <button
                onClick={handleImportPlaylist}
                disabled={isImporting || !importInput.trim()}
                className="flex-1 py-3 bg-ios-red text-white rounded-xl font-bold text-sm disabled:opacity-60"
              >
                {isImporting ? "导入中…" : "导入"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====== 重命名歌单弹窗 ====== */}
      {showRenameModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4"
          onClick={() => setShowRenameModal(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl p-6 shadow-2xl animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">重命名歌单</h3>
            <input
              type="text"
              placeholder="输入新名称"
              className="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ios-red/20 mb-4"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleRenamePlaylist()}
            />
            <div className="flex space-x-3">
              <button
                onClick={() => setShowRenameModal(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium text-sm"
              >
                取消
              </button>
              <button
                onClick={handleRenamePlaylist}
                className="flex-1 py-3 bg-ios-red text-white rounded-xl font-bold text-sm"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Library;
