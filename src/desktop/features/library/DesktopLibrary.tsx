import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BoxesIcon,
  CloudIcon,
  CodeIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  FolderIcon,
  GithubIcon,
  InfoIcon,
  MusicIcon,
  PanelsIcon,
  PlusIcon,
  RocketIcon,
  ServerIcon,
  SettingsIcon,
  UploadIcon,
  WaveformIcon,
  RefreshIcon,
} from '../../../core/components/Icons';
import { useLibrary, type LibraryImportMode, type LibraryImportPreview } from '../../../core/contexts/LibraryContext';
import { usePlayerActions, usePlayerNowPlaying } from '../../../core/contexts/PlayerContext';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  importPlaylist,
  getPlaylistImportErrorMessage,
  PLAYLIST_IMPORT_SOURCES,
} from '../../../core/services/playlistImport';
import {
  listOfflineDownloads,
  deleteOfflineDownload,
  subscribeOfflineDownloads,
  formatOfflineSize,
  type OfflineDownloadMeta,
} from '../../../core/services/offlineDownloads';
import type { Playlist } from '../../../core/types';
import type { LibraryView } from '../../types';
import { GD_STUDIO_ATTRIBUTION, GD_STUDIO_RATE_LIMIT_HINT } from '../../../core/utils/musicSource';
import SongTable from '../../components/SongTable';
import { useToast } from '../../components/ToastHost';

const viewMeta: Record<LibraryView, { eyebrow: string; title: string }> = {
  favorites: { eyebrow: 'Your Collection', title: '收藏' },
  playlists: { eyebrow: 'Playlists', title: '歌单' },
  downloads: { eyebrow: 'Offline Library', title: '下载' },
  settings: { eyebrow: 'Control Panel', title: '管理' },
  about: { eyebrow: 'About TuneFree', title: '关于' },
};
const desktopTechStack = [
  { name: 'Tauri v2', detail: 'Desktop Container', icon: <BoxesIcon size={18} /> },
  { name: 'Rust', detail: 'Backend Services', icon: <ServerIcon size={18} /> },
  { name: 'Next.js 15', detail: 'App & Route UI', icon: <RocketIcon size={18} /> },
  { name: 'React 18', detail: 'Component Engine', icon: <CodeIcon size={18} /> },
  { name: 'TypeScript', detail: 'Typed codebase', icon: <FileCodeIcon size={18} /> },
  { name: 'Axum', detail: 'Local API & Proxy', icon: <DatabaseIcon size={18} /> },
  { name: 'Web Audio API', detail: 'Audio Spectrum', icon: <WaveformIcon size={18} /> },
  { name: 'Canvas', detail: 'Spectrum Render', icon: <PanelsIcon size={18} /> },
];

interface CustomSelectProps {
  value: string;
  options: readonly { label: string; value: string }[];
  onChange: (value: string) => void;
}

