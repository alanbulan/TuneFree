import { useState } from 'react';
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
  usePlayerQueueState,
  usePlayerSettings,
} from '../../core/contexts/PlayerContext';
import { Sparkles } from 'lucide-react';
import AudioVisualizer from '../../core/components/AudioVisualizer';
import type { AudioQuality } from '../../core/types';
import CoverArt from './CoverArt';
import { useToast } from './ToastHost';
import ConnectedProgressSlider from './ConnectedProgressSlider';
import { useSongDownload } from '../hooks/useSongDownload';
import QualitySelector from './QualitySelector';
import {
  attachRecommendationMeta,
  getSimilarSongs,
  recommendationFeedbackFromSong,
  saveRecommendationFeedback,
} from '../../core/services/recommendation';
import { DesktopLyricToggle, TransportMiniLyric } from './DesktopTransportWidgets';

interface DesktopTransportProps {
  onExpand: () => void;
  /** 全屏播放器打开时底栏被完全遮挡，据此停掉这里的可视化绘制。 */
  suspended?: boolean;
}

export default function DesktopTransport({ onExpand, suspended = false }: DesktopTransportProps) {
  const { currentSong, isPlaying, isLoading } = usePlayerNowPlaying();
  const { playMode } = usePlayerQueueState();
  const { audioQuality } = usePlayerSettings();
  const { toggleFavorite, isFavorite } = useLibrary();
  const { togglePlay, playNext, playPrev, togglePlayMode, setAudioQuality, playQueue } = usePlayerActions();
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

  return (
    <div className="transport mini-player">
      <div className="transport-wave-bg mini-wave-bg" aria-hidden="true">
        <AudioVisualizer isPlaying={isPlaying} suspended={suspended} />
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
        <TransportMiniLyric onExpand={onExpand} />
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
        {currentSong && (
          <button
            type="button"
            className="ai-radar-btn-mini"
            title="根据当前播放歌曲开启相似音乐流 (Embeat)"
            onClick={handleStartSimilarFlow}
            disabled={loadingSimilar}
          >
            {loadingSimilar ? (
              <span className="ai-radar-btn-pending">…</span>
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
          className="icon-button transport-download-button"
          aria-label={isDownloading ? '取消下载' : '下载当前歌曲'}
          title={isDownloading ? '取消当前下载' : '下载当前歌曲'}
          disabled={isCancelling || (!currentSong && !isDownloading)}
          onClick={() => {
            if (isDownloading) void cancelDownload();
            else if (currentSong) void handleDownload(currentSong, audioQuality);
          }}
        >
          {isDownloading ? (
            <span className="transport-download-progress">
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
        <DesktopLyricToggle />
      </div>
    </div>
  );
}
