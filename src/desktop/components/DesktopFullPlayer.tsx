import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import AudioVisualizer from '../../core/components/AudioVisualizer';
import {
  CloseIcon,
  DownloadIcon,
  HeartFillIcon,
  HeartIcon,
  MusicIcon,
  MoreIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  PlusIcon,
  RepeatOneIcon,
  SearchIcon,
  ShareIcon,
  ShuffleIcon,
  TrashIcon,
} from '../../core/components/Icons';
import { useLibrary } from '../../core/contexts/LibraryContext';
import {
  usePlayerActions,
  usePlayerNowPlaying,
  usePlayerProgress,
  usePlayerQueueState,
  usePlayerSettings,
} from '../../core/contexts/PlayerContext';
import { getSongUrl, triggerDownload } from '../../core/services/api';
import { downloadSongOffline } from '../../core/services/offlineDownloads';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AudioQuality } from '../../core/types';
import { findActiveLyricIndex, LYRIC_DISPLAY_LEAD_SECONDS, parseLyrics } from '../../core/utils/lyrics';
import { getSongKey, isSameSong } from '../../core/types';
import CoverArt from './CoverArt';
import { useToast } from './ToastHost';
import VirtualList from './VirtualList';

interface DesktopFullPlayerProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (query: string) => void;
}

type CoverPanelStyle = CSSProperties & {
  '--full-cover-bg'?: string;
};

type OffsetStyle = CSSProperties & {
  '--lyric-offset'?: number;
};

type NoteStyle = CSSProperties & {
  '--note-delay'?: string;
  '--note-duration'?: string;
  '--note-drift'?: string;
};

const noteGlyphs = ['♪', '♫', '♩', '♬', '♭', '♯'];

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
};

const buildScoreNotes = (text: string, currentTime: number) => {
  const chars = Array.from(text.replace(/\s+/g, ''));
  const source = chars.length > 0 ? chars : Array.from('TuneFree');
  const count = Math.min(18, Math.max(10, source.length + 4));

  return Array.from({ length: count }, (_, index) => {
    const char = source[index % source.length] || '♪';
    const code = char.codePointAt(0) || 0;
    const duration = 3.4 + (code % 7) * 0.18;

    return {
      glyph: noteGlyphs[(code + index) % noteGlyphs.length],
      top: 18 + ((code + index * 13) % 62),
      left: count === 1 ? 50 : 6 + index * (88 / (count - 1)),
      delay: -((currentTime * 0.38 + index * 0.23) % duration),
      duration,
      drift: ((code % 9) - 4) * 2,
    };
  });
};

const qualityOptions: AudioQuality[] = ['128k', '320k', 'flac', 'flac24bit'];

const downloadMeta: Record<string, { label: string; ext: string }> = {
  '128k': { label: '128K', ext: 'mp3' },
  '320k': { label: '320K', ext: 'mp3' },
  flac: { label: 'FLAC', ext: 'flac' },
  flac24bit: { label: 'Hi-Res', ext: 'flac' },
};

const playModeLabel = {
  sequence: '列表循环',
  loop: '单曲循环',
  shuffle: '随机播放',
};

