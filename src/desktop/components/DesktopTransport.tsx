import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CloseIcon,
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
import { useLyricDisplayMode } from '../../core/hooks/useLyricDisplayMode';
import { Lock, Sparkles } from 'lucide-react';
import AudioVisualizer from '../../core/components/AudioVisualizer';
import { findActiveLyricIndex, parseLyrics, type ParsedLyric } from '../../core/utils/lyrics';
import type { AudioQuality } from '../../core/types';
import CoverArt from './CoverArt';
import { useToast } from './ToastHost';
import PlayerProgressSlider from './PlayerProgressSlider';
import { useSongDownload } from '../hooks/useSongDownload';
import QualitySelector from './QualitySelector';
import {
  attachRecommendationMeta,
  getSimilarSongs,
  recommendationFeedbackFromSong,
  saveRecommendationFeedback,
} from '../../core/services/recommendation';

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
  const { togglePlay, playNext, playPrev, seek, togglePlayMode, setAudioQuality, playQueue } = usePlayerActions();
  const { showToast } = useToast();
  const { isDownloading, isCancelling, downloadProgress, handleDownload, cancelDownload } = useSongDownload();

  const [loadingSimilar, setLoadingSimilar] = useState(false);

  const handleStartSimilarFlow = async () => {
    if (!currentSong || loadingSimilar) return;
    setLoadingSimilar(true);
    showToast(`正在计算《${currentSong.name}》的相似歌曲...`, 'info');
    try {
      const items = await getSimilarSongs(currentSong, { limit: 20 });
      const songs = attachRecommendationMeta(items);
      if (songs.length === 0) {
        showToast('未找到相似歌曲，换首其它歌曲试试吧', 'info');
      } else {
        const first = songs[0];
        const feedback = first ? recommendationFeedbackFromSong(first, 'play', 'similar') : null;
        if (feedback) void saveRecommendationFeedback(feedback).catch(() => {});
        await playQueue(songs, songs[0]);
        showToast(`已载入 ${songs.length} 首相似歌曲`, 'success');
      }
    } catch (err) {
      console.error(err);
      showToast('开启相似歌曲流失败，请稍后再试', 'error');
    } finally {
      setLoadingSimilar(false);
    }
  };

  const rawLyrics = currentSong?.lrc;
  const lyricDisplayMode = useLyricDisplayMode();
  const lyricRows = useMemo(() => parseLyrics(rawLyrics), [rawLyrics]);
  const activeLyricIndex = findActiveLyricIndex(
    lyricRows,
    currentTime,
    lyricOffsetSeconds,
    lyricDisplayMode,
  );
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
  const desktopLyricState = !showDesktopLyric ? 'off' : lockDesktopLyric ? 'locked' : 'floating';
  const desktopLyricButtonLabel =
    desktopLyricState === 'off' ? 'LRC' : desktopLyricState === 'floating' ? '浮动' : '锁定';
  const desktopLyricButtonTitle =
    desktopLyricState === 'off'
      ? '打开桌面歌词'
      : desktopLyricState === 'floating'
        ? '锁定桌面歌词（鼠标穿透）'
        : '关闭桌面歌词';
  const desktopLyricButtonAria =
    desktopLyricState === 'off'
      ? '打开桌面歌词'
      : desktopLyricState === 'floating'
        ? '锁定桌面歌词'
        : '关闭桌面歌词';

  const handleCycleDesktopLyric = () => {
    if (desktopLyricState === 'off') {
      setLockDesktopLyric(false);
      setShowDesktopLyric(true);
      showToast('桌面歌词已打开', 'info');
      return;
    }

    if (desktopLyricState === 'floating') {
      setLockDesktopLyric(true);
      showToast('桌面歌词已锁定（鼠标穿透）', 'info');
      return;
    }

    setLockDesktopLyric(false);
    setShowDesktopLyric(false);
    showToast('桌面歌词已关闭', 'info');
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
        <PlayerProgressSlider currentTime={currentTime} duration={duration} onSeek={seek} />
      </div>

      <div className="transport-tools">
        {currentSong && (
          <button
            type="button"
            className="ai-radar-btn-mini"
            title="根据当前播放歌曲开启相似音乐流 (Embeat)"
            onClick={handleStartSimilarFlow}
            disabled={loadingSimilar}
            style={{ marginRight: '8px' }}
          >
            {loadingSimilar ? (
              <span style={{ fontSize: '10px', fontWeight: 900, color: 'var(--text-soft)' }}>…</span>
            ) : (
              <Sparkles size={11} />
            )}
          </button>
        )}
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
          aria-label={isDownloading ? '取消下载' : '下载当前歌曲'}
          title={isDownloading ? '取消当前下载' : '下载当前歌曲'}
          disabled={isCancelling || (!currentSong && !isDownloading)}
          onClick={() => {
            if (isDownloading) void cancelDownload();
            else if (currentSong) void handleDownload(currentSong, audioQuality);
          }}
          style={{ minWidth: '28px' }}
        >
          {isDownloading ? (
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent)' }}>
              {isCancelling ? '…' : downloadProgress !== null ? `${downloadProgress}%` : <CloseIcon size={14} />}
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
          className={`lyric-toggle-btn ${showDesktopLyric ? 'active' : ''} ${lockDesktopLyric ? 'locked' : ''}`}
          title={`${desktopLyricButtonTitle}；右击可单独${lockDesktopLyric ? '解锁' : '锁定'}`}
          aria-label={desktopLyricButtonAria}
          onClick={handleCycleDesktopLyric}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!showDesktopLyric) {
              setLockDesktopLyric(false);
              setShowDesktopLyric(true);
              showToast('桌面歌词已打开', 'info');
              return;
            }
            const nextLock = !lockDesktopLyric;
            setLockDesktopLyric(nextLock);
            showToast(nextLock ? '桌面歌词已锁定（鼠标穿透）' : '桌面歌词已解锁', 'info');
          }}
          style={{
            background: 'transparent',
            fontSize: '11px',
            fontWeight: 800,
            padding: '4px 7px',
            borderRadius: '6px',
            color: showDesktopLyric ? (lockDesktopLyric ? 'var(--ios-card)' : 'var(--accent)') : 'var(--muted)',
            backgroundColor: showDesktopLyric ? (lockDesktopLyric ? 'var(--accent)' : 'rgba(var(--accent-rgb), 0.10)') : 'transparent',
            border: showDesktopLyric ? '1px solid var(--accent)' : '1px solid var(--line)',
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '3px',
            flex: '0 0 auto',
            height: '24px',
            width: lockDesktopLyric ? '54px' : '42px',
            marginLeft: '6px',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            boxShadow: showDesktopLyric ? '0 2px 8px rgba(var(--accent-rgb), 0.35)' : 'none',
          }}
        >
          {showDesktopLyric && lockDesktopLyric && (
            <Lock size={10} style={{ flex: '0 0 auto' }} />
          )}
          <span style={{ flex: '0 0 auto' }}>{desktopLyricButtonLabel}</span>
        </button>
      </div>
    </div>
  );
}
