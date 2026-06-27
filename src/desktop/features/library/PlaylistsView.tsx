import { useMemo, useState } from 'react';
import {
  ExternalLinkIcon,
  FolderIcon,
  PlusIcon,
} from '../../../core/components/Icons';
import { useLibrary } from '../../../core/contexts/LibraryContext';
import { usePlayerActions, usePlayerNowPlaying } from '../../../core/contexts/PlayerContext';
import { useToast } from '../../components/ToastHost';
import {
  importPlaylist,
  getPlaylistImportErrorMessage,
  PLAYLIST_IMPORT_SOURCES,
} from '../../../core/services/playlistImport';
import { getImgReferrerPolicy } from '../../../core/services/utils';
import SongTable from '../../components/SongTable';
import CustomSelect from './components/CustomSelect';
import type { Playlist, Song } from '../../../core/types';

export default function PlaylistsView() {
  const {
    playlists,
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    removeFromPlaylist,
    isFavorite,
    toggleFavorite,
  } = useLibrary();
  const { playQueue } = usePlayerActions();
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { showToast } = useToast();

  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [importSource, setImportSource] = useState<string>(PLAYLIST_IMPORT_SOURCES[0].value);
  const [importInput, setImportInput] = useState('');
  const [isImportingPlaylist, setIsImportingPlaylist] = useState(false);

  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedPlaylistId) || null,
    [playlists, selectedPlaylistId],
  );

  const handleFavorite = (song: Song) => {
    const wasFavorite = isFavorite(song.id, song.source);
    toggleFavorite(song);
    showToast(wasFavorite ? '已取消收藏' : '已收藏歌曲', 'success', {
      label: '撤销',
      onClick: () => toggleFavorite(song),
    });
  };

  const handleCreatePlaylist = () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    createPlaylist(name);
    setNewPlaylistName('');
    showToast(`已创建「${name}」`, 'success');
  };

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

  const renderPlaylistSongs = (playlist: Playlist) => (
    <div>
      <button type="button" className="soft-button" onClick={() => setSelectedPlaylistId(null)}>
        ← 返回歌单列表
      </button>
      <div className="content-card glass-panel" style={{ margin: '14px 0' }}>
        <div className="panel-label-row">
          <div>
            <p className="eyebrow">Playlist</p>
            <h2 className="section-title">{playlist.name}</h2>
            <p>{playlist.songs.length} 首歌曲</p>
          </div>
          <div className="inline-actions">
            {playlist.id !== 'favorites' && (
              <>
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
              </>
            )}
          </div>
        </div>
      </div>
      <SongTable
        songs={playlist.songs}
        currentSong={currentSong}
        isPlaying={isPlaying}
        emptyText="这个歌单还没有歌曲"
        actionLabel="操作"
        onPlay={(song: Song) => void playQueue(playlist.songs, song)}
        onFavorite={handleFavorite}
        isFavorite={(song: Song) => isFavorite(song.id, song.source)}
        onDelete={(song: Song) => removeFromPlaylist(playlist.id, song.id, song.source)}
        deleteLabel="从歌单移除"
      />
    </div>
  );

  if (selectedPlaylist) {
    return <>{renderPlaylistSongs(selectedPlaylist)}</>;
  }

  return (
    <section className="playlist-grid">
      <div className="create-card playlist-action-card">
        <div className="playlist-action-card-body">
          <span className="playlist-card-icon">
            <PlusIcon size={36} />
          </span>
          <div className="playlist-action-copy">
            <p className="eyebrow">Create</p>
            <h3>新建歌单</h3>
            <p>从空白歌单开始整理收藏，适合按场景或心情归类。</p>
          </div>
          <div className="panel-field playlist-panel-field">
            <input
              className="panel-input"
              value={newPlaylistName}
              onChange={(event) => setNewPlaylistName(event.target.value)}
              placeholder="歌单名称"
            />
          </div>
          <button
            type="button"
            className="primary-button playlist-card-button"
            onClick={handleCreatePlaylist}
          >
            创建
          </button>
        </div>
      </div>

      <div className="create-card playlist-action-card">
        <div className="playlist-action-card-body">
          <span className="playlist-card-icon">
            <ExternalLinkIcon size={36} />
          </span>
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

      {playlists.map((playlist) => {
        const coverUrl = playlist.songs[0]?.pic;
        return (
          <button
            type="button"
            className={`library-card ${coverUrl ? 'has-cover' : ''}`}
            key={playlist.id}
            onClick={() => setSelectedPlaylistId(playlist.id)}
            style={
              coverUrl
                ? {
                    position: 'relative',
                    overflow: 'hidden',
                    color: '#ffffff',
                    border: 'none',
                    minHeight: '270px',
                  }
                : undefined
            }
          >
            {coverUrl && (
              <>
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundImage: `url(${coverUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    filter: 'blur(15px) brightness(0.65)',
                    transform: 'scale(1.15)',
                    zIndex: 1,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.4))',
                    zIndex: 2,
                  }}
                />
              </>
            )}

            <div
              style={
                coverUrl
                  ? {
                      position: 'relative',
                      zIndex: 3,
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      flex: 1,
                    }
                  : {
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      flex: 1,
                    }
              }
            >
              {coverUrl ? (
                <div
                  style={{
                    width: '100%',
                    paddingTop: '100%',
                    position: 'relative',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    boxShadow: '0 8px 16px rgba(0,0,0,0.3)',
                    marginBottom: 8,
                  }}
                >
                  <img
                    src={coverUrl}
                    alt={playlist.name}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                    referrerPolicy={getImgReferrerPolicy(coverUrl)}
                  />
                </div>
              ) : (
                <span style={{ marginBottom: 22, display: 'inline-flex' }}>
                  <FolderIcon size={34} className="muted-text" />
                </span>
              )}
              <h3
                style={
                  coverUrl
                    ? {
                        color: '#ffffff',
                        fontSize: '15px',
                        fontWeight: 'bold',
                        margin: '4px 0 0 0',
                        textShadow: '0 1px 3px rgba(0,0,0,0.6)',
                      }
                    : undefined
                }
              >
                {playlist.name || '未命名歌单'}
              </h3>
              <p
                style={
                  coverUrl
                    ? {
                        color: 'rgba(255,255,255,0.75)',
                        fontSize: '11px',
                        margin: 0,
                        textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                      }
                    : undefined
                }
              >
                {playlist.songs.length} 首歌曲
              </p>
              <div className="library-card-meta" style={coverUrl ? { marginTop: 'auto' } : undefined}>
                <span
                  className="source-badge"
                  style={
                    coverUrl
                      ? {
                          backgroundColor: 'rgba(255,255,255,0.2)',
                          color: '#ffffff',
                          backdropFilter: 'blur(4px)',
                        }
                      : undefined
                  }
                >
                  本地
                </span>
                <span className="muted-text" style={coverUrl ? { color: 'rgba(255,255,255,0.9)' } : undefined}>
                  打开
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </section>
  );
}
