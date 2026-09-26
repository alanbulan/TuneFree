import { usePlayerActions, usePlayerQueueState } from '../../../core/contexts/PlayerContext';
import { PlayIcon, ShuffleIcon } from '../../../core/components/Icons';
import type { PlayMode, Song } from '../../../core/types';

/** togglePlayMode 的轮换顺序是 顺序 → 单曲循环 → 随机，这里记下切到「随机」还要按几次。 */
const TOGGLES_TO_SHUFFLE: Record<PlayMode, number> = { sequence: 2, loop: 1, shuffle: 0 };

/**
 * 列表头部的「播放全部 / 随机播放」。
 * 自己订阅队列状态（读 playMode），避免整张歌曲表跟着队列变化重渲染。
 */
export default function PlayAllButtons({ songs }: { songs: Song[] }) {
  const { playQueue, togglePlayMode } = usePlayerActions();
  const { playMode } = usePlayerQueueState();
  const empty = songs.length === 0;

  const handleShuffle = () => {
    // 切到随机模式后从随机一首开始，之后的「下一首」按随机顺序表走完整个列表。
    for (let i = 0; i < TOGGLES_TO_SHUFFLE[playMode]; i++) togglePlayMode();
    void playQueue(songs, songs[Math.floor(Math.random() * songs.length)]);
  };

  return (<>
    <button type="button" className="primary-button" disabled={empty}
      onClick={() => void playQueue(songs, songs[0])}><PlayIcon size={14} />播放全部</button>
    <button type="button" className="soft-button" disabled={empty}
      onClick={handleShuffle}><ShuffleIcon size={14} />随机播放</button>
  </>);
}
