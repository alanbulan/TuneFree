import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DownloadIcon,
  HeartFillIcon,
  HeartIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
} from '../../core/components/Icons';
import { useLibrary } from '../../core/contexts/LibraryContext';
import {
  usePlayerActions,
  usePlayerNowPlaying,
  usePlayerProgress,
  usePlayerQueueState,
  usePlayerSettings,
} from '../../core/contexts/PlayerContext';
import { useTheme } from '../../core/contexts/ThemeContext';
import { Lock } from 'lucide-react';
import AudioVisualizer from '../../core/components/AudioVisualizer';
import { getLyrics, getSongUrl, triggerDownload } from '../../core/services/api';
import { downloadSongOffline } from '../../core/services/offlineDownloads';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AudioQuality } from '../../core/types';
import { findActiveLyricIndex, hasTranslatedLyrics, parseLyrics, supportsTranslatedLyricFallback } from '../../core/utils/lyrics';
import CoverArt from './CoverArt';
import { useToast } from './ToastHost';

interface DesktopTransportProps {
  onExpand: () => void;
}

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
};

const qualityOptions: AudioQuality[] = ['128k', '320k', 'flac', 'flac24bit'];
const downloadMeta: Record<string, { ext: string }> = {
  '128k': { ext: 'mp3' },
  '320k': { ext: 'mp3' },
  flac: { ext: 'flac' },
  flac24bit: { ext: 'flac' },
};

