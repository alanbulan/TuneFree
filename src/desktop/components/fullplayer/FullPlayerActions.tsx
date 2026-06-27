import { useState, type Dispatch, type SetStateAction } from 'react';
import {
  DownloadIcon,
  HeartFillIcon,
  HeartIcon,
  MoreIcon,
  PlusIcon,
  SearchIcon,
  ShareIcon,
} from '../../../core/components/Icons';
import { useLibrary } from '../../../core/contexts/LibraryContext';
import { usePlayerNowPlaying, usePlayerSettings } from '../../../core/contexts/PlayerContext';
import { downloadSongOffline } from '../../../core/services/offlineDownloads';
import { getSongKey, type AudioQuality } from '../../../core/types';
import { useSongDownload, qualityOptions, getDownloadMeta } from '../../hooks/useSongDownload';
import { useToast } from '../ToastHost';

interface FullPlayerActionsProps {
  showMorePanel: boolean;
  setShowMorePanel: Dispatch<SetStateAction<boolean>>;
  onSearch: (query: string) => void;
}

export default function FullPlayerActions({
  showMorePanel,
  setShowMorePanel,
  onSearch,
}: FullPlayerActionsProps) {
  const { currentSong } = usePlayerNowPlaying();
  const { audioQuality } = usePlayerSettings();
  const { toggleFavorite, isFavorite, playlists, addToPlaylist, createPlaylist } = useLibrary();
  const { showToast } = useToast();
  const { downloadQuality, downloadProgress, handleDownload } = useSongDownload();
  const [cachingOffline, setCachingOffline] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  const hasSong = !!currentSong;
  const favoriteActive = hasSong && isFavorite(currentSong.id, currentSong.source);
  const currentSongKey = currentSong ? getSongKey(currentSong) : '';
  const canCreatePlaylist = newPlaylistName.trim().length > 0;

  const handleToggleFavorite = () => {
    if (!currentSong) return;
    const wasFavorite = isFavorite(currentSong.id, currentSong.source);
    toggleFavorite(currentSong);
    showToast(wasFavorite ? '已取消收藏' : '已收藏歌曲', 'success', {
      label: '撤销',
      onClick: () => currentSong && toggleFavorite(currentSong),
    });
  };

  const handleOfflineCache = async () => {
    if (!currentSong || cachingOffline) return;
    setCachingOffline(true);
    try {
      const result = await downloadSongOffline(currentSong, audioQuality);
      if (result === 'exists') {
        showToast('该音质已在离线库中', 'info');
      } else {
        showToast('已缓存到离线库，播放时优先使用本地文件', 'success');
      }
    } catch {
      showToast('离线缓存失败，请稍后再试', 'error');
    } finally {
      setCachingOffline(false);
    }
  };

  const handleShare = async () => {
    if (!currentSong) return;
    const text = `我在 TuneFree 发现了一首好歌：${currentSong.artist} - ${currentSong.name}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: currentSong.name,
          text,
          url: window.location.origin,
        });
        showToast('已打开系统分享', 'success');
      } else {
        await navigator.clipboard.writeText(`${text} ${window.location.origin}`);
        showToast('已复制分享文案', 'success');
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name !== 'AbortError') {
        showToast('分享失败，请稍后再试', 'error');
      }
    }
  };

  const handleCreatePlaylist = () => {
    if (!currentSong || !canCreatePlaylist) return;
    createPlaylist(newPlaylistName.trim(), [currentSong]);
    showToast(`已创建「${newPlaylistName.trim()}」`, 'success');
    setNewPlaylistName('');
  };

  return (
    <>
      <div className="full-song-actions" aria-label="歌曲操作">
        <button
          type="button"
          className={`full-action-button ${favoriteActive ? 'active' : ''}`}
          disabled={!currentSong}
          onClick={handleToggleFavorite}
        >
          {favoriteActive ? <HeartFillIcon size={18} /> : <HeartIcon size={18} />}
          {favoriteActive ? '已喜欢' : '喜欢'}
        </button>
        <button
          type="button"
          className={`full-action-button ${showMorePanel ? 'active' : ''}`}
          disabled={!currentSong}
          onClick={() => setShowMorePanel((prev) => !prev)}
        >
          <MoreIcon size={18} />
          更多
        </button>
        <div className="download-action-group" aria-label="下载音质">
          <button
            type="button"
            className="full-action-button"
            disabled={!currentSong || cachingOffline}
            onClick={handleOfflineCache}
            title="缓存当前音质到离线库，播放时优先使用本地文件"
          >
            <DownloadIcon size={16} />
            {cachingOffline ? '缓存中' : '离线缓存'}
          </button>
          {qualityOptions.map((quality: AudioQuality) => {
            const meta = getDownloadMeta(quality);
            return (
              <button
                type="button"
                className="full-action-button"
                disabled={!currentSong || !!downloadQuality}
                onClick={() => currentSong && handleDownload(currentSong, quality)}
                key={quality}
              >
                <DownloadIcon size={16} />
                {downloadQuality === quality
                  ? downloadProgress !== null
                    ? `下载中 ${downloadProgress}%`
                    : '获取中'
                  : meta.label}
              </button>
            );
          })}
        </div>
      </div>
      {currentSong && showMorePanel ? (
        <div className="full-more-panel" aria-label="更多播放操作">
          <div className="full-more-row compact">
            <button type="button" className="full-more-button" onClick={handleShare}>
              <ShareIcon size={15} /> 分享
            </button>
            <button
              type="button"
              className="full-more-button"
              disabled={!currentSong.artist}
              onClick={() => onSearch(currentSong.artist)}
            >
              <SearchIcon size={15} /> 搜索歌手
            </button>
            <button
              type="button"
              className="full-more-button"
              disabled={!currentSong.album}
              onClick={() => onSearch(currentSong.album)}
            >
              <SearchIcon size={15} /> 搜索专辑
            </button>
          </div>
          <div className="full-more-playlist">
            <div className="full-more-title">添加到歌单</div>
            <div className="full-more-create">
              <input
                value={newPlaylistName}
                onChange={(event) => setNewPlaylistName(event.target.value)}
                placeholder="新建歌单"
              />
              <button type="button" disabled={!canCreatePlaylist} onClick={handleCreatePlaylist}>
                <PlusIcon size={14} /> 创建
              </button>
            </div>
            <div className="full-more-playlist-list">
              {playlists.length === 0 ? (
                <span className="full-more-empty">还没有歌单</span>
              ) : (
                playlists.slice(0, 6).map((playlist) => {
                  const added = playlist.songs.some(
                    (song) => getSongKey(song) === currentSongKey,
                  );
                  return (
                    <button
                      type="button"
                      key={playlist.id}
                      className="full-more-playlist-button"
                      onClick={() => addToPlaylist(playlist.id, currentSong)}
                    >
                      <span>{playlist.name}</span>
                      <em>{added ? '已添加' : `${playlist.songs.length} 首`}</em>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
