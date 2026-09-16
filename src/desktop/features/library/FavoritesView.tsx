import { useLibrary } from '../../../core/contexts/LibraryContext';
import { usePlayerActions, usePlayerNowPlaying } from '../../../core/contexts/PlayerContext';
import { useToast } from '../../components/ToastHost';
import SongTable from '../../components/SongTable';
import type { Song } from '../../../core/types';

export default function FavoritesView() {
  const { favorites, toggleFavorite, isFavorite, reorderPlaylistSongs } = useLibrary();
  const { playQueue } = usePlayerActions();
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { showToast } = useToast();

  const handleFavorite = (song: Song) => {
    const wasFavorite = isFavorite(song.id, song.source);
    if (!toggleFavorite(song)) return;
    showToast(wasFavorite ? '已取消收藏' : '已收藏歌曲', 'success', {
      label: '撤销',
      onClick: () => toggleFavorite(song),
    });
  };

  return (
    <section>
      <SongTable
        songs={favorites}
        currentSong={currentSong}
        isPlaying={isPlaying}
        emptyText="暂无收藏歌曲"
        // 与歌单详情一致：点一首歌是「把这份列表放进播放队列，并从这首开始」，
        // 而不是只播这一首、让队列停在上一个列表。
        onPlay={(song: Song) => void playQueue(favorites, song)}
        onFavorite={handleFavorite}
        isFavorite={(song: Song) => isFavorite(song.id, song.source)}
        onReorder={(from, to) => { reorderPlaylistSongs('favorites', from, to); }}
      />
    </section>
  );
}