export default function DesktopTransport({ onExpand }: DesktopTransportProps) {
  const { currentSong, isPlaying, isLoading } = usePlayerNowPlaying();
  const { showDesktopLyric, setShowDesktopLyric, lockDesktopLyric, setLockDesktopLyric } = useTheme();
  const { currentTime, duration } = usePlayerProgress();
  const { playMode } = usePlayerQueueState();
  const { audioQuality } = usePlayerSettings();
  const { toggleFavorite, isFavorite } = useLibrary();
  const { togglePlay, playNext, playPrev, seek, togglePlayMode, setAudioQuality } = usePlayerActions();
  const { showToast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [lyricsOverride, setLyricsOverride] = useState('');

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

  const rawLyrics = lyricsOverride || currentSong?.lrc;
  const lyricRows = useMemo(() => parseLyrics(rawLyrics), [rawLyrics]);
  const activeLyricIndex = findActiveLyricIndex(lyricRows, currentTime);
  const activeLyric = activeLyricIndex >= 0 ? lyricRows[activeLyricIndex] : null;
  const favoriteActive = !!currentSong && isFavorite(currentSong.id, currentSong.source);
  const modeIcon = playMode === 'shuffle' ? <ShuffleIcon size={17} /> : playMode === 'loop' ? <RepeatOneIcon size={17} /> : <RepeatIcon size={17} />;

  useEffect(() => {
    setLyricsOverride('');
  }, [currentSong?.id, currentSong?.source]);

  useEffect(() => {
    if (!currentSong || lyricsOverride || !supportsTranslatedLyricFallback(currentSong.source)) return;

    const currentRows = parseLyrics(currentSong.lrc);
    if (hasTranslatedLyrics(currentRows)) return;

    let cancelled = false;
    getLyrics(currentSong.id, currentSong.source).then((lrc) => {
      if (!cancelled && lrc && lrc !== currentSong.lrc && hasTranslatedLyrics(parseLyrics(lrc))) {
        setLyricsOverride(lrc);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [currentSong, lyricsOverride]);

  const handleToggleFavorite = () => {
    if (!currentSong) return;
    const wasFavorite = isFavorite(currentSong.id, currentSong.source);
    toggleFavorite(currentSong);
    showToast(wasFavorite ? '已取消收藏' : '已收藏歌曲', 'success', {
      label: '撤销',
      onClick: () => currentSong && toggleFavorite(currentSong),
    });
  };

  const handleDownload = async () => {
    if (!currentSong || downloading) return;

    setDownloading(true);
    setDownloadProgress(0);
    try {
      const url = await getSongUrl(currentSong.id, currentSong.source, audioQuality, currentSong);
      if (!url) {
        showToast('无法获取下载地址', 'error');
        setDownloadProgress(null);
        return;
      }

      const meta = downloadMeta[audioQuality] || { ext: 'mp3' };
      const filename = `${currentSong.artist} - ${currentSong.name}.${meta.ext}`;

      const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;

      if (isTauri) {
        const customDir = localStorage.getItem('tunefree_download_dir') || null;
        await invoke('download_song_to_local', { url, filename, customDir });
        try {
          await downloadSongOffline(currentSong, audioQuality);
        } catch (e) {
          console.error("写入离线库失败", e);
        }
        showToast('下载成功，已保存至本地下载目录并加入离线库', 'success');
      } else {
        triggerDownload(url, filename);
        try {
          await downloadSongOffline(currentSong, audioQuality);
        } catch (e) {
          console.error("写入离线库失败", e);
        }
        showToast('已开始下载并加入离线库', 'success');
      }
    } catch (err: any) {
      showToast(err?.message || err || '下载失败，请稍后再试', 'error');
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
    }
  };

  return (
    <div className="transport mini-player">
      <div className="transport-wave-bg mini-wave-bg" aria-hidden="true">
        <AudioVisualizer isPlaying={isPlaying} />
      </div>

      <button type="button" className="transport-main mini-player-summary" onClick={onExpand} aria-label="打开全屏播放器">
        <CoverArt
          src={currentSong?.pic}
          alt={currentSong?.name || 'TuneFree'}
          className={`transport-cover spinning-cover ${isPlaying ? 'is-rotating' : ''}`}
          iconSize={20}
        />
        <span className="transport-info">
          <span className="transport-title">{currentSong?.name || '选择一首音乐开始'}</span>
          <span className="transport-artist">{currentSong?.artist || 'TuneFree Desktop'}</span>
        </span>
      </button>

      <div className="transport-center">
        <button 
          type="button" 
          className="transport-mini-lyric" 
          onClick={onExpand} 
          aria-label="打开全屏歌词"
          style={{ position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
        >
          <AnimatePresence mode="popLayout">
            <motion.div
              key={activeLyric?.text || currentSong?.name || 'empty'}
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', pointerEvents: 'none' }}
            >
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '90%' }}>
                {activeLyric?.text || currentSong?.name || 'TuneFree Desktop'}
              </span>
              {activeLyric?.translation ? (
                <em style={{ fontSize: '11px', fontStyle: 'normal', opacity: 0.65, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '90%' }}>
                  {activeLyric.translation}
                </em>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </button>
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
        <button
          type="button"
          className="icon-button"
          aria-label="下载当前歌曲"
          disabled={!currentSong || downloading}
          onClick={handleDownload}
          style={{ minWidth: '28px' }}
        >
          {downloading ? (
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent)' }}>
              {downloadProgress !== null ? `${downloadProgress}%` : '…'}
            </span>
          ) : (
            <DownloadIcon size={16} />
          )}
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
        <button
          type="button"
          className={`lyric-toggle-btn ${showDesktopLyric ? 'active' : ''}`}
          title="左击：开/关桌面歌词&#10;右击：锁/开鼠标穿透"
          aria-label="桌面歌词"
          onClick={() => setShowDesktopLyric(!showDesktopLyric)}
          onContextMenu={(e) => {
            e.preventDefault();
            const nextLock = !lockDesktopLyric;
            setLockDesktopLyric(nextLock);
            showToast(nextLock ? '桌面歌词已锁定（鼠标穿透）' : '桌面歌词已解锁', 'info');
          }}
          style={{
            background: 'transparent',
            fontSize: '11px',
            fontWeight: 800,
            padding: '4px 8px',
            borderRadius: '6px',
            color: showDesktopLyric ? 'var(--ios-card)' : 'var(--muted)',
            backgroundColor: showDesktopLyric ? 'var(--accent)' : 'transparent',
            border: showDesktopLyric ? '1px solid var(--accent)' : '1px solid var(--line)',
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '24px',
            marginLeft: '6px',
            boxShadow: showDesktopLyric ? '0 2px 8px rgba(var(--accent-rgb), 0.35)' : 'none',
          }}
        >
          {showDesktopLyric && lockDesktopLyric && (
            <Lock size={10} style={{ marginRight: '3px', display: 'inline-block', verticalAlign: 'middle' }} />
          )}
          <span style={{ verticalAlign: 'middle' }}>LRC</span>
        </button>
      </div>
    </div>
  );
}