function CustomSelect({ value, options, onChange }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  return (
    <div ref={containerRef} className="custom-select-container">
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span>{selectedOption.label}</span>
        <svg
          className={`custom-select-arrow ${isOpen ? 'is-open' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      
      {isOpen && (
        <div className="custom-select-options" role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`custom-select-option ${option.value === value ? 'is-selected' : ''}`}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface DesktopLibraryProps {
  activeView: LibraryView;
}

export default function DesktopLibrary({ activeView }: DesktopLibraryProps) {
  const {
    favorites,
    playlists,
    corsProxy,
    setCorsProxy,
    toggleFavorite,
    isFavorite,
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    removeFromPlaylist,
    exportData,
    parseImportData,
    applyImportData,
    restoreData,
  } = useLibrary();
  const { playSong, playQueue } = usePlayerActions();
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { showToast } = useToast();
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [tempProxy, setTempProxy] = useState(corsProxy);
  const [tempShowPet, setTempShowPet] = useState(true);
  const [pendingImport, setPendingImport] = useState<LibraryImportPreview | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState<number | null>(null);
  const [appVersion, setAppVersion] = useState('1.0.10');

  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
    if (isTauri) {
      import('@tauri-apps/api/app').then(({ getVersion }) => {
        getVersion().then((ver) => setAppVersion(ver));
      }).catch(() => {});
    }
  }, []);

function isNewVersionAvailable(latest: string, current: string): boolean {
  if (!latest || !current) return false;
  const latestParts = latest.replace(/^v/, '').split('.').map(Number);
  const currentParts = current.replace(/^v/, '').split('.').map(Number);
  
  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const latestVal = latestParts[i] || 0;
    const currentVal = currentParts[i] || 0;
    if (latestVal > currentVal) return true;
    if (latestVal < currentVal) return false;
  }
  return false;
}

  const triggerAutoUpdate = async (url: string) => {
    const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
    if (isTauri) {
      setDownloadingUpdate(true);
      setUpdateDownloadProgress(0);
      try {
        await invoke('download_and_install_update', { url });
      } catch (err: any) {
        setDownloadingUpdate(false);
        setUpdateDownloadProgress(null);
        showToast('自动更新失败，正在调起浏览器为您下载...', 'error');
        try {
          await invoke('open_external_url', { url });
        } catch {
          showToast('无法打开下载页面，请手动前往', 'error');
        }
      }
    } else {
      window.open(url, '_blank');
    }
  };

  const checkUpdateSilently = async () => {
    try {
      const response = await fetch('https://api.github.com/repos/alanbulan/TuneFree_Mobile/releases/latest');
      if (!response.ok) return;
      const data = await response.json();
      const latestVersion = data.tag_name ? data.tag_name.replace(/^v/, '') : '';

      if (latestVersion && isNewVersionAvailable(latestVersion, appVersion)) {
        const asset = data.assets?.find((a: any) => a.name.endsWith('.exe'));
        if (asset && asset.browser_download_url) {
          showToast(`发现新版本 v${latestVersion}，正在后台自动下载并更新...`, 'info');
          void triggerAutoUpdate(asset.browser_download_url);
        }
      }
    } catch {
      // 保持静默
    }
  };

  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
    if (isTauri) {
      const timer = setTimeout(() => {
        void checkUpdateSilently();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [appVersion]);

  const handleCheckUpdate = async () => {
    if (checkingUpdate || downloadingUpdate) return;
    setCheckingUpdate(true);
    try {
      const response = await fetch('https://api.github.com/repos/alanbulan/TuneFree_Mobile/releases/latest');
      if (!response.ok) {
        throw new Error('网络请求失败');
      }
      const data = await response.json();
      const latestVersion = data.tag_name ? data.tag_name.replace(/^v/, '') : '';

      if (latestVersion && isNewVersionAvailable(latestVersion, appVersion)) {
        const asset = data.assets?.find((a: any) => a.name.endsWith('.exe'));
        if (asset && asset.browser_download_url) {
          showToast(`发现新版本 v${latestVersion}，已开始后台静默下载并自动安装...`, 'info');
          void triggerAutoUpdate(asset.browser_download_url);
        } else {
          showToast(`发现新版本 v${latestVersion}，但未找到 Windows 安装包，已为您打开网页`, 'info');
          try {
            await invoke('open_external_url', { url: data.html_url });
          } catch {
            window.open(data.html_url, '_blank');
          }
        }
      } else {
        showToast(`当前已是最新版本 (v${appVersion})`, 'info');
      }
    } catch (err: any) {
      showToast('检查更新失败，请稍后再试', 'error');
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setTempShowPet(localStorage.getItem('tunefree_desktop_show_pet') !== 'false');
    }
  }, []);
  const [importSource, setImportSource] = useState<string>(PLAYLIST_IMPORT_SOURCES[0].value);
  const [importInput, setImportInput] = useState('');
  const [isImportingPlaylist, setIsImportingPlaylist] = useState(false);
  const [offlineDownloads, setOfflineDownloads] = useState<OfflineDownloadMeta[]>([]);
  const [downloadPath, setDownloadPath] = useState('');
  const [downloadsPage, setDownloadsPage] = useState(1);
  const itemsPerPage = 10;

  const totalPages = Math.ceil(offlineDownloads.length / itemsPerPage);
  const paginatedDownloads = useMemo(() => {
    const start = (downloadsPage - 1) * itemsPerPage;
    return offlineDownloads.slice(start, start + itemsPerPage);
  }, [offlineDownloads, downloadsPage]);

  useEffect(() => {
    const maxPage = Math.ceil(offlineDownloads.length / itemsPerPage) || 1;
    if (downloadsPage > maxPage) {
      setDownloadsPage(maxPage);
    }
  }, [offlineDownloads.length, downloadsPage]);

  const handleOpenDownloadDir = async () => {
    if (!downloadPath) return;
    try {
      await invoke('open_external_url', { url: downloadPath });
    } catch {
      showToast('打开下载目录失败', 'error');
    }
  };

  const handleSelectDownloadDir = async () => {
    try {
      const path = await invoke<string | null>('select_download_dir');
      if (path) {
        localStorage.setItem('tunefree_download_dir', path);
        setDownloadPath(path);
        showToast('下载路径已成功更改', 'success');
      }
    } catch (err: any) {
      showToast(err?.message || err || '选择目录失败', 'error');
    }
  };

  const handleResetDownloadDir = async () => {
    try {
      localStorage.removeItem('tunefree_download_dir');
      const path = await invoke<string>('get_default_download_dir');
      setDownloadPath(path);
      showToast('下载路径已恢复为默认安装目录', 'success');
    } catch (err: any) {
      showToast('恢复默认路径失败', 'error');
    }
  };

  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedPlaylistId) || null,
    [playlists, selectedPlaylistId],
  );
  const meta = viewMeta[activeView];

  useEffect(() => {
    setSelectedPlaylistId(null);
  }, [activeView]);

  // 离线下载列表：加载 + 订阅变更（下载/删除后自动刷新）
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void listOfflineDownloads().then((items) => {
        if (!cancelled) setOfflineDownloads(items);
      });
    };
    refresh();

    const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
    if (isTauri) {
      const savedDir = localStorage.getItem('tunefree_download_dir');
      if (savedDir) {
        setDownloadPath(savedDir);
      } else {
        invoke<string>('get_default_download_dir')
          .then((path) => {
            if (!cancelled) setDownloadPath(path);
          })
          .catch(() => {});
      }

      // 监听下载进度以支持自动下载更新包
      listen<{ progress: number }>('update-progress', (event) => {
        if (!cancelled) {
          setUpdateDownloadProgress(event.payload.progress);
          if (event.payload.progress === 100) {
            setDownloadingUpdate(false);
            setUpdateDownloadProgress(null);
          }
        }
      }).then((unlisten) => {
        if (cancelled) unlisten();
      });
    }

    const unsubscribe = subscribeOfflineDownloads(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const handleImportPlaylist = async () => {
    if (isImportingPlaylist || !importInput.trim()) return;
    setIsImportingPlaylist(true);
    try {
      const payload = await importPlaylist(importSource, importInput);
      createPlaylist(payload.name, payload.songs);
      setImportInput('');
      showToast(`已导入「${payload.name}」共 ${payload.songs.length} 首`, 'success');
    } catch (error) {
      showToast(getPlaylistImportErrorMessage(error), 'error');
    } finally {
      setIsImportingPlaylist(false);
    }
  };

  const handleDeleteOfflineDownload = async (item: OfflineDownloadMeta) => {
    try {
      await deleteOfflineDownload(item.key);
      showToast('已删除离线条目', 'success');
    } catch {
      showToast('删除失败，请稍后再试', 'error');
    }
  };

  const showMessage = (text: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    showToast(text, tone);
  };

  const handleCreatePlaylist = () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    createPlaylist(name);
    setNewPlaylistName('');
    showMessage(`已创建「${name}」`, 'success');
  };

  const handleExport = () => {
    const result = exportData();
    showMessage(result.ok ? `已导出 ${result.filename}` : result.error, result.ok ? 'success' : 'error');
  };

  const handleFileImport = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result ? parseImportData(event.target.result as string) : { ok: false as const, error: '文件读取失败' };
      if (!result.ok) {
        setPendingImport(null);
        showMessage(result.error, 'error');
        return;
      }
      setPendingImport(result.data);
      showMessage('已读取导入文件，请先确认预览', 'info');
    };
    reader.onerror = () => showMessage('文件读取失败', 'error');
    reader.readAsText(file);
  };

  const handleFavorite = (song: Playlist['songs'][number]) => {
    const wasFavorite = isFavorite(song.id, song.source);
    toggleFavorite(song);
    showToast(wasFavorite ? '已取消收藏' : '已收藏歌曲', 'success', {
      label: '撤销',
      onClick: () => toggleFavorite(song),
    });
  };

  const applyPendingImport = (mode: LibraryImportMode) => {
    if (!pendingImport) return;
    const confirmed = window.confirm(
      mode === 'replace'
        ? '覆盖导入会替换当前收藏和歌单，是否继续？'
        : '合并导入会把文件内容加入当前资料库，是否继续？',
    );
    if (!confirmed) return;

    const result = applyImportData(pendingImport, mode);
    if (!result.ok) {
      showMessage(result.error, 'error');
      return;
    }

    setPendingImport(null);
    showToast(mode === 'replace' ? '数据已覆盖导入' : '数据已合并导入', 'success', {
      label: '撤销',
      onClick: () => {
        restoreData(result.backup);
        showToast('已撤销导入', 'success');
      },
    });
  };

  const renderPlaylistSongs = (playlist: Playlist) => (
    <div>
      <button type="button" className="soft-button" onClick={() => setSelectedPlaylistId(null)}>← 返回歌单列表</button>
      <div className="content-card glass-panel" style={{ margin: '14px 0' }}>
        <div className="panel-label-row">
          <div>
            <p className="eyebrow">Playlist</p>
            <h2 className="section-title">{playlist.name}</h2>
            <p>{playlist.songs.length} 首歌曲</p>
          </div>
          <div className="inline-actions">
            <button
              type="button"
              className="soft-button"
              onClick={() => {
                const nextName = window.prompt('重命名歌单', playlist.name);
                if (nextName?.trim()) renamePlaylist(playlist.id, nextName.trim());
              }}
            >
              重命名
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={() => {
                if (window.confirm('确定删除这个歌单？')) {
                  deletePlaylist(playlist.id);
                  setSelectedPlaylistId(null);
                }
              }}
            >
              删除歌单
            </button>
          </div>
        </div>
      </div>
      <SongTable
        songs={playlist.songs}
        currentSong={currentSong}
        isPlaying={isPlaying}
        emptyText="这个歌单还没有歌曲"
        actionLabel="操作"
        onPlay={(song) => void playQueue(playlist.songs, song)}
        onFavorite={handleFavorite}
        isFavorite={(song) => isFavorite(song.id, song.source)}
        onDelete={(song) => removeFromPlaylist(playlist.id, song.id, song.source)}
        deleteLabel="从歌单移除"
      />
    </div>
  );

  return (
    <div>
      <div className="page-header library-page-header">
        <div>
          <p className="eyebrow">{meta.eyebrow}</p>
          <h1 className="page-title">{meta.title}</h1>
        </div>
      </div>

      {activeView === 'favorites' && (
        <section>
          <SongTable
            songs={favorites}
            currentSong={currentSong}
            isPlaying={isPlaying}
            emptyText="暂无收藏歌曲"
            onPlay={playSong}
            onFavorite={handleFavorite}
            isFavorite={(song) => isFavorite(song.id, song.source)}
          />
        </section>
      )}

      {activeView === 'playlists' && selectedPlaylist && renderPlaylistSongs(selectedPlaylist)}

      {activeView === 'playlists' && !selectedPlaylist && (
        <section className="playlist-grid">
          <div className="create-card playlist-action-card">
            <div className="playlist-action-card-body">
              <span className="playlist-card-icon"><PlusIcon size={36} /></span>
              <div className="playlist-action-copy">
                <p className="eyebrow">Create</p>
                <h3>新建歌单</h3>
                <p>从空白歌单开始整理收藏，适合按场景或心情归类。</p>
              </div>
              <div className="panel-field playlist-panel-field">
                <input className="panel-input" value={newPlaylistName} onChange={(event) => setNewPlaylistName(event.target.value)} placeholder="歌单名称" />
              </div>
              <button type="button" className="primary-button playlist-card-button" onClick={handleCreatePlaylist}>创建</button>
            </div>
          </div>

          <div className="create-card playlist-action-card">
            <div className="playlist-action-card-body">
              <span className="playlist-card-icon"><ExternalLinkIcon size={36} /></span>
              <div className="playlist-action-copy">
                <p className="eyebrow">Import</p>
                <h3>导入在线歌单</h3>
                <p>粘贴网易云 / QQ / 酷我的歌单链接或 ID，导入为本地歌单。</p>
              </div>
              <div className="panel-field playlist-panel-field" style={{ position: 'relative', zIndex: 11 }}>
                <CustomSelect
                  value={importSource}
                  options={PLAYLIST_IMPORT_SOURCES}
                  onChange={(value) => setImportSource(value)}
                />
              </div>
              <div className="panel-field playlist-panel-field">
                <input
                  className="panel-input"
                  value={importInput}
                  onChange={(event) => setImportInput(event.target.value)}
                  placeholder="歌单链接或 ID"
                  onKeyDown={(event) => event.key === 'Enter' && void handleImportPlaylist()}
                />
              </div>
              <button
                type="button"
                className="primary-button playlist-card-button"
                disabled={isImportingPlaylist || !importInput.trim()}
                onClick={() => void handleImportPlaylist()}
              >
                {isImportingPlaylist ? '导入中…' : '导入'}
              </button>
            </div>
          </div>

          {playlists.map((playlist) => (
            <button type="button" className="library-card" key={playlist.id} onClick={() => setSelectedPlaylistId(playlist.id)}>
              <FolderIcon size={34} className="muted-text" />
              <h3>{playlist.name || '未命名歌单'}</h3>
              <p>{playlist.songs.length} 首歌曲</p>
              <div className="library-card-meta">
                <span className="source-badge">本地</span>
                <span className="muted-text">打开</span>
              </div>
            </button>
          ))}
        </section>
      )}

      {activeView === 'downloads' && (
        <section>
          <div className="content-card glass-panel" style={{ marginBottom: 14 }}>
            <div className="panel-label-row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="eyebrow">Offline</p>
                <h2 className="section-title">离线条目（{offlineDownloads.length}）</h2>
                <p style={{ fontSize: '0.9rem', color: '#475569', lineHeight: 1.6, margin: '8px 0 0 0' }}>
                  离线库已启用本地优先播放策略：下载的音频文件将作为 MP3/FLAC 格式直接存入系统下载目录，播放器会自动将歌曲元数据与音频缓存至本地，以支持无网络时的离线流畅播放。
                </p>
                {downloadPath && (
                  <div className="download-path-row" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', color: '#64748b', wordBreak: 'break-all' }}>
                      当前本地下载目录：<strong>{downloadPath}</strong>
                    </span>
                    <button
                      type="button"
                      className="soft-button"
                      style={{ padding: '2px 8px', fontSize: '0.75rem', borderRadius: '6px' }}
                      onClick={handleOpenDownloadDir}
                    >
                      打开文件夹
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {offlineDownloads.length === 0 ? (
            <div className="content-card glass-panel">
              <p className="muted-text">暂无离线条目</p>
            </div>
          ) : (
            <>
              <div className="content-card glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="song-table-container">
                  <table className="song-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(15, 23, 42, 0.08)', textAlign: 'left' }}>
                        <th style={{ padding: '12px 16px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>歌曲</th>
                        <th style={{ padding: '12px 16px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>歌手</th>
                        <th style={{ padding: '12px 16px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>音质</th>
                        <th style={{ padding: '12px 16px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>大小</th>
                        <th style={{ padding: '12px 16px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>下载时间</th>
                        <th style={{ padding: '12px 16px', color: '#64748b', fontWeight: 600, fontSize: '0.85rem', textAlign: 'right' }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedDownloads.map((item) => (
                        <tr
                          key={item.key}
                          style={{ borderBottom: '1px solid rgba(15, 23, 42, 0.04)', transition: 'background 0.2s' }}
                          className="offline-download-row"
                        >
                          <td style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="source-badge" style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(250, 35, 59, 0.08)', color: '#fa233b', border: '1px solid rgba(250, 35, 59, 0.15)', fontWeight: 600 }}>
                              {item.song.source === 'netease' ? '网易云' : item.song.source === 'qq' ? 'QQ' : item.song.source === 'kuwo' ? '酷我' : item.song.source}
                            </span>
                            <span style={{ fontWeight: 500 }}>{item.song.name}</span>
                          </td>
                          <td style={{ padding: '12px 16px', color: '#475569' }}>{item.song.artist}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: item.quality === 'flac24bit' || item.quality === 'flac' ? 'rgba(250, 35, 59, 0.1)' : 'rgba(100, 116, 139, 0.1)',
                              color: item.quality === 'flac24bit' || item.quality === 'flac' ? '#fa233b' : '#475569'
                            }}>
                              {item.quality === 'flac24bit' ? 'Hi-Res' : item.quality.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', color: '#64748b' }}>{formatOfflineSize(item.size)}</td>
                          <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: '0.85rem' }}>
                            {new Date(item.createTime).toLocaleString()}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '8px' }}>
                              <button type="button" className="soft-button" onClick={() => void playSong(item.song)}>播放</button>
                              <button type="button" className="danger-button" onClick={() => void handleDeleteOfflineDownload(item)}>删除</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {totalPages > 1 && (
                <div style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: '12px',
                  marginTop: '16px',
                  padding: '8px 0'
                }}>
                  <button
                    type="button"
                    className="soft-button"
                    disabled={downloadsPage === 1}
                    onClick={() => setDownloadsPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </button>
                  <span style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 500 }}>
                    第 {downloadsPage} / {totalPages} 页
                  </span>
                  <button
                    type="button"
                    className="soft-button"
                    disabled={downloadsPage === totalPages}
                    onClick={() => setDownloadsPage((p) => Math.min(totalPages, p + 1))}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {activeView === 'settings' && (
        <section className="settings-grid">
          <div className="settings-card settings-core-card glass-panel">
            <h3><SettingsIcon size={18} /> 核心设置</h3>
            <div className="panel-field">
              <label>CORS 代理</label>
              <input className="panel-input" placeholder="留空使用内置代理（推荐）" value={tempProxy} onChange={(event) => setTempProxy(event.target.value)} />
            </div>
            <div className="panel-field" style={{ marginTop: '14px' }}>
              <label>本地下载目录</label>
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <input
                  className="panel-input"
                  style={{ flex: 1 }}
                  readOnly
                  value={downloadPath}
                  placeholder="获取下载路径中..."
                />
                <button
                  type="button"
                  className="soft-button"
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={handleSelectDownloadDir}
                >
                  更改目录
                </button>
                <button
                  type="button"
                  className="soft-button"
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={handleResetDownloadDir}
                >
                  恢复默认
                </button>
              </div>
              <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '6px', lineHeight: 1.4 }}>
                默认下载到当前应用的安装目录。
              </p>
            </div>
            <div className="panel-field" style={{ marginTop: '14px' }}>
              <label>安和昴 (486) 桌宠</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                <input
                  type="checkbox"
                  id="pet-toggle"
                  style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#fa233b' }}
                  checked={tempShowPet}
                  onChange={(event) => setTempShowPet(event.target.checked)}
                />
                <label htmlFor="pet-toggle" style={{ fontSize: '14px', cursor: 'pointer', userSelect: 'none', color: 'var(--text)' }}>启用桌面宠物</label>
              </div>
            </div>
            <div className="settings-save-row">
              <button type="button" className="primary-button" onClick={() => {
                setCorsProxy(tempProxy);
                localStorage.setItem('tunefree_desktop_show_pet', tempShowPet ? 'true' : 'false');
                window.dispatchEvent(new Event('tunefree_pet_toggle'));
                showMessage('设置已保存', 'success');
              }}>
                保存配置
              </button>
            </div>
          </div>

          <div className="settings-card settings-backup-card glass-panel">
            <span className="settings-card-icon"><UploadIcon size={22} /></span>
            <h3>数据备份</h3>
            <p>收藏与本地歌单都保存在浏览器本地；导出的 JSON 会包含版本号、导出时间、收藏列表和歌单列表。</p>
            <div className="backup-detail-list">
              <span>同一 localStorage key 可在桌面端与移动 PWA 间迁移</span>
              <span>导入前会先校验 JSON 并展示预览，不会静默覆盖现有数据</span>
            </div>
            {pendingImport && (
              <div className="import-preview-card">
                <strong>导入预览</strong>
                <p>当前：{favorites.length} 首收藏 / {playlists.length} 个歌单</p>
                <p>文件：{pendingImport.favoriteCount} 首收藏 / {pendingImport.playlistCount} 个歌单 / {pendingImport.playlistSongCount} 首歌单歌曲</p>
                <div className="panel-actions backup-actions">
                  <button type="button" className="primary-button" onClick={() => applyPendingImport('replace')}>覆盖导入</button>
                  <button type="button" className="soft-button" onClick={() => applyPendingImport('merge')}>合并导入</button>
                  <button type="button" className="soft-button" onClick={() => setPendingImport(null)}>取消</button>
                </div>
              </div>
            )}
            <div className="panel-actions backup-actions">
              <button type="button" className="soft-button" onClick={handleExport}>导出 JSON</button>
              <label className="soft-button">
                导入数据
                <input
                  type="file"
                  accept=".json"
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    handleFileImport(event.target.files?.[0]);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        </section>
      )}

      {activeView === 'about' && (
        <section className="about-grid about-grid-rich">
          <div className="about-card about-hero-card glass-panel">
            <div className="about-app-icon"><MusicIcon size={38} /></div>
            <div className="about-hero-copy">
              <h3>TuneFree Desktop</h3>
              <p>一个基于 Tauri v2 桌面容器的独立 music 播放器，保留多源聚合、无损音质、歌词解析和本地资料库，并使用 Rust 完全重构了后端 API 接口，内置安和昴（486）桌面宠物。</p>
              <div className="about-hero-actions">
                <span className="about-version">Tauri Desktop · v{appVersion}</span>
                <button
                  type="button"
                  className={`update-check-btn ${checkingUpdate || downloadingUpdate ? 'checking' : ''}`}
                  onClick={handleCheckUpdate}
                  disabled={checkingUpdate || downloadingUpdate}
                >
                  <RefreshIcon size={12} />
                  {downloadingUpdate ? `正在下载更新 (${updateDownloadProgress ?? 0}%)` : (checkingUpdate ? '正在检查...' : '检查更新')}
                </button>
              </div>
            </div>
          </div>

          <div className="about-content-grid">
            <div className="about-card about-feature-card glass-panel">
              <div className="about-card-heading">
                <InfoIcon size={30} />
                <h3>功能特性</h3>
              </div>
              <div className="about-feature-list">
                {[
                  ['多源聚合搜索', '支持网易云、QQ 音乐、酷我音乐，以及 JOOX / Bilibili 等 GD Studio 扩展音源。'],
                  ['TuneHub 解耦', '移除已关闭的 TuneHub / TuneFree API，搜索与播放不再依赖失效链路。'],
                  ['桌面级播放体验', '常驻底部迷你播放器、全屏播放器、播放队列、喜欢收藏、下载和音质切换。'],
                  ['稳定播放链路', '修复 URL 解析竞态、duration 同步、无音频 URL 清理和下一首预加载。'],
                  ['安和昴（486）桌宠', '左下角常驻、可拖动、保存位置，并按加载、播放、暂停和左右移动展示状态反馈，可在设置中关闭。'],
                  ['逐行滚动歌词', '支持 LRC 时间轴、双语歌词合并、点击歌词跳转，以及基于歌词内容的乐谱动画。'],
                  ['本地资料库', '收藏、歌单、JSON 备份导入导出均保存在浏览器本地。'],
                  ['实时频谱动画', '复用移动端 Web Audio + Canvas 频谱，在进度条区域显示动态波谱背景。'],
                  ['播放状态恢复', '当前歌曲、播放队列、播放模式和默认音质会在浏览器本地保存，刷新后仍能延续。'],
                  ['系统媒体控制', '接入 Media Session，支持系统层面的播放、暂停、上一首、下一首和进度跳转。'],
                ].map(([title, desc], index) => (
                  <div className="about-feature-item" key={title}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{title}</strong>
                      <p>{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="about-side-stack">
              <div className="about-card about-tech-card glass-panel">
                <div className="about-card-heading">
                  <SettingsIcon size={30} />
                  <h3>桌面端技术栈</h3>
                </div>
                <div className="about-tech-grid">
                  {desktopTechStack.map((tech) => (
                    <span className="about-tech-chip" key={tech.name}>
                      <span className="about-tech-icon">{tech.icon}</span>
                      <span>
                        <strong>{tech.name}</strong>
                        <em>{tech.detail}</em>
                      </span>
                    </span>
                  ))}
                </div>
                <p>桌面版使用 Tauri v2 构建并由 Next.js 静态导出，API 代理和解析接口使用 Rust (Axum) 重写，打包为轻量级原生桌面应用。</p>
              </div>

              <div className="about-card about-api-card glass-panel">
                <div className="about-card-heading">
                  <InfoIcon size={30} />
                  <h3>后端 API 与数据源</h3>
                </div>
                <p>网易云、QQ 音乐、酷我音乐使用 Rust 重构的本地接口，本地 Axum 服务启动在 3002 端口以处理网络代理与加解密请求。扩展源由 {GD_STUDIO_ATTRIBUTION} 提供。</p>
                <p>JOOX 扩展源建议控制频率：{GD_STUDIO_RATE_LIMIT_HINT}。歌词是否双语取决于上游返回字段，桌面端会自动合并 lyric / tlyric / trans / translation。</p>
                <div className="about-link-row">
                  <a href="https://music.gdstudio.xyz/" target="_blank" rel="noopener noreferrer"><ExternalLinkIcon size={13} /> GD 音乐台</a>
                </div>
              </div>
            </div>
          </div>

          <div className="about-link-grid">
            <a className="about-card glass-panel about-link-card" href="https://music.alanbulan.space/" target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon size={30} />
              <h3>在线演示</h3>
              <p>music.alanbulan.space</p>
            </a>
            <a className="about-card glass-panel about-link-card" href="https://github.com/alanbulan/musicxilan" target="_blank" rel="noopener noreferrer">
              <GithubIcon size={30} />
              <h3>GitHub 仓库</h3>
              <p>alanbulan/musicxilan</p>
            </a>
          </div>

          <div className="about-card about-notice-card glass-panel">
            <h3>声明</h3>
            <p>本项目仅供学习 React、Next.js 与现代前端工程实践使用。音乐资源来源于第三方 API，本项目不存储任何音频文件，请支持正版音乐。</p>
            <span>MIT License © 2026 TuneFree</span>
          </div>
        </section>
      )}
    </div>
  );
}
