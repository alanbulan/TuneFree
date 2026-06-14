import AudioVisualizer from '../../core/components/AudioVisualizer';
import { QueueIcon, TrashIcon } from '../../core/components/Icons';
import {
  usePlayerActions,
  usePlayerNowPlaying,
  usePlayerQueueState,
} from '../../core/contexts/PlayerContext';
import { isSameSong } from '../../core/types';
import CoverArt from './CoverArt';

export default function DesktopQueueRail() {
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { queue } = usePlayerQueueState();
  const { playSong, clearQueue, removeFromQueue } = usePlayerActions();

  return (
    <aside className="right-rail glass-panel">
      <CoverArt src={currentSong?.pic} alt={currentSong?.name || '当前播放'} />
      <h2 className="now-title">{currentSong?.name || '未在播放'}</h2>
      <p className="now-artist">{currentSong?.artist || '从排行榜、搜索或资料库中选择音乐'}</p>
      <div className="visualizer-wrap">
        <AudioVisualizer isPlaying={isPlaying} />
      </div>
      <div className="queue-header">
        <h3 className="panel-title"><QueueIcon size={18} /> 播放队列</h3>
        <button type="button" className="icon-button" aria-label="清空队列" onClick={clearQueue}>
          <TrashIcon size={16} />
        </button>
      </div>
      <div className="queue-list">
        {queue.length === 0 ? (
          <div className="empty-state">
            <p>队列还是空的。播放任意歌曲后，这里会显示接下来的音乐。</p>
          </div>
        ) : (
          queue.map((song, index) => {
            const active = isSameSong(currentSong, song);
            return (
              <div className="queue-item" key={`${song.source}-${song.id}-${index}`}>
                <span className="queue-number">{active ? '▶' : index + 1}</span>
                <button type="button" className="playlist-pill" onClick={() => playSong(song)}>
                  <span>
                    <span className="queue-title">{song.name}</span>
                    <span className="queue-artist">{song.artist}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="table-action"
                  aria-label="从队列移除"
                  onClick={() => removeFromQueue(song.id, song.source)}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
