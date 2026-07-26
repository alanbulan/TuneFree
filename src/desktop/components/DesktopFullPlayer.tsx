import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import AudioVisualizer from '../../core/components/AudioVisualizer';
import {
  CloseIcon,
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
  usePlayerQueueState,
  usePlayerSettings,
} from '../../core/contexts/PlayerContext';
import type { AudioQuality } from '../../core/types';
import CoverArt from './CoverArt';
import { useToast } from './ToastHost';
import { type CoverPanelStyle } from '../utils/formatting';
import FullPlayerLyrics from './fullplayer/FullPlayerLyrics';
import FullPlayerQueue from './fullplayer/FullPlayerQueue';
import FullPlayerActions from './fullplayer/FullPlayerActions';
import ConnectedProgressSlider from './ConnectedProgressSlider';
import QualitySelector from './QualitySelector';

interface DesktopFullPlayerProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (query: string) => void;
}

export default function DesktopFullPlayer({ isOpen, onClose, onSearch }: DesktopFullPlayerProps) {
  const { currentSong, isPlaying, isLoading } = usePlayerNowPlaying();
  const { playMode } = usePlayerQueueState();
  const { audioQuality } = usePlayerSettings();
  const { toggleFavorite, isFavorite } = useLibrary();
  const { showToast } = useToast();
  const [showMorePanel, setShowMorePanel] = useState(false);

  const {
    playPrev,
    playNext,
    togglePlay,
    togglePlayMode,
    setAudioQuality,
  } = usePlayerActions();

  const modeIcon =
    playMode === 'shuffle' ? (
      <ShuffleIcon size={17} />
    ) : playMode === 'loop' ? (
      <RepeatOneIcon size={17} />
    ) : (
      <RepeatIcon size={17} />
    );

  const panelStyle: CoverPanelStyle | undefined = currentSong?.pic
    ? { '--full-cover-bg': `url(${JSON.stringify(currentSong.pic)})` }
    : undefined;

  const hasSong = !!currentSong;
  const favoriteActive = hasSong && isFavorite(currentSong.id, currentSong.source);

  // P3-10: Save focus on open, restore on close.
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    return () => {
      if (previouslyFocused) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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
    <motion.div
      className="full-player-layer open"
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.div
        className="full-player-backdrop"
        onClick={onClose}
        initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
        animate={{ opacity: 1, backdropFilter: 'blur(18px)' }}
        exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
        transition={{ duration: 0.35, ease: 'easeInOut' }}
      />
      <motion.section
        className={`full-player-panel ${currentSong?.pic ? 'has-cover-bg' : ''} ${isPlaying ? 'is-playing' : ''}`}
        style={panelStyle}
        role="dialog"
        aria-modal="true"
        aria-label="全屏播放器"
        variants={{
          hidden: { y: '100dvh', opacity: 0.9, scale: 0.96 },
          visible: { y: 0, opacity: 1, scale: 1 },
          exit: { y: '100dvh', opacity: 0.9, scale: 0.96 },
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
          <div className="full-song-meta">
            <AnimatePresence mode="popLayout">
              <motion.div
                key={currentSong?.id || 'none'}
                className="full-song-meta-swap"
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -12, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <h2>{currentSong?.name || '未在播放'}</h2>
                <p>{currentSong?.artist || '从排行榜、搜索或资料库中选择音乐'}</p>
              </motion.div>
            </AnimatePresence>
            <FullPlayerActions
              showMorePanel={showMorePanel}
              setShowMorePanel={setShowMorePanel}
              onSearch={onSearch}
            />
          </div>
        </div>

        <FullPlayerLyrics isOpen={isOpen} />

        <FullPlayerQueue />

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
            <ConnectedProgressSlider />
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
            <QualitySelector audioQuality={audioQuality} onQualityChange={(q: AudioQuality) => setAudioQuality(q)} />
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}
