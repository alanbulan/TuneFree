import { type CSSProperties } from 'react';
import {
  QueueIcon,
  TrashIcon,
} from '../../../core/components/Icons';
import {
  usePlayerActions,
  usePlayerNowPlaying,
  usePlayerQueueState,
} from '../../../core/contexts/PlayerContext';
import { isSameSong, type Song } from '../../../core/types';
import CoverArt from '../CoverArt';
import VirtualList from '../VirtualList';
import { useToast } from '../ToastHost';

const playModeLabel: Record<'sequence' | 'loop' | 'shuffle', string> = {
  sequence: '列表循环',
  loop: '单曲循环',
  shuffle: '随机播放',
};

export default function FullPlayerQueue() {
  const { currentSong } = usePlayerNowPlaying();
  const { queue, playMode } = usePlayerQueueState();
  const { playSong, playQueue, clearQueue, removeFromQueue, togglePlayMode } = usePlayerActions();
  const { showToast } = useToast();

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
    <aside className="full-queue-card">
      <div className="queue-now-card">
        <CoverArt
          src={currentSong?.pic}
          alt={currentSong?.name || '当前播放'}
          className="queue-now-cover"
          iconSize={26}
        />
        <div className="queue-now-meta">
          <p>正在播放</p>
          <h3>{currentSong?.name || '未在播放'}</h3>
          <span>{currentSong?.artist || '选择一首音乐开始'}</span>
        </div>
      </div>
      <div className="queue-header">
        <div>
          <h3 className="panel-title">
            <QueueIcon size={18} /> 播放队列
          </h3>
          <button type="button" className="queue-mode-chip" onClick={togglePlayMode}>
            {playModeLabel[playMode]}
          </button>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="清空待播队列"
          title="清空待播队列"
          onClick={handleClearQueue}
        >
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
            getKey={(song: Song, index: number) => `${song.source}-${song.id}-${index}`}
            renderItem={(song: Song, index: number, style: CSSProperties) => {
              const active = isSameSong(currentSong, song);
              return (
                <div
                  className={`queue-item ${active ? 'active' : ''}`}
                  key={`${song.source}-${song.id}-${index}`}
                  style={style}
                >
                  <button
                    type="button"
                    className="queue-play-button"
                    onClick={() => playSong(song)}
                    aria-label={`播放 ${song.name}`}
                  >
                    <span className="queue-number">{active ? '▶' : index + 1}</span>
                    <CoverArt
                      src={song.pic}
                      alt={song.name || '队列歌曲'}
                      className="queue-cover"
                      iconSize={15}
                    />
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
  );
}
