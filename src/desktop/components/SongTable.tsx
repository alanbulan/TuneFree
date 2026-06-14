import { HeartFillIcon, HeartIcon, MoreIcon, MusicIcon, PlayIcon, TrashIcon } from '../../core/components/Icons';
import { getImgReferrerPolicy } from '../../core/services/api';
import { Song, isSameSong } from '../../core/types';
import { getMusicSourceLabel } from '../../core/utils/musicSource';
import VirtualList from './VirtualList';

interface SongTableProps {
  songs: Song[];
  currentSong?: Song | null;
  isPlaying?: boolean;
  isLoading?: boolean;
  skeletonRows?: number;
  emptyText?: string;
  actionLabel?: string;
  onPlay: (song: Song) => void;
  onFavorite?: (song: Song) => void;
  isFavorite?: (song: Song) => boolean;
  onMore?: (song: Song) => void;
  onDelete?: (song: Song) => void;
  deleteLabel?: string;
}

export default function SongTable({
  songs,
  currentSong,
  isPlaying,
  isLoading = false,
  skeletonRows = 8,
  emptyText = '暂无歌曲',
  actionLabel = '播放',
  onPlay,
  onFavorite,
  isFavorite,
  onMore,
  onDelete,
  deleteLabel = '删除歌曲',
}: SongTableProps) {
  if (isLoading && songs.length === 0) {
    return (
      <div className="song-table skeleton-table" aria-busy="true" aria-label="歌曲加载中">
        <div className="table-head">
          <span>#</span>
          <span>歌曲</span>
          <span>专辑</span>
          <span>来源</span>
          <span>{actionLabel}</span>
        </div>
        {Array.from({ length: skeletonRows }).map((_, index) => (
          <div className="song-row skeleton-song-row" key={index}>
            <span className="skeleton-line skeleton-index" />
            <span className="song-main">
              <span className="song-cover skeleton-block" />
              <span className="song-info">
                <span className="skeleton-line skeleton-title" />
                <span className="skeleton-line skeleton-subtitle" />
              </span>
            </span>
            <span className="skeleton-line skeleton-album" />
            <span className="skeleton-pill" />
            <span className="table-actions">
              <span className="skeleton-dot" />
              <span className="skeleton-dot" />
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (songs.length === 0) {
    return (
      <div className="empty-state">
        <div>
          <MusicIcon size={46} />
          <p>{emptyText}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="song-table">
      <div className="table-head">
        <span>#</span>
        <span>歌曲</span>
        <span>专辑</span>
        <span>来源</span>
        <span>{actionLabel}</span>
      </div>
      <VirtualList
        items={songs}
        itemHeight={56}
        maxHeight={Math.min(640, Math.max(280, songs.length * 56))}
        className="song-virtual-list"
        getKey={(song, index) => `${song.source}-${song.id}-${index}`}
        renderItem={(song, index, style) => {
          const current = isSameSong(currentSong, song);
          const title = typeof song.name === 'string' ? song.name : '未知歌曲';
          const artist = typeof song.artist === 'string' ? song.artist : '未知歌手';
          const album = typeof song.album === 'string' && song.album ? song.album : '未知专辑';
          const favoriteActive = Boolean(isFavorite?.(song));
          return (
            <div
              role="button"
              tabIndex={0}
              aria-label={`播放 ${title} - ${artist}`}
              className={`song-row ${current ? 'current' : ''}`}
              key={`${song.source}-${song.id}-${index}`}
              style={style}
              onClick={() => onPlay(song)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onPlay(song);
                }
              }}
            >
              <span className="song-index">{current && isPlaying ? '▶' : String(index + 1).padStart(2, '0')}</span>
              <span className="song-main">
                <span className="song-cover">
                  {song.pic ? (
                    <img src={song.pic} alt={title} referrerPolicy={getImgReferrerPolicy(song.pic)} loading="lazy" />
                  ) : (
                    <MusicIcon size={18} className="muted-text" />
                  )}
                </span>
                <span className="song-info">
                  <span className="song-title">{title}</span>
                  <span className="song-artist">{artist}</span>
                </span>
              </span>
              <span className="song-album">{album}</span>
              <span className="source-badge">{getMusicSourceLabel(song.source)}</span>
              <span
                className="table-actions"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                {onFavorite && (
                  <button
                    type="button"
                    className={`table-action ${favoriteActive ? 'active' : ''}`}
                    aria-label={favoriteActive ? '取消收藏' : '收藏歌曲'}
                    title={favoriteActive ? '取消收藏' : '收藏歌曲'}
                    aria-pressed={favoriteActive}
                    onClick={() => onFavorite(song)}
                  >
                    {favoriteActive ? <HeartFillIcon size={16} /> : <HeartIcon size={16} />}
                  </button>
                )}
                <button type="button" className="table-action" aria-label="立即播放" onClick={() => onPlay(song)}>
                  <PlayIcon size={16} />
                </button>
                {onMore && (
                  <button type="button" className="table-action" aria-label="更多操作" onClick={() => onMore(song)}>
                    <MoreIcon size={16} />
                  </button>
                )}
                {onDelete && (
                  <button type="button" className="table-action table-action-danger" aria-label={deleteLabel} title={deleteLabel} onClick={() => onDelete(song)}>
                    <TrashIcon size={16} />
                  </button>
                )}
              </span>
            </div>
          );
        }}
      />
    </div>
  );
}
