import { useMemo, useState } from 'react';
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
import { findActiveLyricIndex, parseLyrics, type ParsedLyric } from '../../core/utils/lyrics';
import type { AudioQuality } from '../../core/types';
import CoverArt from './CoverArt';
import { useToast } from './ToastHost';
import { formatTime } from '../utils/formatting';
import { useSongDownload } from '../hooks/useSongDownload';
import QualitySelector from './QualitySelector';

interface DesktopTransportProps {
  onExpand: () => void;
}

const getMiniLyricSecondary = (row: ParsedLyric | null): string =>
  row?.romanization || row?.pronunciation || row?.translation || row?.extra?.[0]?.text || '';

export default function DesktopTransport({ onExpand }: DesktopTransportProps) {
  const { currentSong, isPlaying, isLoading } = usePlayerNowPlaying();
  const { showDesktopLyric, setShowDesktopLyric, lockDesktopLyric, setLockDesktopLyric } = useTheme();
  const { currentTime, duration, lyricOffsetSeconds } = usePlayerProgress();
  const { playMode } = usePlayerQueueState();
  const { audioQuality } = usePlayerSettings();
  const { toggleFavorite, isFavorite } = useLibrary();
  const { togglePlay, playNext, playPrev, seek, togglePlayMode, setAudioQuality } = usePlayerActions();
  const { showToast } = useToast();
  const { isDownloading, downloadProgress, handleDownload } = useSongDownload();

  // P3-11: Progress bar drag state
  const [isDragging, setIsDragging] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);

  const rawLyrics = currentSong?.lrc;
  const lyricRows = useMemo(() => parseLyrics(rawLyrics), [rawLyrics]);
  const activeLyricIndex = findActiveLyricIndex(lyricRows, currentTime, lyricOffsetSeconds);
  const activeLyric = activeLyricIndex >= 0 ? lyricRows[activeLyricIndex] : null;
  const activeLyricSecondary = getMiniLyricSecondary(activeLyric);
  const favoriteActive = !!currentSong && isFavorite(currentSong.id, currentSong.source);
  const modeIcon =
    playMode === 'shuffle' ? (
      <ShuffleIcon size={17} />
    ) : playMode === 'loop' ? (
      <RepeatOneIcon size={17} />
    ) : (
      <RepeatIcon size={17} />
    );

  const handleToggleFavorite = () => {
    if (!currentSong) return;
    const wasFavorite = isFavorite(currentSong.id, currentSong.source);
    toggleFavorite(currentSong);
    showToast(wasFavorite ? '已取消收藏' : '已收藏歌曲', 'success', {
      label: '撤销',
      onClick: () => currentSong && toggleFavorite(currentSong),
    });
  };

  // P3-11: Display preview time during drag, actual time otherwise
  const displayTime = isDragging ? previewTime : currentTime;

  return (
    <div className="transport mini-player">
      <div className="transport-wave-bg mini-wave-bg" aria-hidden="true">
        <AudioVisualizer isPlaying={isPlaying} />
      </div>

      <button
        type="button"
        className="transport-main mini-player-summary"
        onClick={onExpand}
        aria-label="打开全屏播放器"
      >
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
          style={{
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AnimatePresence mode="popLayout">
            <motion.div
              key={activeLyric?.text || currentSong?.name || 'empty'}
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                width: '100%',
                pointerEvents: 'none',
              }}
            >
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '90%',
                }}
              >
                {activeLyric?.text || currentSong?.name || 'TuneFree Desktop'}
              </span>
              {activeLyricSecondary ? (
                <em
                  style={{
                    fontSize: '11px',
                    fontStyle: 'normal',
                    opacity: 0.65,
                    marginTop: '2px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '90%',
                  }}
                >
                  {activeLyricSecondary}
                </em>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </button>
        <div className="transport-controls">
          <button type="button" className="control-button" aria-label="上一首" onClick={() => playPrev()}>
            <PrevIcon size={19} />
          </button>
          <button
            type="button"
            className="control-button primary"
            aria-label="播放或暂停"
            onClick={() => togglePlay()}
            disabled={!currentSong && !isPlaying}
          >
            {isLoading ? <span>…</span> : isPlaying ? <PauseIcon size={23} /> : <PlayIcon size={23} />}
          </button>
          <button type="button" className="control-button" aria-label="下一首" onClick={() => playNext(true)}>
            <NextIcon size={19} />
          </button>
        </div>
        <div className="progress-row">
          <span>{formatTime(displayTime)}</span>
          <input
            className="progress-bar"
            aria-label="播放进度"
            type="range"
            min={0}
            max={duration || 0}
            value={duration ? Math.min(displayTime, duration) : 0}
            onInput={(event) => {
              const target = event.target as HTMLInputElement;
              setIsDragging(true);
              setPreviewTime(Number(target.value));
            }}
            onChange={(event) => {
              const target = event.target as HTMLInputElement;
              const value = Number(target.value);
              setIsDragging(false);
              seek(value);
            }}
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
          disabled={!currentSong || isDownloading}
          onClick={() => currentSong && handleDownload(currentSong, audioQuality)}
          style={{ minWidth: '28px' }}
        >
          {isDownloading ? (
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
        <QualitySelector audioQuality={audioQuality} onQualityChange={(q: AudioQuality) => setAudioQuality(q)} />
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