export default function DesktopFullPlayer({ isOpen, onClose, onSearch }: DesktopFullPlayerProps) {
  const { currentSong, isPlaying, isLoading } = usePlayerNowPlaying();
  const { currentTime, duration } = usePlayerProgress();
  const { queue, playMode } = usePlayerQueueState();
  const { audioQuality } = usePlayerSettings();
  const { toggleFavorite, isFavorite, playlists, addToPlaylist, createPlaylist } = useLibrary();
  const { showToast } = useToast();
  const [downloadQuality, setDownloadQuality] = useState<AudioQuality | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [cachingOffline, setCachingOffline] = useState(false);

  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
    if (!isTauri) return;

    const unlistenPromise = listen<{ url: string; progress: number }>('download-progress', (event) => {
      setDownloadProgress(event.payload.progress);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
  const [showMorePanel, setShowMorePanel] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const lyricListRef = useRef<HTMLDivElement>(null);
  const lyricScrollKeyRef = useRef('');
  const {
    playSong,
    playQueue,
    clearQueue,
    removeFromQueue,
    togglePlay,
    playNext,
    playPrev,
    seek,
    togglePlayMode,
    setAudioQuality,
  } = usePlayerActions();
  const modeIcon = playMode === 'shuffle' ? <ShuffleIcon size={17} /> : playMode === 'loop' ? <RepeatOneIcon size={17} /> : <RepeatIcon size={17} />;
  const rawLyrics = currentSong?.lrc;
  const lyricRows = useMemo(() => parseLyrics(rawLyrics), [rawLyrics]);
  const activeLyricIndex = findActiveLyricIndex(lyricRows, currentTime);
  const activeLyric = activeLyricIndex >= 0 ? lyricRows[activeLyricIndex] : null;
  const lyricWindow = lyricRows.map((row, index) => ({ row, index }));
  const scoreText = activeLyric?.text || currentSong?.name || 'TuneFree Desktop';
  const scoreNotes = useMemo(() => buildScoreNotes(scoreText, currentTime), [currentTime, scoreText]);
  const panelStyle = currentSong?.pic
    ? ({ '--full-cover-bg': `url(${JSON.stringify(currentSong.pic)})` } as CoverPanelStyle)
    : undefined;
  const hasSong = !!currentSong;
  const lyricsLoading = isLoading && hasSong && !rawLyrics;
  const favoriteActive = hasSong && isFavorite(currentSong.id, currentSong.source);
  const currentSongKey = currentSong ? getSongKey(currentSong) : '';
  const canCreatePlaylist = newPlaylistName.trim().length > 0;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);


  useEffect(() => {
    if (!isOpen) {
      lyricScrollKeyRef.current = '';
      return;
    }
    if (!lyricListRef.current || activeLyricIndex < 0 || lyricRows.length === 0) return;

    const container = lyricListRef.current;
    const songKey = currentSong ? `${currentSong.source}:${currentSong.id}` : '';
    const scrollKey = `${songKey}:${lyricRows.length}:${rawLyrics?.length || 0}`;
    const isInitialScroll = lyricScrollKeyRef.current !== scrollKey;
    lyricScrollKeyRef.current = scrollKey;

    const scrollActiveLyric = (behavior: ScrollBehavior) => {
      const activeEl = container.querySelector<HTMLElement>('[data-active="true"]');
      if (!activeEl) return;

      const containerRect = container.getBoundingClientRect();
      const activeRect = activeEl.getBoundingClientRect();
      const top = container.scrollTop + activeRect.top - containerRect.top - container.clientHeight / 2 + activeRect.height / 2;

      container.scrollTo({
        top,
        behavior,
      });
    };

    let frame = 0;
    let secondFrame = 0;
    let timeout = 0;
    const behavior: ScrollBehavior = 'auto';

    frame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => scrollActiveLyric(behavior));
    });

    if (isInitialScroll) {
      timeout = window.setTimeout(() => scrollActiveLyric('auto'), 380);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(secondFrame);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [activeLyricIndex, lyricRows, rawLyrics, isOpen, currentSong?.id, currentSong?.source]);

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

  const handleDownload = async (quality: AudioQuality) => {
    if (!currentSong || downloadQuality) return;

    setDownloadQuality(quality);
    setDownloadProgress(0);
    try {
      const url = await getSongUrl(currentSong.id, currentSong.source, quality, currentSong);
      if (!url) {
        showToast('无法获取下载地址', 'error');
        setDownloadProgress(null);
        return;
      }

      const meta = downloadMeta[quality] || { label: quality.toUpperCase(), ext: 'mp3' };
      const filename = `${currentSong.artist} - ${currentSong.name}.${meta.ext}`;

      const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;

      if (isTauri) {
        const customDir = localStorage.getItem('tunefree_download_dir') || null;
        await invoke('download_song_to_local', { url, filename, customDir });
        try {
          await downloadSongOffline(currentSong, quality);
        } catch (e) {
          console.error("写入离线库失败", e);
        }
        showToast('下载成功，已保存至本地下载目录并加入离线库', 'success');
      } else {
        triggerDownload(url, filename);
        try {
          await downloadSongOffline(currentSong, quality);
        } catch (e) {
          console.error("写入离线库失败", e);
        }
        showToast('已开始下载并加入离线库', 'success');
      }
    } catch (err: any) {
      showToast(err?.message || err || '下载失败，请稍后再试', 'error');
    } finally {
      setDownloadQuality(null);
      setDownloadProgress(null);
    }
  };

  const handleToggleFavorite = () => {
    if (!currentSong) return;
    const wasFavorite = isFavorite(currentSong.id, currentSong.source);
    toggleFavorite(currentSong);
    showToast(wasFavorite ? '已取消收藏' : '已收藏歌曲', 'success', {
      label: '撤销',
      onClick: () => currentSong && toggleFavorite(currentSong),
    });
  };

  const handleShare = async () => {
    if (!currentSong) return;

    const text = `我在 TuneFree 发现了一首好歌：${currentSong.artist} - ${currentSong.name}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: currentSong.name, text, url: window.location.origin });
        showToast('已打开系统分享', 'success');
      } else {
        await navigator.clipboard.writeText(`${text} ${window.location.origin}`);
        showToast('已复制分享文案', 'success');
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') showToast('分享失败，请稍后再试', 'error');
    }
  };

  const handleCreatePlaylist = () => {
    if (!currentSong || !canCreatePlaylist) return;
    createPlaylist(newPlaylistName.trim(), [currentSong]);
    showToast(`已创建「${newPlaylistName.trim()}」`, 'success');
    setNewPlaylistName('');
  };

  const handleClearQueue = () => {
    const previousQueue = queue;
    if (previousQueue.length <= (currentSong ? 1 : 0)) {
      showToast('没有待播歌曲需要清空', 'info');
      return;
    }
    clearQueue();
    showToast('已清空待播队列', 'success', {
      label: '撤销',
      onClick: () => void playQueue(previousQueue, currentSong || previousQueue[0]),
    });
  };

  const handleRemoveFromQueue = (songId: string | number, source?: string) => {
    const previousQueue = queue;
    const previousSong = currentSong;
    removeFromQueue(songId, source);
    showToast('已从队列移除', 'success', {
      label: '撤销',
      onClick: () => void playQueue(previousQueue, previousSong || previousQueue[0]),
    });
  };

  return (
    <motion.div 
      className="full-player-layer open"
      initial="hidden"
      animate="visible"
      exit="exit"
      style={{ overflow: 'hidden' }}
    >
      <motion.div 
        className="full-player-backdrop" 
        onClick={onClose}
        initial={{ opacity: 0, backdropFilter: 'blur(0px)', WebkitBackdropFilter: 'blur(0px)' }}
        animate={{ opacity: 1, backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}
        exit={{ opacity: 0, backdropFilter: 'blur(0px)', WebkitBackdropFilter: 'blur(0px)' }}
        transition={{ duration: 0.35, ease: 'easeInOut' }}
        style={{ transition: 'none' }}
      />
      <motion.section
        className={`full-player-panel ${currentSong?.pic ? 'has-cover-bg' : ''} ${isPlaying ? 'is-playing' : ''}`}
        style={{ ...panelStyle, transition: 'none' }}
        role="dialog"
        aria-modal="true"
        aria-label="全屏播放器"
        variants={{
          hidden: { y: '100dvh', opacity: 0.9, scale: 0.96 },
          visible: { y: 0, opacity: 1, scale: 1 },
          exit: { y: '100dvh', opacity: 0.9, scale: 0.96 }
        }}
        transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
      >
        <button type="button" className="full-close-button" aria-label="收起播放器" onClick={onClose}>
          <CloseIcon size={20} />
        </button>

        <div className="full-player-art">
          <CoverArt
            src={currentSong?.pic}
            alt={currentSong?.name || '当前播放'}
            className={`full-cover-art spinning-cover ${isPlaying ? 'is-rotating' : ''}`}
            iconSize={64}
          />
          <div className="full-song-meta" style={{ position: 'relative', minHeight: '80px', overflow: 'hidden' }}>
            <AnimatePresence mode="popLayout">
              <motion.div
                key={currentSong?.id || 'none'}
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -12, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                style={{ width: '100%' }}
              >
                <h2>{currentSong?.name || '未在播放'}</h2>
                <p>{currentSong?.artist || '从排行榜、搜索或资料库中选择音乐'}</p>
              </motion.div>
            </AnimatePresence>
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
                {qualityOptions.map((quality) => {
                  const meta = downloadMeta[quality];
                  return (
                    <button
                      type="button"
                      className="full-action-button"
                      disabled={!currentSong || !!downloadQuality}
                      onClick={() => handleDownload(quality)}
                      key={quality}
                    >
                      <DownloadIcon size={16} />
                      {downloadQuality === quality ? (
                        downloadProgress !== null ? `下载中 ${downloadProgress}%` : '获取中'
                      ) : meta.label}
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
                  <button type="button" className="full-more-button" disabled={!currentSong.artist} onClick={() => onSearch(currentSong.artist)}>
                    <SearchIcon size={15} /> 搜索歌手
                  </button>
                  <button type="button" className="full-more-button" disabled={!currentSong.album} onClick={() => onSearch(currentSong.album)}>
                    <SearchIcon size={15} /> 搜索专辑
                  </button>
                </div>
                <div className="full-more-playlist">
                  <div className="full-more-title">添加到歌单</div>
                  <div className="full-more-create">
                    <input value={newPlaylistName} onChange={(event) => setNewPlaylistName(event.target.value)} placeholder="新建歌单" />
                    <button type="button" disabled={!canCreatePlaylist} onClick={handleCreatePlaylist}>
                      <PlusIcon size={14} /> 创建
                    </button>
                  </div>
                  <div className="full-more-playlist-list">
                    {playlists.length === 0 ? (
                      <span className="full-more-empty">还没有歌单</span>
                    ) : playlists.slice(0, 6).map((playlist) => {
                      const added = playlist.songs.some((song) => getSongKey(song) === currentSongKey);
                      return (
                        <button type="button" key={playlist.id} className="full-more-playlist-button" onClick={() => addToPlaylist(playlist.id, currentSong)}>
                          <span>{playlist.name}</span>
                          <em>{added ? '已添加' : `${playlist.songs.length} 首`}</em>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="full-lyrics-stage">
          <div className="lyric-orbit" aria-hidden="true" />
          <div className="lyric-score" aria-hidden="true">
            <div className="score-staff">
              {Array.from({ length: 5 }).map((_, index) => <span key={index} />)}
            </div>
            {scoreNotes.map((note, index) => {
              const style = {
                top: `${note.top}%`,
                left: `${note.left}%`,
                '--note-delay': `${note.delay.toFixed(2)}s`,
                '--note-duration': `${note.duration.toFixed(2)}s`,
                '--note-drift': `${note.drift}px`,
              } as NoteStyle;

              return (
                <span className="score-note" style={style} key={`${note.glyph}-${index}`}>
                  {note.glyph}
                </span>
              );
            })}
          </div>
          <div className="full-lyrics-content" style={{ position: 'relative', overflow: 'hidden' }}>
            <AnimatePresence mode="wait">
              {lyricWindow.length > 0 ? (
                <motion.div
                  ref={lyricListRef}
                  key={`lyrics-${currentSong?.id || 'none'}`}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
                  className="lyric-scroll lyric-scrollable"
                  aria-live="polite"
                  style={{ width: '100%', height: '100%' }}
                >
                  {lyricWindow.map(({ row, index }) => {
                    const offset = index - activeLyricIndex;
                    const style = { '--lyric-offset': offset } as OffsetStyle;
                    return (
                      <button
                        type="button"
                        className={`lyric-line ${offset === 0 ? 'active' : ''} ${Math.abs(offset) > 2 ? 'dim' : ''}`}
                        style={style}
                        key={`${row.time}-${row.text}`}
                        data-active={offset === 0 ? 'true' : undefined}
                        onClick={() => seek(Math.max(0, row.time - LYRIC_DISPLAY_LEAD_SECONDS))}
                      >
                        <span>{row.text}</span>
                        {row.translation ? <em>{row.translation}</em> : null}
                      </button>
                    );
                  })}
                </motion.div>
              ) : (
                <motion.div
                  key={`empty-${lyricsLoading ? 'loading' : 'idle'}-${currentSong?.id || 'none'}`}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
                  className="lyric-scroll lyric-empty"
                  aria-live="polite"
                  style={{ width: '100%', height: '100%', display: 'grid', justifyItems: 'center', alignContent: 'center', gap: '16px' }}
                >
                  {lyricsLoading ? <span className="lyric-loading-dot" /> : <MusicIcon size={30} />}
                  <p className="lyric-line active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                    <span>{lyricsLoading ? '加载歌词中...' : currentSong?.name || 'TuneFree Desktop'}</span>
                    <em>{lyricsLoading ? currentSong?.name || '' : currentSong?.artist || '选择一首音乐开始'}</em>
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <aside className="full-queue-card">
          <div className="queue-now-card">
            <CoverArt src={currentSong?.pic} alt={currentSong?.name || '当前播放'} className="queue-now-cover" iconSize={26} />
            <div className="queue-now-meta">
              <p>正在播放</p>
              <h3>{currentSong?.name || '未在播放'}</h3>
              <span>{currentSong?.artist || '选择一首音乐开始'}</span>
            </div>
          </div>
          <div className="queue-header">
            <div>
              <h3 className="panel-title"><QueueIcon size={18} /> 播放队列</h3>
              <button type="button" className="queue-mode-chip" onClick={togglePlayMode}>{playModeLabel[playMode]}</button>
            </div>
            <button type="button" className="icon-button" aria-label="清空待播队列" title="清空待播队列" onClick={handleClearQueue}>
              <TrashIcon size={16} />
            </button>
          </div>
          <div className="queue-list full-queue-list">
            {queue.length === 0 ? (
              <div className="empty-state">
                <p>队列还是空的。播放任意歌曲后，这里会显示接下来的音乐。</p>
              </div>
            ) : (
              <VirtualList
                items={queue}
                itemHeight={60}
                fillParent
                className="queue-virtual-list"
                getKey={(song, index) => `${song.source}-${song.id}-${index}`}
                renderItem={(song, index, style) => {
                  const active = isSameSong(currentSong, song);
                  return (
                    <div className={`queue-item ${active ? 'active' : ''}`} key={`${song.source}-${song.id}-${index}`} style={style}>
                      <button type="button" className="queue-play-button" onClick={() => playSong(song)} aria-label={`播放 ${song.name}`}>
                        <span className="queue-number">{active ? '▶' : index + 1}</span>
                        <CoverArt src={song.pic} alt={song.name || '队列歌曲'} className="queue-cover" iconSize={15} />
                        <span className="queue-song-meta">
                          <span className="queue-title">{song.name}</span>
                          <span className="queue-artist">{song.artist || '未知歌手'}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="table-action"
                        aria-label="从队列移除"
                        onClick={() => handleRemoveFromQueue(song.id, song.source)}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </div>
                  );
                }}
              />
            )}
          </div>
        </aside>

        <div className="full-player-controls">
          <div className="transport-wave-bg" aria-hidden="true">
            <AudioVisualizer isPlaying={isPlaying} />
          </div>
          <div className="transport-main">
            <CoverArt
              src={currentSong?.pic}
              alt={currentSong?.name || 'TuneFree'}
              className={`transport-cover spinning-cover ${isPlaying ? 'is-rotating' : ''}`}
              iconSize={20}
            />
            <div className="transport-info">
              <div className="transport-title">{currentSong?.name || '选择一首音乐开始'}</div>
              <div className="transport-artist">{currentSong?.artist || 'TuneFree Desktop'}</div>
            </div>
          </div>
          <div className="transport-center">
            <div className="transport-controls">
              <button type="button" className="control-button" aria-label="上一首" onClick={() => playPrev()}>
                <PrevIcon size={19} />
              </button>
              <button type="button" className="control-button primary" aria-label="播放或暂停" onClick={() => togglePlay()} disabled={!currentSong && !isPlaying}>
                {isLoading ? <span>…</span> : isPlaying ? <PauseIcon size={23} /> : <PlayIcon size={23} />}
              </button>
              <button type="button" className="control-button" aria-label="下一首" onClick={() => playNext(true)}>
                <NextIcon size={19} />
              </button>
            </div>
            <div className="progress-row">
              <span>{formatTime(currentTime)}</span>
              <input
                className="progress-bar"
                aria-label="播放进度"
                type="range"
                min={0}
                max={duration || 0}
                value={duration ? Math.min(currentTime, duration) : 0}
                onChange={(event) => seek(Number(event.target.value))}
              />
              <span>{formatTime(duration)}</span>
            </div>
          </div>
          <div className="transport-tools">
            <button
              type="button"
              className={`icon-button transport-like-button ${favoriteActive ? 'active' : ''}`}
              aria-label={favoriteActive ? '取消喜欢' : '喜欢当前歌曲'}
              disabled={!currentSong}
              onClick={handleToggleFavorite}
            >
              {favoriteActive ? <HeartFillIcon size={16} /> : <HeartIcon size={16} />}
            </button>
            <button type="button" className="icon-button" aria-label="切换播放模式" onClick={togglePlayMode}>
              {modeIcon}
            </button>
            {qualityOptions.map((quality) => (
              <button
                key={quality}
                type="button"
                className={`quality-button ${audioQuality === quality ? 'active' : ''}`}
                aria-pressed={audioQuality === quality}
                onClick={() => setAudioQuality(quality)}
              >
                {quality === 'flac24bit' ? 'Hi-Res' : quality.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}
